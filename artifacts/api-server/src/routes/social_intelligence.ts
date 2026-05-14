import { Router } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { contentMemoryTable, socialAccountsTable, userSettingsTable } from "@workspace/db/schema";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { resolveAccessToken } from "../lib/scheduler.js";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import {
  generateTextWithFallback,
  resolveProviderAndModel,
  safeErrorMessage,
  toAiErrorResponse,
} from "../lib/ai-provider.js";
import { logger } from "../lib/logger.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";

const router = Router();

type SupportedPlatform = "instagram" | "facebook" | "linkedin" | "twitter" | "youtube";
type ImportPost = {
  id: string;
  platform: Exclude<SupportedPlatform, "youtube">;
  text: string;
  createdAt?: string;
  permalink?: string;
  format?: string;
  metrics?: {
    reach?: number;
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
  };
};

type PlatformAnalysis = {
  platform: SupportedPlatform;
  contentVolume: number;
  topTopics: string[];
  weakTopics: string[];
  bestHooks: string[];
  weakHooks: string[];
  formatPatterns: string[];
  postingConsistencyNotes: string;
  engagementObservations: string;
  whyPerformanceMayBeWeak: string[];
  repeatRisks: string[];
  visualStyleObservations: string[];
  audienceSignals: string[];
};

type RecommendationView = {
  recommendedTopics: string[];
  relatedTopicClusters: string[];
  campaignAngles: string[];
  contentFormatsToTry: string[];
  platformSpecificRecommendations: Record<string, string[]>;
  postingFrequencySuggestion: string;
  visualStyleRecommendations: string[];
  hooksToTry: string[];
  ctasToTry: string[];
  avoidRepeating: string[];
};

type SocialIntelligenceResult = {
  platforms: PlatformAnalysis[];
  recommendation: RecommendationView;
  historicalView: {
    summary: string;
    whatWorked: string[];
    whatDidNotWork: string[];
    whyNotPerforming: string[];
    contentGaps: string[];
    platformGaps: string[];
  };
  recommendationView: {
    nextBestTopics: string[];
    relatedTopics: string[];
    campaignIdeas: string[];
    quickWins: string[];
    longTermStrategy: string[];
  };
  memoryEntries: Array<{ key: string; value: string }>;
};

const SUPPORTED_PLATFORMS: SupportedPlatform[] = ["instagram", "facebook", "linkedin", "twitter", "youtube"];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function firstSentence(text: string): string {
  return text.replace(/\s+/g, " ").split(/[.!?\n]/).map((part) => part.trim()).find((part) => part.length > 10) ?? text.slice(0, 100);
}

