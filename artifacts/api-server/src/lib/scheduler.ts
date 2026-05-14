import { db } from "@workspace/db";
import { postsTable, socialAccountsTable } from "@workspace/db/schema";
import { eq, and, lte, isNull } from "drizzle-orm";
import { decryptToken, encryptToken, isEncryptionConfigured } from "./crypto.js";
import { publishToPlatform } from "./publishers/index.js";
import { logger } from "./logger.js";
import { isNetworkError } from "./supabase.js";
import { writeClientMemory } from "./client-memory-packet.js";
import { createClientNotification } from "./notifications.js";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DIRECT_PUBLISH_PLATFORMS = new Set(["instagram", "facebook", "linkedin", "twitter"]);
const inFlightPostIds = new Set<string>();
let schedulerRunning = false;

export type ScheduledPublishRunResult = {
  reason: string;
  disabled: boolean;
  skippedReason: string | null;
  dueCount: number;
  attemptedCount: number;
  publishedCount: number;
  failedCount: number;
  skippedCount: number;
};

type ScheduledPublishRunOptions = {
  reason?: "interval" | "startup_recovery" | "manual";
  clientId?: string;
};

async function refreshAccountToken(
  account: typeof socialAccountsTable.$inferSelect
): Promise<string | null> {
  const platform = account.platform;

  try {
    if (platform === "facebook" || platform === "instagram") {
      const appId = process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID ?? process.env.INSTAGRAM_APP_ID;
      const appSecret = process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
      if (!appId || !appSecret || !account.accessToken) return null;
      const graphVersion = process.env.META_GRAPH_VERSION ?? "v18.0";

      const currentToken = decryptToken(account.accessToken);
      const res = await fetch(
        `https://graph.facebook.com/${graphVersion}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(currentToken)}`
      );
      if (!res.ok) return null;

      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;

      const newExpiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      await db
        .update(socialAccountsTable)
        .set({
          accessToken: encryptToken(data.access_token),
          ...(newExpiresAt ? { tokenExpiresAt: newExpiresAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialAccountsTable.id, account.id));

      return data.access_token;
    }

    if ((platform === "linkedin" || platform === "twitter") && account.refreshToken) {
      const storedRefresh = decryptToken(account.refreshToken);

      let tokenUrl: string;
      let body: URLSearchParams;
      let headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };

      if (platform === "linkedin") {
        const clientId = process.env.LINKEDIN_CLIENT_ID;
        const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
        if (!clientId || !clientSecret) return null;

        tokenUrl = "https://www.linkedin.com/oauth/v2/accessToken";
        body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: storedRefresh,
          client_id: clientId,
          client_secret: clientSecret,
        });
      } else {
        const clientId = process.env.TWITTER_CLIENT_ID;
        const clientSecret = process.env.TWITTER_CLIENT_SECRET;
        if (!clientId || !clientSecret) return null;

        tokenUrl = "https://api.twitter.com/2/oauth2/token";
        headers["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
        body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: storedRefresh,
          client_id: clientId,
        });
      }

      const res = await fetch(tokenUrl, { method: "POST", headers, body });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!data.access_token) return null;

      const newExpiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      await db
        .update(socialAccountsTable)
        .set({
          accessToken: encryptToken(data.access_token),
          ...(data.refresh_token ? { refreshToken: encryptToken(data.refresh_token) } : {}),
          ...(newExpiresAt ? { tokenExpiresAt: newExpiresAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialAccountsTable.id, account.id));

      return data.access_token;
    }
  } catch (err) {
    logger.warn({ err, platform, accountId: account.id }, "Token refresh failed");
  }

  return null;
}

export async function resolveAccessToken(
  account: typeof socialAccountsTable.$inferSelect
): Promise<string> {
  if (!account.accessToken) {
    throw new Error(`No access token stored for ${account.platform} account`);
  }

  const tokenExpiresSoon =
    account.tokenExpiresAt &&
    new Date(account.tokenExpiresAt).getTime() <= Date.now() + REFRESH_BUFFER_MS;

  const tokenAlreadyExpired =
    account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now();

  if (tokenExpiresSoon) {
    logger.info(
      { accountId: account.id, platform: account.platform, expiresAt: account.tokenExpiresAt },
      "Token expiring soon — attempting refresh"
    );
    const refreshed = await refreshAccountToken(account);
    if (refreshed) return refreshed;
    if (tokenAlreadyExpired) {
      throw new Error(
        `Access token for ${account.platform} account expired and refresh failed. ` +
          "Please reconnect the account via OAuth."
      );
    }
  }

  return decryptToken(account.accessToken);
}

function safeErrMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function publishImageUrl(post: typeof postsTable.$inferSelect): string | null {
  const schema = asRecord(post.contentSchema);
  return String(schema.finalArtworkUrl ?? post.selectedImageUrl ?? post.brandedImageUrl ?? schema.imageUrl ?? "") || null;
}

