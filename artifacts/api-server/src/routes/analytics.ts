import { Router } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { postsTable, socialAccountsTable } from "@workspace/db/schema";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { resolveAccessToken } from "../lib/scheduler.js";
import { logger } from "../lib/logger.js";
import { APPROVE_CONTENT_ROLES, requireClientRole } from "../middleware/auth.js";

const router = Router();

type PostMetrics = {
  reach?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagementRate?: number;
  fetchedAt?: string;
  source?: string;
  warning?: string;
};

type AnalyticsPostSummary = PostMetrics & {
  postId: string;
  platform: string;
  topic: string;
  caption: string;
  publishedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function engagementRate(metrics: PostMetrics): number | undefined {
  const engagement = (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0);
  const base = metrics.reach ?? metrics.impressions;
  if (!base || base <= 0) return undefined;
  return Number(((engagement / base) * 100).toFixed(2));
}

function normalizeMetrics(metrics: PostMetrics): PostMetrics {
  return {
    ...metrics,
    engagementRate: metrics.engagementRate ?? engagementRate(metrics),
    fetchedAt: metrics.fetchedAt ?? new Date().toISOString(),
  };
}

function storedMetrics(post: typeof postsTable.$inferSelect): PostMetrics {
  const schema = asRecord(post.contentSchema);
  const analytics = asRecord(schema.analytics);
  return normalizeMetrics({
    reach: numberValue(analytics.reach),
    impressions: numberValue(analytics.impressions),
    likes: numberValue(analytics.likes),
    comments: numberValue(analytics.comments),
    shares: numberValue(analytics.shares),
    engagementRate: numberValue(analytics.engagementRate),
    fetchedAt: typeof analytics.fetchedAt === "string" ? analytics.fetchedAt : undefined,
    source: typeof analytics.source === "string" ? analytics.source : undefined,
    warning: typeof analytics.warning === "string" ? analytics.warning : undefined,
  });
}

function storedPublish(post: typeof postsTable.$inferSelect): { platformPostId?: string; provider?: string } {
  const publish = asRecord(asRecord(post.contentSchema).publish);
  return {
    platformPostId: typeof publish.platformPostId === "string" ? publish.platformPostId : undefined,
    provider: typeof publish.provider === "string" ? publish.provider : undefined,
  };
}

function buildSummary(posts: (typeof postsTable.$inferSelect)[]) {
  const items: AnalyticsPostSummary[] = posts.map((post) => {
    const metrics = storedMetrics(post);
    return {
      postId: post.id,
      platform: post.platform ?? "instagram",
      topic: post.topic,
      caption: post.caption,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      ...metrics,
    };
  });

  const totals = items.reduce(
    (acc, item) => {
      acc.reach += item.reach ?? 0;
      acc.impressions += item.impressions ?? 0;
      acc.likes += item.likes ?? 0;
      acc.comments += item.comments ?? 0;
      acc.shares += item.shares ?? 0;
      return acc;
    },
    { reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0 }
  );
  const engagement = totals.likes + totals.comments + totals.shares;
  const base = totals.reach || totals.impressions;

  return {
    publishedPosts: posts.length,
    ...totals,
    engagementRate: base > 0 ? Number(((engagement / base) * 100).toFixed(2)) : null,
    posts: items,
  };
}

function metaGraphBaseUrl(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v18.0"}`;
}

function extractFacebookPostId(publishedUrl?: string | null, accountId?: string | null): string | null {
  if (!publishedUrl || !accountId) return null;
  const match = publishedUrl.match(/\/posts\/([^/?#]+)/);
  return match?.[1] ? `${accountId}_${match[1]}` : null;
}

function extractInstagramMediaId(publishedUrl?: string | null): string | null {
  if (!publishedUrl) return null;
  const match = publishedUrl.match(/\/p\/([^/?#]+)/);
  return match?.[1] && /^\d+$/.test(match[1]) ? match[1] : null;
}

function extractLinkedInUrn(publishedUrl?: string | null): string | null {
  if (!publishedUrl) return null;
  const match = publishedUrl.match(/\/feed\/update\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function extractTweetId(publishedUrl?: string | null): string | null {
  if (!publishedUrl) return null;
  return publishedUrl.match(/status\/([^/?#]+)/)?.[1] ?? null;
}

async function getJson(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Metrics API returned HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function fetchFacebookMetrics(post: typeof postsTable.$inferSelect, account: typeof socialAccountsTable.$inferSelect, accessToken: string): Promise<PostMetrics> {
  const postId = storedPublish(post).platformPostId ?? extractFacebookPostId(post.publishedUrl, account.accountId);
  if (!postId) return { warning: "Facebook post ID could not be derived from published URL." };
  const fields = "shares,comments.summary(true),reactions.summary(true),insights.metric(post_impressions,post_impressions_unique)";
  const data = asRecord(await getJson(`${metaGraphBaseUrl()}/${postId}?fields=${encodeURIComponent(fields)}`, accessToken));
  const insights = asRecord(data.insights);
  const insightRows = Array.isArray(insights.data) ? insights.data.map(asRecord) : [];
  const metricValue = (name: string) => {
    const row = insightRows.find((item) => item.name === name);
    const values = Array.isArray(row?.values) ? row.values.map(asRecord) : [];
    return numberValue(values[0]?.value);
  };
  return normalizeMetrics({
    reach: metricValue("post_impressions_unique"),
    impressions: metricValue("post_impressions"),
    likes: numberValue(asRecord(asRecord(data.reactions).summary).total_count),
    comments: numberValue(asRecord(asRecord(data.comments).summary).total_count),
    shares: numberValue(asRecord(data.shares).count),
    source: "facebook_graph",
  });
}

async function fetchInstagramMetrics(post: typeof postsTable.$inferSelect, _account: typeof socialAccountsTable.$inferSelect, accessToken: string): Promise<PostMetrics> {
  const mediaId = storedPublish(post).platformPostId ?? extractInstagramMediaId(post.publishedUrl);
  if (!mediaId) return { warning: "Instagram media ID is not stored yet. Publish again through the connector to save platformPostId." };
  const fields = "like_count,comments_count";
  const data = asRecord(await getJson(`${metaGraphBaseUrl()}/${mediaId}?fields=${encodeURIComponent(fields)}`, accessToken));
  let reach: number | undefined;
  let impressions: number | undefined;
  try {
    const insights = asRecord(await getJson(`${metaGraphBaseUrl()}/${mediaId}/insights?metric=reach,impressions`, accessToken));
    const rows = Array.isArray(insights.data) ? insights.data.map(asRecord) : [];
    const metricValue = (name: string) => {
      const row = rows.find((item) => item.name === name);
      const values = Array.isArray(row?.values) ? row.values.map(asRecord) : [];
      return numberValue(values[0]?.value);
    };
    reach = metricValue("reach");
    impressions = metricValue("impressions");
  } catch {
    // Some IG metrics vary by media type/account permission. Likes/comments still help.
  }
  return normalizeMetrics({
    reach,
    impressions,
    likes: numberValue(data.like_count),
    comments: numberValue(data.comments_count),
    shares: undefined,
    source: "instagram_graph",
  });
}

async function fetchTwitterMetrics(post: typeof postsTable.$inferSelect, _account: typeof socialAccountsTable.$inferSelect, accessToken: string): Promise<PostMetrics> {
  const tweetId = storedPublish(post).platformPostId ?? extractTweetId(post.publishedUrl);
  if (!tweetId) return { warning: "X/Twitter tweet ID could not be derived from published URL." };
  const data = asRecord(await getJson(`https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`, accessToken));
  const metrics = asRecord(asRecord(data.data).public_metrics);
  return normalizeMetrics({
    impressions: numberValue(metrics.impression_count),
    likes: numberValue(metrics.like_count),
    comments: numberValue(metrics.reply_count),
    shares: (numberValue(metrics.retweet_count) ?? 0) + (numberValue(metrics.quote_count) ?? 0),
    source: "twitter_public_metrics",
  });
}

async function fetchLinkedInMetrics(post: typeof postsTable.$inferSelect, _account: typeof socialAccountsTable.$inferSelect, accessToken: string): Promise<PostMetrics> {
  const urn = storedPublish(post).platformPostId ?? extractLinkedInUrn(post.publishedUrl);
  if (!urn) return { warning: "LinkedIn post URN could not be derived from published URL." };
  const data = asRecord(await getJson(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(urn)}`, accessToken));
  return normalizeMetrics({
    likes: numberValue(asRecord(data.likesSummary).totalLikes),
    comments: numberValue(asRecord(data.commentsSummary).aggregatedTotalComments),
    shares: undefined,
    source: "linkedin_social_actions",
    warning: "LinkedIn reach/impressions require additional organization/share statistics access.",
  });
}

async function fetchMetricsForPost(post: typeof postsTable.$inferSelect): Promise<PostMetrics> {
  const platform = post.platform ?? "instagram";
  const [account] = await db
    .select()
    .from(socialAccountsTable)
    .where(and(
      eq(socialAccountsTable.clientId, post.clientId),
      eq(socialAccountsTable.platform, platform),
      eq(socialAccountsTable.isActive, true),
      isNotNull(socialAccountsTable.accessToken)
    ))
    .limit(1);

  if (!account) return { warning: `No connected ${platform} account with token.` };
  const accessToken = await resolveAccessToken(account);
  if (platform === "facebook") return fetchFacebookMetrics(post, account, accessToken);
  if (platform === "instagram") return fetchInstagramMetrics(post, account, accessToken);
  if (platform === "twitter") return fetchTwitterMetrics(post, account, accessToken);
  if (platform === "linkedin") return fetchLinkedInMetrics(post, account, accessToken);
  return { warning: `${platform} analytics are not implemented yet.` };
}

async function publishedPosts(clientId: string) {
  return db
    .select()
    .from(postsTable)
    .where(and(
      eq(postsTable.clientId, clientId),
      inArray(postsTable.status, ["posted", "published"]),
      isNotNull(postsTable.publishedAt)
    ))
    .limit(50);
}

router.get("/clients/:clientId/analytics/summary", async (req, res): Promise<void> => {
  try {
    const posts = await publishedPosts(req.params.clientId);
    res.json(buildSummary(posts));
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Analytics summary failed");
    res.status(500).json({ error: "Failed to load analytics summary" });
  }
});

router.post("/clients/:clientId/analytics/refresh", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  if (!isEncryptionConfigured()) {
    res.status(503).json({ error: "Token encryption is not configured. Metrics refresh requires safely stored connector tokens." });
    return;
  }
  try {
    const posts = await publishedPosts(req.params.clientId);
    const refreshed = [];
    for (const post of posts.slice(0, 20)) {
      const metrics = await fetchMetricsForPost(post).catch((err: unknown) => ({
        warning: err instanceof Error ? err.message : "Metrics fetch failed.",
      }));
      const nextSchema = {
        ...asRecord(post.contentSchema),
        analytics: normalizeMetrics(metrics),
      };
      const [updated] = await db
        .update(postsTable)
        .set({ contentSchema: nextSchema, updatedAt: new Date() })
        .where(and(eq(postsTable.id, post.id), eq(postsTable.clientId, req.params.clientId)))
        .returning();
      refreshed.push(updated ?? post);
    }
    res.json(buildSummary(refreshed));
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Analytics refresh failed");
    res.status(500).json({ error: "Failed to refresh analytics metrics" });
  }
});

export default router;