function hookFrom(text: string): string {
  const line = text.split(/\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.slice(0, 120);
}

function tokensFrom(posts: ImportPost[]): string[] {
  const stop = new Set(["this", "that", "with", "from", "your", "you", "are", "and", "for", "the", "our", "their", "have", "more", "about", "will", "into", "not", "but"]);
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const token of post.text.toLowerCase().match(/\b[a-z][a-z0-9-]{3,24}\b/g) ?? []) {
      if (stop.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word);
}

function scorePost(post: ImportPost): number {
  return (post.metrics?.reach ?? post.metrics?.impressions ?? 0) * 0.01
    + (post.metrics?.likes ?? 0)
    + (post.metrics?.comments ?? 0) * 3
    + (post.metrics?.shares ?? 0) * 4;
}

function deterministicAnalysis(postsByPlatform: Record<string, ImportPost[]>): SocialIntelligenceResult {
  const platformAnalyses = Object.entries(postsByPlatform).map(([platform, posts]) => {
    const sorted = [...posts].sort((a, b) => scorePost(b) - scorePost(a));
    const top = sorted.slice(0, 3);
    const weak = sorted.slice(-3).reverse();
    const topics = tokensFrom(posts);
    return {
      platform: platform as SupportedPlatform,
      contentVolume: posts.length,
      topTopics: topics.slice(0, 5),
      weakTopics: weak.map((post) => firstSentence(post.text)).filter(Boolean),
      bestHooks: top.map((post) => hookFrom(post.text)).filter(Boolean),
      weakHooks: weak.map((post) => hookFrom(post.text)).filter(Boolean),
      formatPatterns: [...new Set(posts.map((post) => post.format).filter(Boolean) as string[])].slice(0, 5),
      postingConsistencyNotes: posts.length >= 10 ? "Enough recent content exists to assess cadence directionally." : "Recent content volume is low, so cadence learnings are limited.",
      engagementObservations: top.length ? `Highest scoring posts appear to center on: ${topics.slice(0, 4).join(", ") || "clear practical topics"}.` : "No engagement pattern available.",
      whyPerformanceMayBeWeak: ["Hooks may be too similar across posts.", "Content mix may need clearer educational, proof, and offer angles."],
      repeatRisks: topics.slice(0, 3).map((topic) => `Avoid repeating ${topic} without a new angle.`),
      visualStyleObservations: ["Use recent top posts as visual reference; raw visual history was not stored."],
      audienceSignals: topics.slice(0, 4),
    };
  });

  const allTopics = tokensFrom(Object.values(postsByPlatform).flat());
  const recommended = allTopics.slice(0, 6).map((topic) => `${topic} with a sharper proof, education, or customer outcome angle`);
  return {
    platforms: platformAnalyses,
    recommendation: {
      recommendedTopics: recommended,
      relatedTopicClusters: allTopics.slice(0, 6),
      campaignAngles: ["Customer proof series", "Educational objection-handling series", "Behind-the-brand trust series"],
      contentFormatsToTry: ["before/after", "myth vs fact", "case study", "founder point of view"],
      platformSpecificRecommendations: Object.fromEntries(platformAnalyses.map((item) => [item.platform, item.topTopics.slice(0, 3)])),
      postingFrequencySuggestion: "Publish consistently enough to test repeatable themes, then compare hooks and formats.",
      visualStyleRecommendations: ["Make the winning visual pattern more consistent across campaigns."],
      hooksToTry: ["What most people miss about...", "Before you choose...", "The simple way to avoid..."],
      ctasToTry: ["Save this for later", "Ask us before you decide", "Book a quick review"],
      avoidRepeating: platformAnalyses.flatMap((item) => item.repeatRisks).slice(0, 8),
    },
    historicalView: {
      summary: `Analyzed ${Object.values(postsByPlatform).flat().length} recent connected social posts.`,
      whatWorked: platformAnalyses.flatMap((item) => item.bestHooks).slice(0, 8),
      whatDidNotWork: platformAnalyses.flatMap((item) => item.weakHooks).slice(0, 8),
      whyNotPerforming: ["Weak hooks, repetitive topics, inconsistent format testing, or missing proof may be limiting performance."],
      contentGaps: ["More proof-led content", "More direct audience problem education", "More platform-specific format variation"],
      platformGaps: platformAnalyses.filter((item) => item.contentVolume < 5).map((item) => `${item.platform}: low recent content volume`),
    },
    recommendationView: {
      nextBestTopics: recommended,
      relatedTopics: allTopics.slice(0, 10),
      campaignIdeas: ["Trust-building proof campaign", "Audience education campaign", "Objection-handling campaign"],
      quickWins: ["Rewrite hooks to be more specific", "Turn top topics into a short series", "Add clearer CTA variation"],
      longTermStrategy: ["Build recurring campaigns from proven topic clusters and retire repetitive weak angles."],
    },
    memoryEntries: [],
  };
}

function buildMemoryEntries(result: SocialIntelligenceResult): Array<{ key: string; value: string }> {
  return [
    { key: "Social Intelligence / performance / historical top topics", value: result.platforms.flatMap((p) => p.topTopics).slice(0, 10).join(", ") },
    { key: "Social Intelligence / avoid_repeat / weak or repetitive topics", value: result.platforms.flatMap((p) => [...p.weakTopics, ...p.repeatRisks]).slice(0, 8).join(" | ") },
    { key: "Social Intelligence / performance / best hooks", value: result.platforms.flatMap((p) => p.bestHooks).slice(0, 6).join(" | ") },
    { key: "Social Intelligence / content_strategy / related topics to explore", value: result.recommendationView.relatedTopics.slice(0, 10).join(", ") },
    { key: "Social Intelligence / content_strategy / recommended campaign angles", value: result.recommendationView.campaignIdeas.slice(0, 6).join(" | ") },
    { key: "Social Intelligence / visual_style / observations", value: result.platforms.flatMap((p) => p.visualStyleObservations).slice(0, 6).join(" | ") },
    { key: "Social Intelligence / platform_learning / recommendations", value: Object.entries(result.recommendation.platformSpecificRecommendations).map(([platform, items]) => `${platform}: ${items.join(", ")}`).join(" | ") },
    { key: "Social Intelligence / avoid_repeat / what to avoid", value: result.recommendation.avoidRepeating.slice(0, 8).join(" | ") },
  ].filter((entry) => entry.value.trim());
}

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  return settings ?? null;
}

