import { Router } from "express";
import { buildClientMemoryPacket, formatClientMemoryPacket, writeClientMemory } from "../lib/client-memory-packet.js";
import { generateTextWithFallback, getEligibleProviders, resolveApiKey, safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
import { logger } from "../lib/logger.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";

const router = Router();

type TrendPlatform = "instagram" | "facebook" | "linkedin" | "x" | "youtube" | "google";
type Confidence = "high" | "medium" | "low";
type BrandFit = "strong" | "moderate" | "weak";

type TrendSignal = {
  source: "google" | "youtube" | "social_memory" | "manual" | "web" | "serper" | "tavily" | "twitter";
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
  source: "google" | "youtube" | "manual" | "social_memory" | "serper" | "tavily" | "twitter";
  topic: string;
  url?: string;
  publishedAt?: string;
  note: string;
};

type RealtimeTrend = {
  title: string;
  source: string;
  market: string;
  platformHint: string;
  whyItMatters: string;
  suggestedAngle: string;
  contentFormats: string[];
  suggestedFormats?: string[];
  confidence: Confidence;
  freshness: string;
  keywords: string[];
  clientFitScore?: number;
  sourceUrl?: string;
};

type RealtimeTrendResponse = {
  mode: "free" | "paid-enhanced";
  sourcesUsed: string[];
  trends: RealtimeTrend[];
  sourceStatus: Record<string, string>;
  liveTrendApiConnected: boolean;
  meta?: Record<string, unknown>;
};

const realtimeTrendCache = new Map<string, { expiresAt: number; value: RealtimeTrendResponse }>();

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

function normalizeMarket(value: unknown): string {
  const market = typeof value === "string" ? value.toLowerCase() : "global";
  return ["india", "indonesia", "global"].includes(market) ? market : "global";
}

function marketRegion(market: string): string {
  if (market === "india") return "IN";
  if (market === "indonesia") return "ID";
  return "US";
}

function normalizeRealtimePlatform(value: unknown): string {
  const platform = typeof value === "string" ? value.toLowerCase() : "news";
  return ["instagram", "linkedin", "youtube", "news"].includes(platform) ? platform : "news";
}

function normalizeWindow(value: unknown): "4h" | "8h" | "24h" {
  return value === "4h" || value === "8h" || value === "24h" ? value : "24h";
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

async function fetchSerperSignals(query: string, market: string, userId?: string): Promise<PublicSignal[]> {
  const { key } = await resolveApiKey("serper", userId);
  const res = await fetch("https://google.serper.dev/news", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: marketRegion(market).toLowerCase(), hl: "en", num: 8 }),
  });
  const data = await res.json().catch(() => ({})) as { news?: Array<{ title?: string; link?: string; snippet?: string; date?: string; source?: string }> };
  if (!res.ok) throw new Error(`Serper returned HTTP ${res.status}`);
  return (data.news ?? []).map((item) => ({
    source: "serper" as const,
    topic: item.title ?? "",
    url: item.link,
    publishedAt: item.date,
    note: [item.source, item.snippet].filter(Boolean).join(" - ").slice(0, 260),
  })).filter((item) => item.topic);
}

