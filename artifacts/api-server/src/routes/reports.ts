import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { contentMemoryTable, postsTable, userSettingsTable } from "@workspace/db/schema";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import {
  generateTextWithFallback,
  resolveProviderAndModel,
  safeErrorMessage,
  toAiErrorResponse,
} from "../lib/ai-provider.js";
import { logger } from "../lib/logger.js";
import { createClientNotification } from "../lib/notifications.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();

type ReportPeriod = "this_month" | "last_month" | "custom";
type Metrics = {
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthRange(offset: 0 | -1): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start, end };
}

function reportRange(query: Record<string, unknown>): { period: ReportPeriod; start: Date; end: Date } {
  const period = query.period === "last_month" ? "last_month" : query.period === "custom" ? "custom" : "this_month";
  if (period === "custom") {
    const start = parseDate(query.startDate) ?? monthRange(0).start;
    const endInput = parseDate(query.endDate);
    const end = endInput ? new Date(endInput.getTime() + 24 * 60 * 60 * 1000) : monthRange(0).end;
    return { period, start, end };
  }
  return { period, ...monthRange(period === "last_month" ? -1 : 0) };
}

function postMetrics(post: typeof postsTable.$inferSelect): Metrics {
  const analytics = asRecord(asRecord(post.contentSchema).analytics);
  return {
    reach: numberValue(analytics.reach),
    impressions: numberValue(analytics.impressions),
    likes: numberValue(analytics.likes),
    comments: numberValue(analytics.comments),
    shares: numberValue(analytics.shares),
  };
}

function postPreviewUrl(post: typeof postsTable.$inferSelect): string {
  const schema = asRecord(post.contentSchema);
  return String(schema.finalArtworkUrl ?? schema.videoUrl ?? post.selectedImageUrl ?? post.brandedImageUrl ?? post.originalImageUrl ?? schema.imageUrl ?? "");
}

function within(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false;
  return date >= start && date < end;
}

function engagementRate(metrics: Metrics): number | null {
  const engagement = metrics.likes + metrics.comments + metrics.shares;
  const base = metrics.reach || metrics.impressions;
  return base > 0 ? Number(((engagement / base) * 100).toFixed(2)) : null;
}

function combineMetrics(posts: (typeof postsTable.$inferSelect)[]): Metrics {
  return posts.reduce(
    (acc, post) => {
      const metrics = postMetrics(post);
      acc.reach += metrics.reach;
      acc.impressions += metrics.impressions;
      acc.likes += metrics.likes;
      acc.comments += metrics.comments;
      acc.shares += metrics.shares;
      return acc;
    },
    { reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0 }
  );
}

function bestPlatform(posts: (typeof postsTable.$inferSelect)[]): string | null {
  const scores = new Map<string, { engagement: number; count: number }>();
  for (const post of posts) {
    const platform = post.platform ?? "social";
    const metrics = postMetrics(post);
    const current = scores.get(platform) ?? { engagement: 0, count: 0 };
    current.engagement += metrics.likes + metrics.comments + metrics.shares;
    current.count += 1;
    scores.set(platform, current);
  }
  const sorted = [...scores.entries()].sort((a, b) => (b[1].engagement || b[1].count) - (a[1].engagement || a[1].count));
  return sorted[0]?.[0] ?? null;
}