async function getJson(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Platform API returned HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v18.0"}`;
}

async function fetchInstagramHistory(account: typeof socialAccountsTable.$inferSelect, accessToken: string, limit: number): Promise<ImportPost[]> {
  const data = asRecord(await getJson(`${graphBase()}/${account.accountId ?? account.id}/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count&limit=${limit}`, accessToken));
  return asArray(data.data).map(asRecord).map((item) => ({
    id: String(item.id ?? ""),
    platform: "instagram" as const,
    text: String(item.caption ?? ""),
    createdAt: typeof item.timestamp === "string" ? item.timestamp : undefined,
    permalink: typeof item.permalink === "string" ? item.permalink : undefined,
    format: typeof item.media_type === "string" ? item.media_type : undefined,
    metrics: { likes: numberValue(item.like_count), comments: numberValue(item.comments_count) },
  })).filter((post) => post.id && post.text);
}

async function fetchFacebookHistory(account: typeof socialAccountsTable.$inferSelect, accessToken: string, limit: number): Promise<ImportPost[]> {
  const fields = "id,message,created_time,permalink_url,shares,comments.summary(true),reactions.summary(true)";
  const data = asRecord(await getJson(`${graphBase()}/${account.accountId ?? account.id}/posts?fields=${encodeURIComponent(fields)}&limit=${limit}`, accessToken));
  return asArray(data.data).map(asRecord).map((item) => ({
    id: String(item.id ?? ""),
    platform: "facebook" as const,
    text: String(item.message ?? ""),
    createdAt: typeof item.created_time === "string" ? item.created_time : undefined,
    permalink: typeof item.permalink_url === "string" ? item.permalink_url : undefined,
    format: "feed_post",
    metrics: {
      likes: numberValue(asRecord(asRecord(item.reactions).summary).total_count),
      comments: numberValue(asRecord(asRecord(item.comments).summary).total_count),
      shares: numberValue(asRecord(item.shares).count),
    },
  })).filter((post) => post.id && post.text);
}

async function fetchTwitterHistory(account: typeof socialAccountsTable.$inferSelect, accessToken: string, limit: number): Promise<ImportPost[]> {
  if (!account.accountId) throw new Error("X/Twitter account ID is missing.");
  const maxResults = Math.max(5, Math.min(100, limit));
  const data = asRecord(await getJson(`https://api.twitter.com/2/users/${account.accountId}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics`, accessToken));
  return asArray(data.data).map(asRecord).map((item) => {
    const metrics = asRecord(item.public_metrics);
    return {
      id: String(item.id ?? ""),
      platform: "twitter" as const,
      text: String(item.text ?? ""),
      createdAt: typeof item.created_at === "string" ? item.created_at : undefined,
      permalink: item.id ? `https://twitter.com/i/web/status/${item.id}` : undefined,
      format: "tweet",
      metrics: {
        impressions: numberValue(metrics.impression_count),
        likes: numberValue(metrics.like_count),
        comments: numberValue(metrics.reply_count),
        shares: (numberValue(metrics.retweet_count) ?? 0) + (numberValue(metrics.quote_count) ?? 0),
      },
    };
  }).filter((post) => post.id && post.text);
}