async function fetchTavilySignals(query: string, userId?: string): Promise<PublicSignal[]> {
  const { key } = await resolveApiKey("tavily", userId);
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, search_depth: "basic", max_results: 6, include_answer: false }),
  });
  const data = await res.json().catch(() => ({})) as { results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }> };
  if (!res.ok) throw new Error(`Tavily returned HTTP ${res.status}`);
  return (data.results ?? []).map((item) => ({
    source: "tavily" as const,
    topic: item.title ?? "",
    url: item.url,
    publishedAt: item.published_date,
    note: (item.content ?? "Web research context").slice(0, 260),
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

function realtimeFallback(signals: PublicSignal[], market: string, platform: string, sourceStatus: Record<string, string>): { trends: RealtimeTrend[]; sourceStatus: Record<string, string>; liveTrendApiConnected: boolean } {
  const seen = new Set<string>();
  const trends = signals.filter((signal) => {
    const key = signal.topic.toLowerCase().replace(/\W+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8).map((signal, index) => ({
    title: signal.topic,
    source: signal.source,
    market,
    platformHint: platform,
    whyItMatters: signal.note || "Current public signal that may be useful for brand-safe content planning.",
    suggestedAngle: `Connect this topic to a practical audience problem for the client instead of copying the source.`,
    contentFormats: index % 2 === 0 ? ["carousel", "linkedin_post"] : ["image_post", "short_video"],
    suggestedFormats: index % 2 === 0 ? ["carousel", "linkedin_post"] : ["image_post", "short_video"],
    confidence: signal.source === "serper" || signal.source === "tavily" ? "medium" as const : "low" as const,
    freshness: signal.publishedAt ?? "recent",
    keywords: signal.topic.split(/\s+/).filter((word) => word.length > 3).slice(0, 6),
    clientFitScore: scoreRealtimeTrend(signal, platform, market, index),
    sourceUrl: signal.url,
  }));
  return {
    trends,
    sourceStatus,
    liveTrendApiConnected: signals.some((signal) => signal.source === "serper" || signal.source === "tavily"),
  };
}

function scoreRealtimeTrend(signal: PublicSignal, platform: string, market: string, index: number): number {
  let score = 45;
  if (signal.source === "serper" || signal.source === "tavily") score += 15;
  if (signal.source === "google") score += 10;
  if (signal.source === "social_memory") score += 12;
  if (signal.publishedAt && /\d{4}|GMT|UTC|ago|hour|day/i.test(signal.publishedAt)) score += 8;
  if (platform !== "news" && signal.topic.toLowerCase().includes(platform)) score += 6;
  if (market !== "global" && signal.topic.toLowerCase().includes(market)) score += 6;
  score -= Math.min(index * 3, 18);
  return Math.max(20, Math.min(95, score));
}

function buildRealtimeTrendPrompt(params: {
  context: string;
  market: string;
  platform: string;
  window: string;
  signals: PublicSignal[];
  sourceStatus: Record<string, string>;
}): string {
  return `You are a brand-safe live trend analyst. Turn the evidence into concise content opportunities for this specific client.

${params.context}

Market: ${params.market}
Platform focus: ${params.platform}
Freshness window: ${params.window}

Signals:
${params.signals.length ? params.signals.map((signal, index) => `${index + 1}. [${signal.source}] ${signal.topic}${signal.publishedAt ? ` (${signal.publishedAt})` : ""}: ${signal.note}`).join("\n") : "No live API signals returned; use client memory and fallback sources only."}

Source status:
${Object.entries(params.sourceStatus).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

Rules:
- Do not invent virality, rankings, hashtags, audio names, dates, or stats.
- Explain why each item matters for this client, not generally.
- If live trend APIs are missing, be honest and lower confidence.
- Keep each angle practical enough to pass into Growth Advisor or campaign creation.

Return ONLY JSON:
{
      "trends": [
    {
      "title": "",
      "source": "",
      "market": "${params.market}",
      "platformHint": "${params.platform}",
      "whyItMatters": "",
      "suggestedAngle": "",
      "contentFormats": ["post", "carousel"],
      "suggestedFormats": ["post", "carousel"],
      "confidence": "high | medium | low",
      "freshness": "",
      "keywords": ["keyword"],
      "clientFitScore": 0,
      "sourceUrl": ""
    }
  ]
}`;
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

router.get(
  "/clients/:clientId/trends/realtime",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const market = normalizeMarket(req.query.market);
    const platform = normalizeRealtimePlatform(req.query.platform);
    const window = normalizeWindow(req.query.window);
    const cacheKey = `${clientId}:${market}:${platform}:${window}`;
    const cached = realtimeTrendCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ ...cached.value, meta: { ...(cached.value.meta ?? {}), cached: true, window } });
      return;
    }

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const industry = packet.client?.industry || packet.brandDna?.usp || "marketing";
      const query = [industry, market, platform, "current trends"].filter(Boolean).join(" ");
      const eligibleTrendProviders = new Set(await getEligibleProviders("trend", req.userId));
      const sourceStatus: Record<string, string> = {
        serper: "Live trend API not connected.",
        tavily: "Optional web research API not connected.",
        google_news: "Fallback Google News RSS available.",
        youtube: process.env.YOUTUBE_API_KEY ? "YouTube keyword fallback available." : "YouTube keyword fallback not connected.",
      };

      const [serperResult, tavilyResult, googleResult, youtubeResult] = await Promise.allSettled([
        eligibleTrendProviders.has("serper") ? fetchSerperSignals(query, market, req.userId) : Promise.resolve([]),
        eligibleTrendProviders.has("tavily") ? fetchTavilySignals(query, req.userId) : Promise.resolve([]),
        fetchGoogleNewsSignals(query, marketRegion(market)),
        platform === "youtube" ? fetchYoutubeSignals(query) : Promise.resolve([]),
      ]);

      const signals: PublicSignal[] = [];
      if (serperResult.status === "fulfilled") {
        signals.push(...serperResult.value);
        sourceStatus.serper = serperResult.value.length ? "Serper connected and queried." : "Serper missing or disabled; skipped.";
      } else {
        sourceStatus.serper = `Live trend API not connected: ${safeErrorMessage(serperResult.reason)}`;
      }
      if (tavilyResult.status === "fulfilled") {
        signals.push(...tavilyResult.value);
        sourceStatus.tavily = tavilyResult.value.length ? "Tavily connected and queried." : "Tavily missing or disabled; skipped.";
      } else {
        sourceStatus.tavily = `Tavily not connected: ${safeErrorMessage(tavilyResult.reason)}`;
      }
      if (googleResult.status === "fulfilled") {
        signals.push(...googleResult.value);
        sourceStatus.google_news = "Google News RSS fallback queried.";
      } else {
        sourceStatus.google_news = `Google News fallback unavailable: ${safeErrorMessage(googleResult.reason)}`;
      }
      if (youtubeResult.status === "fulfilled") {
        signals.push(...youtubeResult.value);
      } else {
        sourceStatus.youtube = `YouTube fallback unavailable: ${safeErrorMessage(youtubeResult.reason)}`;
      }
      signals.push(...socialMemorySignals(packet).slice(0, 4));

      let output = realtimeFallback(signals, market, platform, sourceStatus);
      const mode: "free" | "paid-enhanced" = signals.some((signal) => signal.source === "serper" || signal.source === "tavily" || signal.source === "twitter")
        ? "paid-enhanced"
        : "free";
      const sourcesUsed = [...new Set(signals.map((signal) => signal.source === "google" ? "Google News" : signal.source === "social_memory" ? "AI Memory" : signal.source))];
      try {
        const { provider, model } = await resolveTextProviderForMode("balanced", req.userId);
        const prompt = buildRealtimeTrendPrompt({
          context: formatClientMemoryPacket(packet),
          market,
          platform,
          window,
          signals: signals.slice(0, 18),
          sourceStatus,
        });
        const { text, usedProvider, usedModel, fallbackUsed } = await generateTextWithFallback(provider, model, prompt, 2200, req.userId);
        const parsed = safeJson<{ trends: RealtimeTrend[] }>(text);
        if (parsed?.trends?.length) {
          const response: RealtimeTrendResponse = {
            mode,
            sourcesUsed,
            trends: parsed.trends.slice(0, 8).map((trend, index) => ({
              ...trend,
              suggestedFormats: trend.suggestedFormats ?? trend.contentFormats,
              clientFitScore: trend.clientFitScore ?? Math.max(30, 86 - index * 5),
              sourceUrl: trend.sourceUrl,
            })),
            sourceStatus,
            liveTrendApiConnected: signals.some((signal) => signal.source === "serper" || signal.source === "tavily"),
            meta: { provider: usedProvider, model: usedModel, fallbackUsed, signalCount: signals.length, window, cached: false },
          };
          realtimeTrendCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, value: response });
          res.json(response);
          return;
        }
      } catch (aiErr) {
        sourceStatus.ai_synthesis = `AI synthesis unavailable: ${safeErrorMessage(aiErr)}`;
      }

      const response: RealtimeTrendResponse = {
        mode,
        sourcesUsed,
        ...output,
        meta: { provider: "fallback", model: "rule-based", fallbackUsed: true, signalCount: signals.length, window, cached: false },
      };
      realtimeTrendCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, value: response });
      res.json(response);
    } catch (err) {
      logger.error({ clientId, error: safeErrorMessage(err) }, "Realtime trends failed");
      res.status(500).json({ error: "Failed to load realtime trends." });
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