function publishMetadata(post: typeof postsTable.$inferSelect, result: {
  platformPostId: string;
  provider: string;
  publishedUrl: string;
  rawPublishResponse?: unknown;
}) {
  const schema = asRecord(post.contentSchema);
  return {
    ...schema,
    publish: {
      ...asRecord(schema.publish),
      platformPostId: result.platformPostId,
      provider: result.provider,
      publishedUrl: result.publishedUrl,
      rawPublishResponse: result.rawPublishResponse,
    },
  };
}

function normalizePlatform(platform?: string | null): string {
  return platform || "instagram";
}

function autoPublishErrorForPost(post: typeof postsTable.$inferSelect, platform: string): string | null {
  if (post.publishedAt) return "Post already has a published time.";
  if (post.status !== "scheduled") return `Post status '${post.status}' is not eligible for auto-publish.`;
  if (!post.scheduledAt || new Date(post.scheduledAt).getTime() > Date.now()) return "Post is not due yet.";
  if (!DIRECT_PUBLISH_PLATFORMS.has(platform)) return `${platform} auto-publishing is not implemented yet.`;
  if ((post.contentType ?? "").toLowerCase().includes("video")) return "Video auto-publishing is not supported yet.";
  if (platform === "instagram" && !publishImageUrl(post)) return "Instagram auto-publishing requires final artwork or an image URL.";
  return null;
}