async function fetchLinkedInHistory(account: typeof socialAccountsTable.$inferSelect, accessToken: string, limit: number): Promise<ImportPost[]> {
  if (!account.accountId) throw new Error("LinkedIn account ID is missing.");
  const author = encodeURIComponent(`urn:li:person:${account.accountId}`);
  const data = asRecord(await getJson(`https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(${author})&count=${limit}`, accessToken));
  return asArray(data.elements).map(asRecord).map((item) => {
    const content = asRecord(asRecord(asRecord(item.specificContent)["com.linkedin.ugc.ShareContent"]).shareCommentary);
    const created = asRecord(item.created);
    const createdTime = numberValue(created.time);
    return {
      id: String(item.id ?? ""),
      platform: "linkedin" as const,
      text: String(content.text ?? ""),
      createdAt: createdTime ? new Date(createdTime).toISOString() : undefined,
      permalink: item.id ? `https://www.linkedin.com/feed/update/${encodeURIComponent(String(item.id))}/` : undefined,
      format: "ugc_post",
      metrics: {},
    };
  }).filter((post) => post.id && post.text);
}

async function fetchPlatformHistory(account: typeof socialAccountsTable.$inferSelect, limit: number): Promise<ImportPost[]> {
  const accessToken = await resolveAccessToken(account);
  if (account.platform === "instagram") return fetchInstagramHistory(account, accessToken, limit);
  if (account.platform === "facebook") return fetchFacebookHistory(account, accessToken, limit);
  if (account.platform === "twitter") return fetchTwitterHistory(account, accessToken, limit);
  if (account.platform === "linkedin") return fetchLinkedInHistory(account, accessToken, limit);
  return [];
}

function parseAiResult(text: string, fallback: SocialIntelligenceResult): SocialIntelligenceResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  const parsed = asRecord(JSON.parse(match[0]));
  const historical = asRecord(parsed.historicalView);
  const recommendation = asRecord(parsed.recommendationView);
  return {
    ...fallback,
    historicalView: {
      summary: String(historical.summary ?? fallback.historicalView.summary),
      whatWorked: cleanList(historical.whatWorked).length ? cleanList(historical.whatWorked) : fallback.historicalView.whatWorked,
      whatDidNotWork: cleanList(historical.whatDidNotWork).length ? cleanList(historical.whatDidNotWork) : fallback.historicalView.whatDidNotWork,
      whyNotPerforming: cleanList(historical.whyNotPerforming).length ? cleanList(historical.whyNotPerforming) : fallback.historicalView.whyNotPerforming,
      contentGaps: cleanList(historical.contentGaps).length ? cleanList(historical.contentGaps) : fallback.historicalView.contentGaps,
      platformGaps: cleanList(historical.platformGaps).length ? cleanList(historical.platformGaps) : fallback.historicalView.platformGaps,
    },
    recommendationView: {
      nextBestTopics: cleanList(recommendation.nextBestTopics).length ? cleanList(recommendation.nextBestTopics) : fallback.recommendationView.nextBestTopics,
      relatedTopics: cleanList(recommendation.relatedTopics).length ? cleanList(recommendation.relatedTopics) : fallback.recommendationView.relatedTopics,
      campaignIdeas: cleanList(recommendation.campaignIdeas).length ? cleanList(recommendation.campaignIdeas) : fallback.recommendationView.campaignIdeas,
      quickWins: cleanList(recommendation.quickWins).length ? cleanList(recommendation.quickWins) : fallback.recommendationView.quickWins,
      longTermStrategy: cleanList(recommendation.longTermStrategy).length ? cleanList(recommendation.longTermStrategy) : fallback.recommendationView.longTermStrategy,
    },
  };
}

async function analyzeWithAi(clientId: string, userId: string | undefined, postsByPlatform: Record<string, ImportPost[]>, fallback: SocialIntelligenceResult): Promise<SocialIntelligenceResult> {
  const packet = await buildClientMemoryPacket(clientId);
  const settings = await getUserSettings(userId);
  const { provider, model } = await resolveProviderAndModel(settings, userId);
  const history = Object.entries(postsByPlatform).map(([platform, posts]) => ({
    platform,
    posts: posts.slice(0, 25).map((post) => ({
      text: post.text.slice(0, 400),
      format: post.format,
      metrics: post.metrics,
      createdAt: post.createdAt,
    })),
  }));
  const prompt = `You are a senior social strategist. Analyze connected historical social posts and produce concise strategy.

Use the Brand DNA, AI Memory, active storyline, and recent posts context:
${formatClientMemoryPacket(packet)}

Historical social posts:
${JSON.stringify(history, null, 2)}

Return ONLY valid JSON:
{
  "historicalView": {
    "summary": "string",
    "whatWorked": ["string"],
    "whatDidNotWork": ["string"],
    "whyNotPerforming": ["string"],
    "contentGaps": ["string"],
    "platformGaps": ["string"]
  },
  "recommendationView": {
    "nextBestTopics": ["string"],
    "relatedTopics": ["string"],
    "campaignIdeas": ["string"],
    "quickWins": ["string"],
    "longTermStrategy": ["string"]
  }
}

Be specific, strategic, and avoid fake certainty.`;

  const { text } = await generateTextWithFallback(provider, model, prompt, 3000, userId);
  return parseAiResult(text, fallback);
}

