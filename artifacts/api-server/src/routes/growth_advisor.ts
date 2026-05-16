import { Router } from "express";
import { desc, eq, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { postsTable, campaignsTable, userSettingsTable } from "@workspace/db/schema";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import {
  generateTextWithFallback,
  resolveProviderAndModel,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GrowthOpportunity = {
  title: string;
  whyItMatters: string;
  recommendedPlatforms: string[];
  contentAngle: string;
  suggestedFormats: string[];
  reachPotential: "high" | "medium" | "low";
  confidence: number;
};

type ContentGap = {
  gap: string;
  impact: "high" | "medium" | "low";
  suggestion: string;
};

type GrowthBrief = {
  summary: string;
  executiveSummary?: string;
  growthOpportunities: GrowthOpportunity[];
  topOpportunities?: Array<GrowthOpportunity & {
    whyNow: string;
    businessReason: string;
    campaignTopic: string;
    hookIdeas: string[];
    sourceSignals: string[];
  }>;
  contentGaps: ContentGap[];
  avoid: string[];
  recommendedNextCampaign: {
    topic: string;
    goal: string;
    platforms: string[];
    reason: string;
  };
};

// ---------------------------------------------------------------------------
// Content gap detection (rule-based, client-aware)
// ---------------------------------------------------------------------------

function detectContentGaps(
  recentPosts: Array<{ platform?: string | null; contentType?: string | null; postType?: string | null; caption?: string | null; topic?: string | null }>,
  rejectedPosts: Array<{ topic?: string | null; caption?: string | null }>,
  totalApproved: number
): ContentGap[] {
  const gaps: ContentGap[] = [];
  if (recentPosts.length === 0) return [];

  const platformCounts: Record<string, number> = {};
  let carouselCount = 0;
  let videoCount = 0;
  let blogCount = 0;
  let educationalCount = 0;
  let productOnlyCount = 0;

  const educationalKeywords = ["how", "why", "tip", "guide", "learn", "understand", "explained", "strategy", "step", "mistake", "fact", "secret", "lesson", "insight"];
  const productKeywords = ["buy", "shop", "sale", "product", "offer", "discount", "price", "available", "new arrival", "launch", "collection"];

  for (const post of recentPosts) {
    const platform = (post.platform ?? "instagram").toLowerCase();
    platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;

    const text = `${post.caption ?? ""} ${post.topic ?? ""} ${post.contentType ?? ""} ${post.postType ?? ""}`.toLowerCase();

    if (text.includes("carousel") || post.contentType?.toLowerCase().includes("carousel")) carouselCount++;
    if (text.includes("video") || text.includes("reel") || post.contentType?.toLowerCase().includes("video")) videoCount++;
    if (post.platform === "blog" || text.includes("blog") || post.contentType?.toLowerCase().includes("blog")) blogCount++;
    if (educationalKeywords.some(k => text.includes(k))) educationalCount++;
    if (productKeywords.filter(k => text.includes(k)).length >= 2 && !educationalKeywords.some(k => text.includes(k))) productOnlyCount++;
  }

  const linkedinCount = platformCounts["linkedin"] ?? 0;
  const linkedinShare = linkedinCount / recentPosts.length;

  // No educational posts
  if (educationalCount < Math.ceil(recentPosts.length * 0.2)) {
    gaps.push({
      gap: "No educational or value-led content recently",
      impact: "high",
      suggestion: "Add 1–2 how-to or insight posts per week. Educational content builds trust and drives saves, which signals quality to platform algorithms.",
    });
  }

  // No carousel
  if (carouselCount === 0 && recentPosts.length >= 5) {
    gaps.push({
      gap: "No carousel posts in recent content",
      impact: "medium",
      suggestion: "Carousels get 3× more reach on Instagram. Create one structured educational or product story carousel.",
    });
  }

  // No video
  if (videoCount === 0 && recentPosts.length >= 6) {
    gaps.push({
      gap: "No reel or video script created recently",
      impact: "high",
      suggestion: "Short-form video (Reels, TikTok) is currently the highest-reach format. Even one reel per week can significantly increase visibility.",
    });
  }

  // LinkedIn underused
  if (linkedinShare < 0.1 && recentPosts.length >= 8) {
    gaps.push({
      gap: "LinkedIn is significantly underused compared to other platforms",
      impact: "medium",
      suggestion: "LinkedIn posts reach decision-makers and B2B buyers. Share one thought-leadership or industry insight post per week.",
    });
  }

  // Too many generic product posts
  if (productOnlyCount > recentPosts.length * 0.5) {
    gaps.push({
      gap: "Content is heavily product-focused with little education or storytelling",
      impact: "high",
      suggestion: "Audiences disengage from continuous promotional posts. Mix in client stories, insights, or behind-the-scenes to increase retention.",
    });
  }

  // No blog support
  if (blogCount === 0 && totalApproved >= 10) {
    gaps.push({
      gap: "No blog or long-form content created yet",
      impact: "medium",
      suggestion: "Blog posts drive SEO traffic and can be repurposed across all social platforms. Consider one blog post per campaign.",
    });
  }

  // Rejected style patterns
  if (rejectedPosts.length >= 3) {
    gaps.push({
      gap: `${rejectedPosts.length} drafts were rejected — common patterns should be avoided`,
      impact: "medium",
      suggestion: "Review the rejection reasons in AI Memory to ensure future drafts don't repeat the same approach or style.",
    });
  }

  return gaps.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Build prompt
// ---------------------------------------------------------------------------

function buildGrowthAdvisorPrompt(params: {
  memoryPacketFormatted: string;
  recentApproved: string;
  recentRejected: string;
  recentCampaigns: string;
  contentGaps: ContentGap[];
  goal?: string;
  platformFocus?: string;
  trendTopics?: string[];
  timeframe: string;
}): string {
  const {
    memoryPacketFormatted, recentApproved, recentRejected, recentCampaigns,
    contentGaps, goal, platformFocus, trendTopics, timeframe,
  } = params;

  const trendSection = trendTopics?.length
    ? `\n## Current Market Trends Passed In\n${trendTopics.map(t => `- ${t}`).join("\n")}\nFor each trend, explain SPECIFICALLY how this client can use it — not as a generic awareness post, but as a targeted content angle that matches their brand, industry, audience, and goals.`
    : "";

  const gapSection = contentGaps.length
    ? `\n## Detected Content Gaps (rule-based analysis)\n${contentGaps.map(g => `- [${g.impact.toUpperCase()}] ${g.gap}: ${g.suggestion}`).join("\n")}`
    : "";

  return [
    "You are an expert digital marketing strategist analyzing a real client's brand and content history.",
    "Your job is to produce a structured, specific, actionable growth brief — not generic advice.",
    "Every recommendation must be grounded in what you see about THIS client's brand, past content, gaps, and market position.",
    "",
    "## Client Memory Packet (Brand DNA, AI Memory, Storylines, Performance)",
    memoryPacketFormatted,
    "",
    "## Recent Approved Drafts (last 15)",
    recentApproved || "None yet.",
    "",
    "## Recently Rejected Drafts",
    recentRejected || "None yet.",
    "",
    "## Recent Campaigns",
    recentCampaigns || "None yet.",
    gapSection,
    trendSection,
    "",
    `## Advisor Request`,
    goal ? `Goal: ${goal}` : "",
    platformFocus ? `Platform focus: ${platformFocus}` : "",
    `Timeframe: ${timeframe}`,
    "",
    "## Your Task",
    "Based ONLY on what you see above, produce a growth brief with:",
    "1. A summary paragraph (2-3 sentences) explaining what this client should do THIS week and why.",
    "2. 3-5 specific growth opportunities. Each must have a clear content angle specific to this brand — not 'post consistently' or 'engage with audience'.",
    "3. Content gaps that are limiting reach (prioritize gaps detected above).",
    "4. Styles, patterns, or topics to avoid (based on rejections and performance memory).",
    "5. One recommended next campaign topic with rationale.",
    "",
    "For suggestedFormats use only: post, carousel, reel, blog, newsletter, video_script",
    "For reachPotential use only: high, medium, low",
    "For impact use only: high, medium, low",
    "",
    "Return ONLY this exact JSON structure — no markdown, no explanation:",
    `{
  "summary": "string",
  "growthOpportunities": [
    {
      "title": "string",
      "whyItMatters": "string (specific to this brand, not generic)",
      "recommendedPlatforms": ["instagram", "linkedin"],
      "contentAngle": "string (the specific hook, angle, or framing for THIS brand)",
      "suggestedFormats": ["post"],
      "reachPotential": "high",
      "confidence": 85
    }
  ],
  "contentGaps": [
    {
      "gap": "string",
      "impact": "high",
      "suggestion": "string (actionable, specific)"
    }
  ],
  "avoid": ["string", "string"],
  "recommendedNextCampaign": {
    "topic": "string",
    "goal": "awareness|engagement|leads|sales",
    "platforms": ["instagram", "linkedin"],
    "reason": "string (why this topic, why now, why these platforms)"
  }
}`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/growth-advisor/brief",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const { goal, platformFocus, trendTopics, timeframe = "weekly" } = req.body as {
      goal?: string;
      platformFocus?: string;
      trendTopics?: string[];
      timeframe?: string;
    };
    const userId = req.userId;

    try {
      // Load all context in parallel
      const [memoryPacket, approvedPosts, rejectedPosts, campaigns, settings] = await Promise.all([
        buildClientMemoryPacket(clientId),
        db
          .select({
            id: postsTable.id,
            topic: postsTable.topic,
            caption: postsTable.caption,
            platform: postsTable.platform,
            contentType: postsTable.contentType,
            postType: postsTable.postType,
            qualityScore: postsTable.qualityScore,
            createdAt: postsTable.createdAt,
          })
          .from(postsTable)
          .where(
            and(
              eq(postsTable.clientId, clientId),
              inArray(postsTable.status, ["approved", "export_ready", "scheduled", "posted", "published"])
            )
          )
          .orderBy(desc(postsTable.updatedAt))
          .limit(30),
        db
          .select({
            id: postsTable.id,
            topic: postsTable.topic,
            caption: postsTable.caption,
            platform: postsTable.platform,
            contentType: postsTable.contentType,
            postType: postsTable.postType,
          })
          .from(postsTable)
          .where(and(eq(postsTable.clientId, clientId), eq(postsTable.status, "rejected")))
          .orderBy(desc(postsTable.updatedAt))
          .limit(20),
        db
          .select({ id: campaignsTable.id, name: campaignsTable.name, goal: campaignsTable.goal, createdAt: campaignsTable.createdAt })
          .from(campaignsTable)
          .where(eq(campaignsTable.clientId, clientId))
          .orderBy(desc(campaignsTable.createdAt))
          .limit(8),
        db
          .select()
          .from(userSettingsTable)
          .where(userId ? eq(userSettingsTable.userId, userId) : eq(userSettingsTable.userId, ""))
          .limit(1)
          .then(rows => rows[0] ?? null),
      ]);

      // Detect content gaps using rule-based analysis
      const contentGaps = detectContentGaps(approvedPosts, rejectedPosts, approvedPosts.length);

      // Format data for prompt
      const recentApprovedFormatted = approvedPosts
        .slice(0, 15)
        .map(p => `[${p.platform ?? "social"}] ${p.topic}${p.contentType ? ` (${p.contentType})` : ""}${typeof p.qualityScore === "number" ? ` · Q:${p.qualityScore}` : ""}`)
        .join("\n");

      const recentRejectedFormatted = rejectedPosts
        .slice(0, 10)
        .map(p => `[${p.platform ?? "social"}] ${p.topic}`)
        .join("\n");

      const recentCampaignsFormatted = campaigns
        .map(c => `${c.name}${c.goal ? ` (${c.goal})` : ""}`)
        .join("\n");

      const memoryFormatted = formatClientMemoryPacket(memoryPacket);

      const prompt = buildGrowthAdvisorPrompt({
        memoryPacketFormatted: memoryFormatted,
        recentApproved: recentApprovedFormatted,
        recentRejected: recentRejectedFormatted,
        recentCampaigns: recentCampaignsFormatted,
        contentGaps,
        goal,
        platformFocus,
        trendTopics: Array.isArray(trendTopics) ? trendTopics : [],
        timeframe,
      });

      const { provider, model } = await resolveProviderAndModel(settings, userId);
      const { text, usedProvider, usedModel, fallbackUsed } = await generateTextWithFallback(
        provider, model, prompt, 2500, userId
      );

      // Parse AI output
      let brief: GrowthBrief;
      try {
        const cleaned = text
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const candidate = cleaned.startsWith("{") ? cleaned : cleaned.match(/\{[\s\S]*\}/)?.[0];
        if (!candidate) throw new Error("No JSON in AI output");
        brief = JSON.parse(candidate) as GrowthBrief;
      } catch {
        // If AI JSON fails, build a minimal fallback from detected gaps
        brief = {
          summary: "AI analysis could not be parsed. Review the content gaps below for immediate actions.",
          growthOpportunities: contentGaps.slice(0, 3).map(gap => ({
            title: gap.gap,
            whyItMatters: gap.suggestion,
            recommendedPlatforms: ["instagram"],
            contentAngle: gap.suggestion,
            suggestedFormats: ["post"],
            reachPotential: gap.impact as "high" | "medium" | "low",
            confidence: 60,
          })),
          contentGaps,
          avoid: [],
          recommendedNextCampaign: {
            topic: "Educational content series",
            goal: "awareness",
            platforms: ["instagram", "linkedin"],
            reason: "Based on detected content gaps, educational content is the highest-priority improvement.",
          },
        };
      }

      // Ensure content gaps from detection are merged in
      if (contentGaps.length > 0 && (!brief.contentGaps || brief.contentGaps.length === 0)) {
        brief.contentGaps = contentGaps;
      }
      brief.executiveSummary = brief.executiveSummary || brief.summary;
      brief.topOpportunities = (brief.topOpportunities?.length ? brief.topOpportunities : brief.growthOpportunities.map((opp) => ({
        ...opp,
        whyNow: Array.isArray(trendTopics) && trendTopics.length
          ? `Connected to selected trend signal: ${trendTopics[0]}`
          : "Based on the client's recent content gaps, memory, and campaign history.",
        businessReason: opp.whyItMatters,
        campaignTopic: opp.title,
        hookIdeas: [opp.contentAngle].filter(Boolean),
        sourceSignals: [
          ...(Array.isArray(trendTopics) ? trendTopics.slice(0, 2) : []),
          ...contentGaps.slice(0, 2).map((gap) => gap.gap),
        ],
      }))).slice(0, 5);

      res.json({
        brief,
        meta: {
          provider: usedProvider,
          model: usedModel,
          fallbackUsed,
          analyzedPosts: approvedPosts.length,
          rejectedPosts: rejectedPosts.length,
          detectedGaps: contentGaps.length,
          trendTopicsUsed: Array.isArray(trendTopics) ? trendTopics.length : 0,
        },
      });
    } catch (err) {
      const category = (err as any)?.category;
      if (category) {
        res.status(503).json(toAiErrorResponse(err, "AI provider unavailable"));
        return;
      }
      logger.error({ err, clientId }, "growth-advisor error");
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  }
);

export default router;
