import { db } from "@workspace/db";
import { postsTable, socialAccountsTable } from "@workspace/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { decryptToken, encryptToken, isEncryptionConfigured } from "./crypto.js";
import { publishToPlatform } from "./publishers/index.js";
import { logger } from "./logger.js";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function refreshAccountToken(
  account: typeof socialAccountsTable.$inferSelect
): Promise<string | null> {
  const platform = account.platform;

  try {
    if (platform === "facebook" || platform === "instagram") {
      const appId = process.env.FACEBOOK_APP_ID ?? process.env.INSTAGRAM_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
      if (!appId || !appSecret || !account.accessToken) return null;

      const currentToken = decryptToken(account.accessToken);
      const res = await fetch(
        `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(currentToken)}`
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

async function runScheduledPublish(): Promise<void> {
  if (!isEncryptionConfigured()) {
    logger.warn("Scheduler skipped: TOKEN_ENCRYPTION_KEY not configured");
    return;
  }

  try {
    const now = new Date();
    const due = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.status, "scheduled"),
          lte(postsTable.scheduledAt, now)
        )
      )
      .limit(20);

    if (due.length === 0) return;

    logger.info({ count: due.length }, "Scheduler: publishing due posts");

    for (const post of due) {
      try {
        const platform = post.platform ?? "instagram";

        const [account] = await db
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

        if (!account?.accessToken) {
          await db
            .update(postsTable)
            .set({
              status: "failed",
              publishError: `No active ${platform} account connected for this brand`,
              updatedAt: new Date(),
            })
            .where(eq(postsTable.id, post.id));
          continue;
        }

        const accessToken = await resolveAccessToken(account);

        const result = await publishToPlatform({
          caption: post.caption,
          hashtags: post.hashtags,
          imageUrl: post.selectedImageUrl,
          accountId: account.accountId ?? account.id,
          accessToken,
          platform,
        });

        await db
          .update(postsTable)
          .set({
            status: "published",
            publishedAt: result.publishedAt,
            publishedUrl: result.publishedUrl,
            publishError: null,
            updatedAt: new Date(),
          })
          .where(eq(postsTable.id, post.id));

        logger.info({ postId: post.id, platform }, "Scheduler: post published");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(postsTable)
          .set({
            status: "failed",
            publishError: message,
            updatedAt: new Date(),
          })
          .where(eq(postsTable.id, post.id));
        logger.warn({ postId: post.id, error: message }, "Scheduler: publish failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler: unexpected error");
  }
}

export function startScheduler(): void {
  const INTERVAL_MS = 60_000;
  setInterval(runScheduledPublish, INTERVAL_MS);
  logger.info("Scheduler started (1-minute interval)");
}