router.post("/clients/:clientId/social/intelligence/import", requireClientRole(EDIT_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  const body = asRecord(req.body);
  const requestedPlatforms = Array.isArray(body.platforms)
    ? body.platforms.map(String).filter((platform: string): platform is SupportedPlatform => SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform))
    : SUPPORTED_PLATFORMS;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const skipped: Array<{ platform: string; reason: string }> = [];
  const postsByPlatform: Record<string, ImportPost[]> = {};

  if (requestedPlatforms.includes("youtube")) {
    skipped.push({ platform: "youtube", reason: "YouTube import coming later. TODO: YouTube Data API + YouTube Analytics API." });
  }

  try {
    if (!isEncryptionConfigured()) {
      res.status(503).json({ error: "Token encryption is not configured. Social intelligence import requires safely stored connector tokens." });
      return;
    }

    const importablePlatforms = requestedPlatforms.filter((platform: SupportedPlatform) => platform !== "youtube");
    const accounts = importablePlatforms.length
      ? await db
        .select()
        .from(socialAccountsTable)
        .where(and(
          eq(socialAccountsTable.clientId, req.params.clientId),
          eq(socialAccountsTable.isActive, true),
          inArray(socialAccountsTable.platform, importablePlatforms),
          isNotNull(socialAccountsTable.accessToken)
        ))
      : [];

    for (const platform of importablePlatforms) {
      const account = accounts.find((item) => item.platform === platform);
      if (!account) {
        skipped.push({ platform, reason: `${platform} not connected` });
        continue;
      }
      if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now()) {
        skipped.push({ platform, reason: `${platform} token expired. Reconnect the account.` });
        continue;
      }
      try {
        postsByPlatform[platform] = await fetchPlatformHistory(account, limit);
        if (postsByPlatform[platform].length === 0) {
          skipped.push({ platform, reason: `${platform} returned no readable recent posts.` });
        }
      } catch (err) {
        skipped.push({ platform, reason: err instanceof Error ? err.message : `${platform} import failed` });
        logger.warn({ clientId: req.params.clientId, platform, error: safeErrorMessage(err) }, "Social intelligence platform import failed");
      }
    }

    const fallback = deterministicAnalysis(postsByPlatform);
    let intelligence = fallback;
    if (Object.values(postsByPlatform).flat().length > 0) {
      try {
        intelligence = await analyzeWithAi(req.params.clientId, req.userId, postsByPlatform, fallback);
      } catch (err) {
        const { message } = toAiErrorResponse(err, "AI analysis failed. Showing deterministic social intelligence fallback.");
        skipped.push({ platform: "ai_analysis", reason: message });
      }
    }

    const memoryEntries = buildMemoryEntries(intelligence);
    if (memoryEntries.length) {
      await db.insert(contentMemoryTable).values(memoryEntries.map((entry) => ({
        clientId: req.params.clientId,
        key: entry.key,
        value: entry.value.slice(0, 1800),
      })));
    }

    res.json({
      importedPosts: Object.values(postsByPlatform).flat().length,
      platformsAnalyzed: Object.keys(postsByPlatform).filter((platform) => postsByPlatform[platform]?.length),
      skipped,
      historicalView: intelligence.historicalView,
      recommendationView: intelligence.recommendationView,
      platformAnalysis: intelligence.platforms,
      recommendations: intelligence.recommendation,
      memoryEntries,
    });
  } catch (err) {
    logger.error({ clientId: req.params.clientId, error: safeErrorMessage(err) }, "Social intelligence import failed");
    res.status(500).json({ error: "Failed to import and analyze social intelligence" });
  }
});

export default router;
