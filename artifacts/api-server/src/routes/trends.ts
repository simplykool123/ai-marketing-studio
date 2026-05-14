import { Router } from "express";
import { buildClientMemoryPacket, formatClientMemoryPacket, writeClientMemory } from "../lib/client-memory-packet.js";
import { generateTextWithFallback, safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
import { logger } from "../lib/logger.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";

const router = Router();

type TrendPlatform = "instagram" | "facebook" | "linkedin" | "x" | "youtube" | "google";
type Confidence = "high" | "medium" | "low";
type BrandFit = "strong" | "moderate" | "weak";

type TrendSignal = {
  source: "google" | "youtube" | "social_memory" | "manual" | "web";
  topic: string;
  whyItMatters: string;
  confidence: Confidence;
  platformFit: string[];
  brandFit: BrandFit;
  riskNotes: string;
};

type ContentOpportunity = {
  idea: string;
  format: "image_post" | "reel" | "carousel" | "linkedin_post" | "story" | "video";
  platform: string;
  hook: string;
  visualDirection: string;
  captionAngle: string;
  cta: string;
  whyItCouldWork: string;
  trendSource: string;
  brandFitNotes: string;
};

type TrendResearchResult = {
  trendSummary: string;
  trendSignals: TrendSignal[];
  contentOpportunities: ContentOpportunity[];
  nextWeekPlan: string[];
  avoidThese: string[];
  recommendedAudiosOrStyles: Array<{
    name: string;
    platform: string;
    confidence: Confidence;
    note: string;
  }>;
  sourceStatus?: Record<string, string>;
};

type PublicSignal = {
  source: "google" | "youtube" | "manual" | "social_memory";
  topic: string;
  url?: string;
  publishedAt?: string;
  note: string;
};

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function safeJson<T>(raw: string): T | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function normalizePlatforms(value: unknown): TrendPlatform[] {
  const allowed = new Set<TrendPlatform>(["instagram", "facebook", "linkedin", "x", "youtube", "google"]);
  const list = Array.isArray(value) ? value : ["instagram", "linkedin", "google"];
  return list.filter((item): item is TrendPlatform => allowed.has(item as TrendPlatform)).slice(0, 6);
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AI-Marketing-Studio/1.0" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoogleNewsSignals(query: string, region: string): Promise<PublicSignal[]> {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: region || "US",
    ceid: `${region || "US"}:en`,
  });
  const res = await fetchWithTimeout(`https://news.google.com/rss/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Google News RSS returned HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => ({
    source: "google" as const,
    topic: extractTag(match[1], "title"),
    url: extractTag(match[1], "link"),
    publishedAt: extractTag(match[1], "pubDate"),
    note: extractTag(match[1], "description").slice(0, 220),
  })).filter((item) => item.topic);
}

async function fetchYoutubeSignals(query: string): Promise<PublicSignal[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    order: "relevance",
    maxResults: "5",
    key,
  });
  const res = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!res.ok) throw new Error(`YouTube search returned HTTP ${res.status}`);
  const data = await res.json() as { items?: Array<{ snippet?: { title?: string; description?: string; publishedAt?: string } }> };
  return (data.items ?? []).map((item) => ({
    source: "youtube" as const,
    topic: item.snippet?.title ?? "",
    publishedAt: item.snippet?.publishedAt,
    note: item.snippet?.description?.slice(0, 220) ?? "YouTube keyword search result; verify trend strength manually.",
  })).filter((item) => item.topic);
}

function socialMemorySignals(packet: Awaited<ReturnType<typeof buildClientMemoryPacket>>): PublicSignal[] {
  return packet.memoryEntries
    .filter((entry) => /social intelligence|performance|best hooks|top topics|visual_style|avoid_repeat/i.test(`${entry.key} ${entry.value}`))
    .slice(0, 8)
    .map((entry) => ({
      source: "social_memory" as const,
      topic: entry.key.replace(/^Social Intelligence\s*\/\s*/i, ""),
      note: entry.value.slice(0, 260),
    }));
}

function fallbackResult(signals: PublicSignal[], platforms: TrendPlatform[], topicHint?: string): TrendResearchResult {
  const firstTopics = signals.slice(0, 6).map((signal) => signal.topic).filter(Boolean);
  return {
    trendSummary: firstTopics.length
      ? `Found current public and memory signals around ${firstTopics.slice(0, 3).join(", ")}. Treat these as directional, not exact platform trend rankings.`
      : "No live public trend feed returned enough signal. Use the topic hint, Brand DNA, and Social Intelligence memory directionally.",
    trendSignals: signals.slice(0, 8).map((signal) => ({
      source: signal.source === "manual" ? "manual" : signal.source,
      topic: signal.topic,
      whyItMatters: signal.note || "Relevant directional signal for content planning.",
      confidence: signal.source === "google" || signal.source === "social_memory" ? "medium" : "low",
      platformFit: platforms.filter((platform) => platform !== "google"),
      brandFit: "moderate",
      riskNotes: "Verify exact trend strength and platform-native formats before publishing.",
    })),
    contentOpportunities: firstTopics.slice(0, 4).map((topic, index) => ({
      idea: `Adapt "${topic}" into a brand-safe educational or proof-led post`,
      format: index % 2 === 0 ? "carousel" : "image_post",
      platform: platforms.find((platform) => platform !== "google") ?? "instagram",
      hook: topicHint ? `What ${topicHint} buyers should know about ${topic}` : `What your audience should know about ${topic}`,
      visualDirection: "Use brand colors, a clear hero image, and minimal text.",
      captionAngle: "Connect the trend to a practical audience problem without copying the original format.",
      cta: "Save this before your next decision.",
      whyItCouldWork: "It links a current signal to existing brand expertise.",
      trendSource: signals[index]?.source ?? "manual",
      brandFitNotes: "Moderate fit until reviewed against Brand DNA.",
    })),
    nextWeekPlan: firstTopics.slice(0, 4).map((topic) => `Create one brand-safe post around ${topic}.`),
    avoidThese: ["Do not claim a topic is viral unless verified in the platform.", "Avoid trending audio or meme formats unless checked manually."],
    recommendedAudiosOrStyles: [
      {
        name: "Platform-native trending audio",
        platform: "instagram",
        confidence: "low",
        note: "Use only if verified manually inside Instagram or TikTok before publishing.",
      },
    ],
  };
}

function buildTrendPrompt(params: {
  context: string;
  industry: string;
  region: string;
  platforms: TrendPlatform[];
  timeWindow: string;
  contentGoal: string;
  topicHint: string;
  signals: PublicSignal[];
  sourceStatus: Record<string, string>;
}): string {
  return `You are a senior social strategist. Build brand-safe trend intelligence from ONLY the evidence below.

${params.context}

## Request
Industry: ${params.industry}
Region: ${params.region}
Platforms: ${params.platforms.join(", ")}
Time window: ${params.timeWindow}
Content goal: ${params.contentGoal}
Topic hint: ${params.topicHint || "none"}

## Public and Client Signals
${params.signals.length ? params.signals.map((signal, index) => `${index + 1}. [${signal.source}] ${signal.topic}${signal.publishedAt ? ` (${signal.publishedAt})` : ""} - ${signal.note}${signal.url ? ` URL: ${signal.url}` : ""}`).join("\n") : "No public feed returned usable signals."}

## Source Status
${Object.entries(params.sourceStatus).map(([source, status]) => `- ${source}: ${status}`).join("\n")}

## Rules
- Do not fake trends, songs, stats, rankings, or platform-native signals.
- If a source is not connected, say so in risk notes or limitations.
- Google News/RSS is current web/news signal, not proof of exact platform trend volume.
- YouTube keyword search is a search signal, not proof of trending rank.
- Use Social Intelligence memory as historical client behavior, not public trend proof.
- Judge brand fit, cringe/copycat risk, local/regional context, and platform fit.
- Provide practical ideas for this week and next week.
- Recommended audios/styles must be low confidence unless an actual connected source proves them.

Return ONLY valid JSON:
{
  "trendSummary": "",
  "trendSignals": [
    {
      "source": "google | youtube | social_memory | manual | web",
      "topic": "",
      "whyItMatters": "",
      "confidence": "high | medium | low",
      "platformFit": ["instagram", "linkedin"],
      "brandFit": "strong | moderate | weak",
      "riskNotes": ""
    }
  ],
  "contentOpportunities": [
    {
      "idea": "",
      "format": "image_post | reel | carousel | linkedin_post | story | video",
      "platform": "",
      "hook": "",
      "visualDirection": "",
      "captionAngle": "",
      "cta": "",
      "whyItCouldWork": "",
      "trendSource": "",
      "brandFitNotes": ""
    }
  ],
  "nextWeekPlan": [],
  "avoidThese": [],
  "recommendedAudiosOrStyles": [
    {
      "name": "",
      "platform": "",
      "confidence": "low | medium | high",
      "note": "Use only if verified manually"
    }
  ]
}`;
}

router.post(
  "/clients/:clientId/trends/research",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const platforms = normalizePlatforms(req.body?.platforms);
    const industry = cleanText(req.body?.industry);
    const region = cleanText(req.body?.region, "US");
    const timeWindow = cleanText(req.body?.timeWindow, "this_week");
    const contentGoal = cleanText(req.body?.contentGoal, "awareness");
    const topicHint = cleanText(req.body?.topicHint);

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const effectiveIndustry = industry || packet.client?.industry || packet.brandDna?.usp || "marketing";
      const query = [topicHint, effectiveIndustry, timeWindow === "next_week" ? "upcoming" : "trend"].filter(Boolean).join(" ");
      const sourceStatus: Record<string, string> = {
        google: "Google News RSS queried for current public topic signals.",
        youtube: process.env.YOUTUBE_API_KEY ? "YouTube keyword search queried." : "Platform trend source not connected: set YOUTUBE_API_KEY to use YouTube search signals.",
        instagram: "Platform-native trending audio/feed source not connected. Verify manually in app before publishing.",
        tiktok: "Not connected in V1. Verify trending audio and meme formats manually.",
        social_memory: "Client Social Intelligence and AI Memory loaded when available.",
      };

      const [googleSignalsResult, youtubeSignalsResult] = await Promise.allSettled([
        fetchGoogleNewsSignals(query, region),
        platforms.includes("youtube") ? fetchYoutubeSignals(query) : Promise.resolve([]),
      ]);

      const publicSignals: PublicSignal[] = [];
      if (topicHint) {
        publicSignals.push({ source: "manual", topic: topicHint, note: "User-provided topic hint for directional research." });
      }
      if (googleSignalsResult.status === "fulfilled") {
        publicSignals.push(...googleSignalsResult.value);
      } else {
        sourceStatus.google = `Google News RSS unavailable: ${safeErrorMessage(googleSignalsResult.reason)}`;
      }
      if (youtubeSignalsResult.status === "fulfilled") {
        publicSignals.push(...youtubeSignalsResult.value);
      } else {
        sourceStatus.youtube = `YouTube search unavailable: ${safeErrorMessage(youtubeSignalsResult.reason)}`;
      }
      publicSignals.push(...socialMemorySignals(packet));

      const context = formatClientMemoryPacket(packet);
      const { provider, model } = await resolveTextProviderForMode("balanced", req.userId);
      const prompt = buildTrendPrompt({
        context,
        industry: effectiveIndustry,
        region,
        platforms,
        timeWindow,
        contentGoal,
        topicHint,
        signals: publicSignals.slice(0, 20),
        sourceStatus,
      });
      const { text, usedProvider, usedModel, fallbackUsed } = await generateTextWithFallback(provider, model, prompt, 3600, req.userId);
      const parsed = safeJson<TrendResearchResult>(text) ?? fallbackResult(publicSignals, platforms, topicHint);
      parsed.sourceStatus = sourceStatus;

      res.json({
        ...parsed,
        meta: {
          provider: usedProvider,
          model: usedModel,
          requestedModel: model,
          fallbackUsed,
          sourcesUsed: [...new Set(publicSignals.map((signal) => signal.source))],
          signalCount: publicSignals.length,
        },
      });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Failed to research trends. Check your AI provider key in Settings.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Trend research failed");
      res.status(status).json({ error: message });
    }
  }
);

router.post(
  "/clients/:clientId/trends/save-memory",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const topic = cleanText(req.body?.topic);
    const whyItFits = cleanText(req.body?.whyItFits);
    const avoidNotes = cleanText(req.body?.avoidNotes);
    const recommendedAngle = cleanText(req.body?.recommendedAngle);

    if (!topic || !recommendedAngle) {
      res.status(400).json({ error: "topic and recommendedAngle are required" });
      return;
    }

    try {
      await writeClientMemory(
        req.params.clientId,
        `Trend Intelligence / saved insight / ${topic}`,
        [
          whyItFits ? `Why it fits: ${whyItFits}` : "",
          `Recommended angle: ${recommendedAngle}`,
          avoidNotes ? `Avoid: ${avoidNotes}` : "",
        ].filter(Boolean).join(" | ")
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      logger.error({ clientId: req.params.clientId, error: safeErrorMessage(err) }, "Trend memory save failed");
      res.status(500).json({ error: "Failed to save trend insight to AI Memory" });
    }
  }
);

export default router;
