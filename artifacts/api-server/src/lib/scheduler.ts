import { db } from "@workspace/db";
import { postsTable, socialAccountsTable } from "@workspace/db/schema";
import { eq, and, lte, isNull } from "drizzle-orm";
import { decryptToken, encryptToken, isEncryptionConfigured } from "./crypto.js";
import { publishToPlatform } from "./publishers/index.js";
import { logger } from "./logger.js";
import { isNetworkError } from "./supabase.js";
import { writeClientMemory } from "./client-memory-packet.js";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DIRECT_PUBLISH_PLATFORMS = new Set(["instagram", "facebook", "linkedin", "twitter"]);
const inFlightPostIds = new Set<string>();
let schedulerRunning = false;

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

async function runScheduledPublish(): Promise<void> {
  if (process.env.ENABLE_AUTO_PUBLISH === "false") {
    logger.info("Scheduler cycle skipped: ENABLE_AUTO_PUBLISH=false");
    return;
  }

  if (schedulerRunning) {
    logger.info("Scheduler cycle skipped: previous auto-publish cycle still running");
    return;
  }

  if (!isEncryptionConfigured()) {
    logger.warn("Scheduler skipped: TOKEN_ENCRYPTION_KEY not configured");
    return;
  }

  schedulerRunning = true;
  let due: (typeof postsTable.$inferSelect)[];

  try {
    const now = new Date();
    logger.info({ now: now.toISOString() }, "Scheduler cycle started");
    due = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.status, "scheduled"),
          lte(postsTable.scheduledAt, now),
          isNull(postsTable.publishedAt)
        )
      )
      .limit(20);
  } catch (err) {
    // DB unreachable (DNS failure, pooler down, etc.) — skip this cycle quietly
    if (isNetworkError(err)) {
      logger.warn({ error: safeErrMsg(err) }, "Scheduler: DB unreachable — skipping cycle");
    } else {
      logger.warn({ error: safeErrMsg(err) }, "Scheduler: failed to query due posts — skipping cycle");
    }
    schedulerRunning = false;
    return;
  }

  logger.info({ count: due.length }, "Scheduler: due posts found");

  for (const post of due) {
    if (inFlightPostIds.has(post.id)) {
      logger.info({ postId: post.id }, "Scheduler: post already in flight — skipping duplicate attempt");
      continue;
    }
    inFlightPostIds.add(post.id);
    try {
      const platform = normalizePlatform(post.platform);
      const safetyError = autoPublishErrorForPost(post, platform);
      if (safetyError) {
        await db
          .update(postsTable)
          .set({ status: "failed", publishError: safetyError, updatedAt: new Date() })
          .where(and(eq(postsTable.id, post.id), eq(postsTable.status, "scheduled"), isNull(postsTable.publishedAt)));
        logger.warn({ postId: post.id, platform, reason: safetyError }, "Scheduler: post blocked by safety guard");
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
        logger.warn({ postId: post.id, platform }, "Scheduler: no connected direct publishing account");
        continue;
      }

      const accessToken = await resolveAccessToken(account);
      const imageUrl = publishImageUrl(post);

      logger.info({ postId: post.id, platform, hasImage: !!imageUrl }, "Scheduler: publish attempted");

      const result = await publishToPlatform({
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
          publishedAt: result.publishedAt,
          publishedUrl: result.publishedUrl,
          contentSchema: publishMetadata(post, result),
          publishError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, post.id), eq(postsTable.status, "scheduled"), isNull(postsTable.publishedAt)));

      await writeClientMemory(post.clientId, "Performance Memory / Published post", `Scheduled publisher posted ${platform} post "${post.topic}". Treat this as an accepted final content direction.`)
        .catch((memoryErr: unknown) => {
          logger.warn({ postId: post.id, error: safeErrMsg(memoryErr) }, "Scheduler: publish succeeded but memory write failed");
        });

      logger.info({ postId: post.id, platform, publishedUrl: result.publishedUrl }, "Scheduler: post published");
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
      logger.warn({ postId: post.id, error: message }, "Scheduler: publish failed");
    } finally {
      inFlightPostIds.delete(post.id);
    }
  }

  schedulerRunning = false;
}

export function startScheduler(): void {
  if (process.env.ENABLE_AUTO_PUBLISH === "false") {
    logger.info("Scheduler disabled: ENABLE_AUTO_PUBLISH=false");
    return;
  }
  const INTERVAL_MS = 60_000;
  setInterval(runScheduledPublish, INTERVAL_MS);
  logger.info("Scheduler started (1-minute interval)");
}