// Queue decision for this reliability pass:
// - setInterval remains low-risk for local/single-server MVP operation.
// - BullMQ + Redis is stronger for retries and multi-server locking, but adds infra.
// - Upstash QStash is good for hosted delivery but changes deployment shape.
// - Hosted cron hitting a locked endpoint is the simplest next production step.
// Current implementation stays process-local and must not run on multiple API replicas.
export async function runScheduledPublish(options: ScheduledPublishRunOptions = {}): Promise<ScheduledPublishRunResult> {
  const reason = options.reason ?? "interval";
  const result: ScheduledPublishRunResult = {
    reason,
    disabled: false,
    skippedReason: null,
    dueCount: 0,
    attemptedCount: 0,
    publishedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  };

  if (process.env.ENABLE_AUTO_PUBLISH === "false") {
    result.disabled = true;
    result.skippedReason = "ENABLE_AUTO_PUBLISH=false";
    logger.info({ reason }, "Scheduler cycle skipped: ENABLE_AUTO_PUBLISH=false");
    return result;
  }

  if (schedulerRunning) {
    result.skippedReason = "previous auto-publish cycle still running";
    logger.info({ reason }, "Scheduler cycle skipped: previous auto-publish cycle still running");
    return result;
  }

  if (!isEncryptionConfigured()) {
    result.skippedReason = "TOKEN_ENCRYPTION_KEY not configured";
    logger.warn({ reason }, "Scheduler skipped: TOKEN_ENCRYPTION_KEY not configured");
    return result;
  }

  schedulerRunning = true;
  let due: (typeof postsTable.$inferSelect)[];

  try {
    const now = new Date();
    logger.info({ now: now.toISOString(), reason, clientId: options.clientId }, "Scheduler cycle started");
    const conditions = [
      eq(postsTable.status, "scheduled"),
      lte(postsTable.scheduledAt, now),
      isNull(postsTable.publishedAt),
    ];
    if (options.clientId) conditions.push(eq(postsTable.clientId, options.clientId));
    due = await db
      .select()
      .from(postsTable)
      .where(and(...conditions))
      .limit(20);
  } catch (err) {
    // DB unreachable (DNS failure, pooler down, etc.) — skip this cycle quietly
    if (isNetworkError(err)) {
      logger.warn({ error: safeErrMsg(err) }, "Scheduler: DB unreachable — skipping cycle");
    } else {
      logger.warn({ error: safeErrMsg(err) }, "Scheduler: failed to query due posts — skipping cycle");
    }
    result.skippedReason = "failed to query due posts";
    schedulerRunning = false;
    return result;
  }

  result.dueCount = due.length;
  logger.info({ count: due.length, reason, clientId: options.clientId }, "Scheduler: due posts found");

  for (const post of due) {
    if (inFlightPostIds.has(post.id)) {
      logger.info({ postId: post.id }, "Scheduler: post already in flight — skipping duplicate attempt");
      result.skippedCount++;
      continue;
    }
    inFlightPostIds.add(post.id);
    result.attemptedCount++;
    try {
      const platform = normalizePlatform(post.platform);
      const safetyError = autoPublishErrorForPost(post, platform);
      if (safetyError) {
        await db
          .update(postsTable)
          .set({ status: "failed", publishError: safetyError, updatedAt: new Date() })
          .where(and(eq(postsTable.id, post.id), eq(postsTable.status, "scheduled"), isNull(postsTable.publishedAt)));
        await createClientNotification({
          clientId: post.clientId,
          type: "auto_publish_blocked",
          title: "Auto-publish blocked",
          message: safetyError,
          severity: "warning",
          metadata: { postId: post.id, platform, topic: post.topic },
        });
        logger.warn({ postId: post.id, platform, reason: safetyError }, "Scheduler: post blocked by safety guard");
        result.failedCount++;
        continue;
      }

      let account: typeof socialAccountsTable.$inferSelect | undefined;
      try {
        [account] = await db
          .select()
          .from(socialAccountsTable)
          .where(
            and(
              eq(socialAccountsTable.clientId, post.clientId),
              eq(socialAccountsTable.platform, platform),
              eq(socialAccountsTable.isActive, true)
            )
          )
          .limit(1);
      } catch (err) {
        if (isNetworkError(err)) {
          logger.warn({ error: safeErrMsg(err) }, "Scheduler: DB unreachable mid-cycle — aborting remaining posts");
          break; // abort the remaining posts; next tick will retry
        }
        throw err;
      }

      if (!account?.accessToken) {
        await db
          .update(postsTable)
          .set({
            status: "failed",
            publishError: `No direct ${platform} publishing account connected for this brand. Manual export and workflow send are still available.`,
            updatedAt: new Date(),
          })
          .where(and(eq(postsTable.id, post.id), eq(postsTable.status, "scheduled"), isNull(postsTable.publishedAt)));
        await createClientNotification({
          clientId: post.clientId,
          type: "auto_publish_blocked",
          title: "Publishing connector missing",
          message: `No direct ${platform} publishing account is connected for this brand.`,
          severity: "warning",
          metadata: { postId: post.id, platform, topic: post.topic },
        });
        logger.warn({ postId: post.id, platform }, "Scheduler: no connected direct publishing account");
        result.failedCount++;
        continue;
      }

      const accessToken = await resolveAccessToken(account);
      const imageUrl = publishImageUrl(post);

      logger.info({ postId: post.id, platform, hasImage: !!imageUrl, reason }, "Scheduler: publish attempted");

      const publishResult = await publishToPlatform({
        caption: post.caption,
        hashtags: post.hashtags,
        imageUrl,
        accountId: account.accountId ?? account.id,
        accessToken,
        platform,
      });

      await db
        .update(postsTable)
        .set({
          status: "posted",
          publishedAt: publishResult.publishedAt,
          publishedUrl: publishResult.publishedUrl,
          contentSchema: publishMetadata(post, publishResult),
          publishError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, post.id), eq(postsTable.status, "scheduled"), isNull(postsTable.publishedAt)));

      await writeClientMemory(post.clientId, "Performance Memory / Published post", `Scheduled publisher posted ${platform} post "${post.topic}". Treat this as an accepted final content direction.`)
        .catch((memoryErr: unknown) => {
          logger.warn({ postId: post.id, error: safeErrMsg(memoryErr) }, "Scheduler: publish succeeded but memory write failed");
        });

      result.publishedCount++;
      logger.info({ postId: post.id, platform, publishedUrl: publishResult.publishedUrl, reason }, "Scheduler: post published");
    } catch (err) {
      const message = safeErrMsg(err);
      // Best-effort status update — if DB is also down here, just log
      await db
        .update(postsTable)
        .set({ status: "failed", publishError: message, updatedAt: new Date() })
        .where(and(eq(postsTable.id, post.id), eq(postsTable.status, "scheduled"), isNull(postsTable.publishedAt)))
        .catch((dbErr: unknown) => {
          logger.warn(
            { postId: post.id, dbError: safeErrMsg(dbErr) },
            "Scheduler: could not persist publish failure to DB"
          );
        });
      await createClientNotification({
        clientId: post.clientId,
        type: "scheduled_publish_failed",
        title: "Scheduled publish failed",
        message,
        severity: "error",
        metadata: { postId: post.id, platform: post.platform ?? "instagram", topic: post.topic },
      });
      result.failedCount++;
      logger.warn({ postId: post.id, error: message, reason }, "Scheduler: publish failed");
    } finally {
      inFlightPostIds.delete(post.id);
    }
  }

  schedulerRunning = false;
  logger.info({ result }, "Scheduler cycle finished");
  return result;
}

export function startScheduler(): void {
  if (process.env.ENABLE_AUTO_PUBLISH === "false") {
    logger.info("Scheduler disabled: ENABLE_AUTO_PUBLISH=false");
    return;
  }
  const INTERVAL_MS = 60_000;
  void runScheduledPublish({ reason: "startup_recovery" });
  setInterval(() => {
    void runScheduledPublish({ reason: "interval" });
  }, INTERVAL_MS);
  logger.info("Scheduler started (1-minute interval)");
}