function countsBy(posts: (typeof postsTable.$inferSelect)[], selector: (post: typeof postsTable.$inferSelect) => string | null | undefined): Record<string, number> {
  return posts.reduce<Record<string, number>>((acc, post) => {
    const key = selector(post) || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function memoryList(entries: Array<typeof contentMemoryTable.$inferSelect>, terms: string[]): string[] {
  return entries
    .filter((entry) => {
      const text = `${entry.key} ${entry.value}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    })
    .map((entry) => entry.value)
    .slice(0, 8);
}

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  return settings ?? null;
}

async function buildRecommendations(clientId: string, userId: string | undefined, base: {
  periodLabel: string;
  publishedCount: number;
  scheduledCount: number;
  topTopics: string[];
  whatWorked: string[];
  whatDidNotWork: string[];
}) {
  const fallback = {
    recommendedTopics: base.topTopics.length ? base.topTopics : ["Proof-led customer stories", "Educational posts that answer buyer objections"],
    campaignIdeas: ["Next-month proof campaign", "Audience education series", "Platform-specific quick wins"],
    contentFormatsToTry: ["case study", "before/after", "myth vs fact", "behind the scenes"],
    platformSpecificSuggestions: ["Double down on the platform with the clearest engagement signal."],
    avoidRepeating: base.whatDidNotWork.slice(0, 5),
  };

  try {
    const packet = await buildClientMemoryPacket(clientId);
    const settings = await getUserSettings(userId);
    const { provider, model } = await resolveProviderAndModel(settings, userId);
    const prompt = `Create concise next-month client report recommendations from this agency context.

${formatClientMemoryPacket(packet)}

Report period: ${base.periodLabel}
Posts published: ${base.publishedCount}
Scheduled posts: ${base.scheduledCount}
What worked: ${base.whatWorked.join(" | ") || "Not enough data"}
What did not work: ${base.whatDidNotWork.join(" | ") || "Not enough data"}
Top topics: ${base.topTopics.join(", ") || "Not enough data"}

Return ONLY valid JSON:
{
  "recommendedTopics": ["string"],
  "campaignIdeas": ["string"],
  "contentFormatsToTry": ["string"],
  "platformSpecificSuggestions": ["string"],
  "avoidRepeating": ["string"]
}`;
    const { text } = await generateTextWithFallback(provider, model, prompt, 1800, userId);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = asRecord(JSON.parse(match[0]));
    const list = (key: string, fallbackItems: string[]) => Array.isArray(parsed[key])
      ? (parsed[key] as unknown[]).map(String).filter(Boolean).slice(0, 8)
      : fallbackItems;
    return {
      recommendedTopics: list("recommendedTopics", fallback.recommendedTopics),
      campaignIdeas: list("campaignIdeas", fallback.campaignIdeas),
      contentFormatsToTry: list("contentFormatsToTry", fallback.contentFormatsToTry),
      platformSpecificSuggestions: list("platformSpecificSuggestions", fallback.platformSpecificSuggestions),
      avoidRepeating: list("avoidRepeating", fallback.avoidRepeating),
    };
  } catch (err) {
    const { message } = toAiErrorResponse(err, "AI recommendations unavailable. Showing memory-based fallback.");
    logger.warn({ clientId, error: safeErrorMessage(err), message }, "Client report recommendations fallback used");
    return fallback;
  }
}

router.get("/clients/:clientId/reports/summary", async (req: AuthRequest, res): Promise<void> => {
  try {
    const { period, start, end } = reportRange(req.query as Record<string, unknown>);
    const [posts, memories] = await Promise.all([
      db
        .select()
        .from(postsTable)
        .where(eq(postsTable.clientId, req.params.clientId))
        .orderBy(desc(postsTable.updatedAt)),
      db
        .select()
        .from(contentMemoryTable)
        .where(eq(contentMemoryTable.clientId, req.params.clientId))
        .orderBy(desc(contentMemoryTable.createdAt)),
    ]);

    const publishedInPeriod = posts.filter((post) =>
      ["posted", "published"].includes(post.status) && within(post.publishedAt, start, end)
    );
    const scheduledInPeriod = posts.filter((post) =>
      inArrayStatus(post.status, ["approved", "export_ready", "scheduled"]) && within(post.scheduledAt, start, end)
    );
    const metrics = combineMetrics(publishedInPeriod);
    const createdInPeriod = posts.filter((post) => within(post.createdAt, start, end));
    const approvedInPeriod = posts.filter((post) => inArrayStatus(post.status, ["approved", "export_ready", "scheduled", "posted", "published"]) && within(post.updatedAt, start, end));
    const rejectedInPeriod = posts.filter((post) => post.status === "rejected" && within(post.updatedAt, start, end));
    const campaignCount = new Set(createdInPeriod.map((post) => post.campaignId).filter(Boolean)).size;
    const whatWorked = memoryList(memories, ["what worked", "best hooks", "historical top topics", "worked", "winning"]);
    const whatDidNotWork = memoryList(memories, ["what did not work", "weak", "avoid_repeat", "repetitive"]);
    const repeatRisks = memoryList(memories, ["repeat", "avoid"]);
    const topTopics = memoryList(memories, ["top topics", "related topics", "content_strategy"]).join(" | ").split(/,|\|/).map((item) => item.trim()).filter(Boolean).slice(0, 10);

    const periodLabel = `${start.toISOString().slice(0, 10)} to ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`;
    const recommendations = await buildRecommendations(req.params.clientId, req.userId, {
      periodLabel,
      publishedCount: publishedInPeriod.length,
      scheduledCount: scheduledInPeriod.length,
      topTopics,
      whatWorked,
      whatDidNotWork,
    });

    res.json({
      period,
      startDate: start.toISOString(),
      endDate: new Date(end.getTime() - 1).toISOString(),
      summary: {
        postsPublished: publishedInPeriod.length,
        scheduledPosts: scheduledInPeriod.length,
        totalReach: metrics.reach,
        totalImpressions: metrics.impressions,
        engagementRate: engagementRate(metrics),
        bestPerformingPlatform: bestPlatform(publishedInPeriod),
        draftsGenerated: createdInPeriod.length,
        approvedDrafts: approvedInPeriod.length,
        rejectedDrafts: rejectedInPeriod.length,
        campaignCount,
        platformMix: countsBy(createdInPeriod, (post) => post.platform),
        formatMix: countsBy(createdInPeriod, (post) => post.contentType ?? post.postType),
      },
      publishedPosts: publishedInPeriod.map((post) => ({
        id: post.id,
        platform: post.platform ?? "social",
        caption: post.caption,
        topic: post.topic,
        contentType: post.contentType,
        previewUrl: postPreviewUrl(post),
        publishedAt: post.publishedAt?.toISOString() ?? null,
        publishedUrl: post.publishedUrl,
        metrics: postMetrics(post),
      })),
      scheduledPosts: scheduledInPeriod.map((post) => ({
        id: post.id,
        platform: post.platform ?? "social",
        caption: post.caption,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
      })),
      insights: {
        whatWorked,
        whatDidNotWork,
        whyPerformanceMayBeWeak: memoryList(memories, ["why performance", "whynotperforming", "not performing", "weak"]),
        repeatRisks,
        topTopics,
        analyticsMissing: publishedInPeriod.length > 0 && metrics.reach === 0 && metrics.impressions === 0,
      },
      recommendations,
    });
  } catch (err) {
    logger.error({ clientId: req.params.clientId, error: safeErrorMessage(err) }, "Client report failed");
    await createClientNotification({
      clientId: req.params.clientId,
      userId: req.userId,
      type: "report_generation_failed",
      title: "Report generation failed",
      message: "The client report could not be built.",
      severity: "error",
      metadata: { error: safeErrorMessage(err) },
    });
    res.status(500).json({ error: "Failed to build client report" });
  }
});

function inArrayStatus(status: string, statuses: string[]): boolean {
  return statuses.includes(status);
}

export default router;
