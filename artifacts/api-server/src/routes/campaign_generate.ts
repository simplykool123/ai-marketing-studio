/**
 * POST /clients/:clientId/campaigns/generate
 *
 * Full-campaign AI generation:
 *   - Campaign brief / strategy
 *   - Social post drafts (grouped by platform)
 *   - Blog outline(s)
 *   - Newsletter outline(s)
 *   - Image prompt variations
 *   - Video concept drafts
 *   - Recommended posting schedule
 *
 * Saves everything:
 *   - campaign_outputs  → campaign-level summary/brief for replay
 *   - posts             → all generated draft/content items (status: "draft")
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignOutputsTable,
  postsTable,
  userSettingsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import {
  aiErrorCategory,
  generateTextWithFallback,
  resolveProviderAndModel,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return settings ?? null;
}

// ---------------------------------------------------------------------------
// TODO(skill-migration): per-content-type skill helpers
//
// When per-item skill execution is needed, replace the inline AI bulk-call
// with individual executeSkill() calls below.  The campaign generator
// currently uses a single AI prompt for the entire campaign (fast, one call).
// Migrating to per-skill calls means N round-trips — acceptable only when
// per-post quality scoring / skill-level overrides are required.
//
// Usage (future):
//   import { executeSkill } from "../lib/skill-engine.js";
//   import { evaluateQuality } from "../lib/quality-gate.js";
//
//   async function generateBlogDraftWithSkill(clientId: string, userId: string | undefined, outline: BlogOutline) {
//     return executeSkill({
//       clientId,
//       skillId: "seo_blog_strategist",
//       input: { keyword: outline.seoTitle, tone: "professional", wordCount: 1200 },
//       userId,
//     });
//   }
//
//   async function generateLinkedInPostWithSkill(clientId: string, userId: string | undefined, draft: SocialPostDraft) {
//     return executeSkill({
//       clientId,
//       skillId: "linkedin_thought_leader",
//       input: { topic: draft.topic, angle: draft.captionAngle },
//       userId,
//     });
//   }
//
//   async function generateInstagramPostWithSkill(clientId: string, userId: string | undefined, draft: SocialPostDraft) {
//     return executeSkill({
//       clientId,
//       skillId: "instagram_carousel_builder",
//       input: { topic: draft.topic, visualConcept: draft.imagePrompt },
//       userId,
//     });
//   }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocialPostDraft {
  platform: string;
  topic: string;
  captionAngle: string;
  imagePrompt: string;
  suggestedWeek: number;
  suggestedDay: string;
}

interface BlogOutline {
  seoTitle: string;
  metaDescription: string;
  slug: string;
  sections: string[];
  faq: { q: string; a: string }[];
}

interface NewsletterOutline {
  subject: string;
  preheader: string;
  sections: string[];
}

interface ImagePromptVariation {
  variation: number;
  style: string;
  prompt: string;
  rationale: string;
}

interface VideoConceptDraft {
  platform: string;
  hook: string;
  estimatedDuration: string;
  scenes: { order: number; duration: string; visual: string; text: string; voiceover: string }[];
  subtitleStyle: string;
  cta: string;
  recommendedProvider: string;
}

interface ScheduleEntry {
  week: number;
  day: string;
  date: string;
  platform: string;
  contentType: string;
  topic: string;
}

interface GeneratedCampaign {
  brief: string;
  socialPosts: SocialPostDraft[];
  blogOutlines: BlogOutline[];
  newsletterOutlines: NewsletterOutline[];
  imagePrompts: ImagePromptVariation[];
  videoConcepts: VideoConceptDraft[];
  schedule: ScheduleEntry[];
}

function skillIdForCampaignDraft(contentType: string, platform?: string): string | null {
  if (contentType === "social_post") return "social_post_creator";
  if (contentType === "carousel") return "instagram_carousel_builder";
  if (contentType === "blog") return "seo_blog_writer";
  if (contentType === "video_script" || platform === "instagram_reels") return "short_video_reel_script";
  return null;
}

function buildCampaignGenerationMetadata(input: {
  route: string;
  provider: string;
  requestedProvider: string;
  model: string;
  fallbackUsed: boolean;
  qualityMode: string;
  campaignOutputId: string;
  campaignId: string | null;
  campaignName: string;
  goal: string;
  monthTheme: string | null;
  intensity: string;
  startDate: string | null;
  endDate: string | null;
  originalInputPayload: Record<string, unknown>;
}) {
  return {
    route: input.route,
    provider: input.provider,
    requestedProvider: input.requestedProvider,
    model: input.model,
    fallbackUsed: input.fallbackUsed,
    aiMode: input.qualityMode,
    qualityMode: input.qualityMode,
    campaignOutputId: input.campaignOutputId,
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    goal: input.goal,
    monthTheme: input.monthTheme,
    intensity: input.intensity,
    startDate: input.startDate,
    endDate: input.endDate,
    originalInputPayload: input.originalInputPayload,
    retry: {
      enabled: true,
      sourceRoute: input.route,
      strategy: "skill_from_campaign_draft",
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const INTENSITY_COUNTS = {
  light:      { social: 8,  blogs: 1, newsletters: 1, videos: 2 },
  standard:   { social: 12, blogs: 1, newsletters: 1, videos: 3 },
  aggressive: { social: 18, blogs: 2, newsletters: 2, videos: 4 },
};

function buildCampaignPrompt(
  context: string,
  params: {
    campaignName: string;
    goal: string;
    monthTheme: string;
    platforms: string[];
    intensity: string;
    startDate: string;
    endDate: string;
    today: string;
  }
): string {
  const counts = INTENSITY_COUNTS[params.intensity as keyof typeof INTENSITY_COUNTS] ?? INTENSITY_COUNTS.standard;
  const platformList = params.platforms.join(", ");
  const hasLinkedIn   = params.platforms.includes("linkedin");
  const hasInstagram  = params.platforms.includes("instagram");
  const hasBlog       = params.platforms.includes("blog");
  const hasNewsletter = params.platforms.includes("newsletter");
  const hasVideo      = params.platforms.some(p => p.includes("youtube") || p.includes("reels") || p.includes("shorts"));

  return `You are a senior digital marketing agency strategist. Generate a complete ${params.intensity} content campaign.

${context}

## Campaign Brief
Name: ${params.campaignName}
Goal: ${params.goal}
Month/Theme: ${params.monthTheme || "General"}
Target platforms: ${platformList}
Campaign window: ${params.startDate} to ${params.endDate}
Today: ${params.today}

## Output Requirements
Generate exactly:
- 1 campaign brief (2–3 paragraphs strategy text)
- ${counts.social} social post drafts distributed across: ${platformList}
- ${hasBlog ? counts.blogs + " blog outline(s)" : "0 blog outlines (no blog platform selected)"}
- ${hasNewsletter ? counts.newsletters + " newsletter outline(s)" : "0 newsletter outlines"}
- 4 image prompt variations (different visual styles)
- ${hasVideo ? counts.videos + " video concept(s)" : "0 video concepts (no video platform selected)"}
- A recommended posting schedule for the full campaign window

## Quality Rules
- socialPosts: specific topics only — no generic "share a tip" posts
- ${hasLinkedIn ? "LinkedIn posts must be thought-leadership, 150–300 words, professional angle" : ""}
- ${hasInstagram ? "Instagram posts must lead with a strong visual concept" : ""}
- imagePrompts: 4 variations with distinct styles (photorealistic, illustration, bold typography, minimalist/clean)
- videoConcepts: include hook (first 3 s), 5 scenes with visual + voiceover, subtitle style, CTA, recommended provider
- schedule: distribute posts evenly across the campaign window; use real calendar dates (YYYY-MM-DD)
- Apply Content Growth Rules from memory only when they fit naturally: CTA, website link, WhatsApp, SEO/location/service keywords, and hashtags should support the post, not make it spammy.
- Platform-safe CTA rules: Instagram can use CTA plus hashtags; LinkedIn should use a professional CTA and fewer hashtags; Facebook can use friendly CTA plus link/WhatsApp; X needs a short CTA; Blog should use SEO keywords and meta focus.
- Caption structure by platform: Instagram hook, short value body, CTA, hashtags; LinkedIn professional hook, useful insight, soft CTA, fewer hashtags; Facebook friendly caption with CTA/link/WhatsApp if useful; X short hook and concise CTA; Blog intro SEO keyword focus and readable meta-style angle.
- Do NOT hallucinate facts about the brand

Respond with ONLY valid JSON — no markdown fences:
{
  "brief": "2–3 paragraph campaign strategy text",
  "socialPosts": [
    {
      "platform": "instagram",
      "topic": "Specific post topic",
      "captionAngle": "Opening hook or angle for the caption writer",
      "imagePrompt": "Detailed DALL-E image prompt for this post",
      "suggestedWeek": 1,
      "suggestedDay": "Monday"
    }
  ],
  "blogOutlines": [
    {
      "seoTitle": "SEO-optimised title under 60 chars",
      "metaDescription": "Meta description 150–160 chars",
      "slug": "url-friendly-slug",
      "sections": ["Introduction", "Section 1: ...", "Section 2: ...", "Conclusion"],
      "faq": [
        { "q": "Question?", "a": "Answer." }
      ]
    }
  ],
  "newsletterOutlines": [
    {
      "subject": "Email subject line",
      "preheader": "Preview text (40–80 chars)",
      "sections": ["Opening hook", "Main value section", "Secondary section", "CTA"]
    }
  ],
  "imagePrompts": [
    { "variation": 1, "style": "photorealistic", "prompt": "...", "rationale": "When to use this style" },
    { "variation": 2, "style": "illustration",   "prompt": "...", "rationale": "When to use this style" },
    { "variation": 3, "style": "bold typography","prompt": "...", "rationale": "When to use this style" },
    { "variation": 4, "style": "minimalist",     "prompt": "...", "rationale": "When to use this style" }
  ],
  "videoConcepts": [
    {
      "platform": "instagram_reels",
      "hook": "Opening 3-second line or visual",
      "estimatedDuration": "30s",
      "scenes": [
        { "order": 1, "duration": "3s", "visual": "What camera shows", "text": "On-screen text", "voiceover": "Spoken words" }
      ],
      "subtitleStyle": "bold_captions",
      "cta": "Call to action at the end",
      "recommendedProvider": "kling"
    }
  ],
  "schedule": [
    { "week": 1, "day": "Monday", "date": "YYYY-MM-DD", "platform": "instagram", "contentType": "social", "topic": "Post topic" }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/campaigns/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId } = req.params;

    const {
      campaignName = "New Campaign",
      goal         = "awareness",
      monthTheme   = "",
      platforms    = ["instagram", "linkedin"],
      intensity    = "standard",
      qualityMode  = "balanced",
      startDate,
      endDate,
      campaignId,  // optional — link output to existing campaign
      storylineId,
    } = req.body as {
      campaignName?: string;
      goal?: string;
      monthTheme?: string;
      platforms?: string[];
      intensity?: string;
      qualityMode?: string;
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      storylineId?: string;
    };

    let effectiveCampaignId = campaignId ?? null;
    if (!effectiveCampaignId) {
      const [campaign] = await db
        .insert(campaignsTable)
        .values({
          clientId,
          name: campaignName,
          goal,
          description: monthTheme || null,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          platforms: JSON.stringify(platforms),
          status: "draft",
        })
        .returning();
      effectiveCampaignId = campaign.id;
    }

    // Create a "generating" record first so the UI can poll if needed
    const [outputRecord] = await db
      .insert(campaignOutputsTable)
      .values({
        clientId,
        campaignId:    effectiveCampaignId,
        campaignName,
        goal,
        monthTheme:    monthTheme || null,
        platforms:     JSON.stringify(platforms),
        intensity,
        qualityMode,
        startDate:     startDate ?? null,
        endDate:       endDate   ?? null,
        status:        "generating",
      })
      .returning();

    // Run AI generation (async — let Express stream the response after)
    try {
      const packet  = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const settings = await getUserSettings(req.userId);
      const { provider, model } = await resolveProviderAndModel(settings, req.userId);

      const today = new Date().toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      });

      const prompt = buildCampaignPrompt(context, {
        campaignName,
        goal,
        monthTheme: monthTheme || "",
        platforms,
        intensity,
        startDate:  startDate  ?? today,
        endDate:    endDate    ?? today,
        today,
      });

      const { text: raw, usedProvider, usedModel, fallbackUsed } = await generateTextWithFallback(provider, model, prompt, 7000, req.userId);

      logger.info(
        { provider: usedProvider, requestedProvider: provider, model: usedModel, fallbackUsed, clientId },
        "Campaign generate: AI complete"
      );

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI returned no JSON");
      const gen = JSON.parse(jsonMatch[0]) as GeneratedCampaign;

      const originalInputPayload = {
        campaignName,
        goal,
        monthTheme: monthTheme || "",
        platforms,
        intensity,
        qualityMode,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        storylineId: storylineId ?? null,
      };

      const generationMetadata = buildCampaignGenerationMetadata({
        route: "campaign_generate.generate",
        provider: usedProvider,
        requestedProvider: provider,
        model: usedModel,
        fallbackUsed,
        qualityMode,
        campaignOutputId: outputRecord.id,
        campaignId: effectiveCampaignId,
        campaignName,
        goal,
        monthTheme: monthTheme || null,
        intensity,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        originalInputPayload,
      });

      const scheduleFor = (contentType: string, topic: string, platform?: string) =>
        (gen.schedule ?? []).find((entry) =>
          entry.topic === topic &&
          entry.contentType === contentType &&
          (!platform || entry.platform === platform)
        ) ?? null;

      // ── Persist social post drafts ───────────────────────────────────────
      // TODO(skill-migration): for LinkedIn posts use generateLinkedInPostWithSkill();
      // for Instagram posts use generateInstagramPostWithSkill() — see helper stubs above.
      const selectedSocialPosts = (gen.socialPosts ?? []).slice(0, 3);
      const postInserts = selectedSocialPosts.map((p) => ({
        clientId,
        campaignId:       effectiveCampaignId,
        storylineId:      storylineId ?? null,
        contentType:      "social_post",
        contentSchema: {
          ...p,
          schedule: scheduleFor("social", p.topic, p.platform),
        },
        contentSchemaVersion: 1,
        topic:            p.topic ?? "Untitled post",
        caption:          p.captionAngle ?? "",
        hashtags:         "",
        platform:         p.platform ?? "instagram",
        postType:         "social" as const,
        status:           "draft"  as const,
        generationStatus: "ready"  as const,
        imagePrompt:      p.imagePrompt ?? null,
        skillId:          skillIdForCampaignDraft("social_post", p.platform),
        generationMetadata: {
          ...generationMetadata,
          campaignItemType: "social_post",
          topic: p.topic ?? "Untitled post",
          platform: p.platform ?? "instagram",
          format: "social_post",
        },
      }));
      const createdPosts = postInserts.length
        ? await db.insert(postsTable).values(postInserts).returning()
        : [];

      const carouselSource = selectedSocialPosts[0];
      const carouselInserts = carouselSource ? [{
        clientId,
        campaignId:       effectiveCampaignId,
        storylineId:      storylineId ?? null,
        contentType:      "carousel",
        contentSchema: {
          campaignName,
          campaignGoal: goal,
          coverHeadline: carouselSource.topic,
          slides: [
            { title: carouselSource.topic, body: carouselSource.captionAngle },
            { title: "Why it matters now", body: monthTheme || goal },
            { title: "What to do next", body: "Turn the campaign insight into a practical audience action." },
            { title: "Proof point", body: "Use client examples, testimonials, or recent market signals." },
            { title: "CTA", body: "Save this and contact the team when ready." },
          ],
          visualDirection: carouselSource.imagePrompt,
          schedule: scheduleFor("carousel", carouselSource.topic, carouselSource.platform),
        },
        contentSchemaVersion: 1,
        topic:            `${campaignName}: carousel`,
        caption:          carouselSource.captionAngle ?? "",
        hashtags:         "",
        platform:         carouselSource.platform ?? "instagram",
        postType:         "social" as const,
        status:           "draft" as const,
        generationStatus: "ready" as const,
        imagePrompt:      carouselSource.imagePrompt ?? null,
        skillId:          skillIdForCampaignDraft("carousel", carouselSource.platform),
        generationMetadata: {
          ...generationMetadata,
          campaignItemType: "carousel",
        },
      }] : [];
      const createdCarousels = carouselInserts.length
        ? await db.insert(postsTable).values(carouselInserts).returning()
        : [];

      // ── Persist blog drafts ──────────────────────────────────────────────
      // TODO(skill-migration): replace with generateBlogDraftWithSkill() per outline
      // to get qualityScore + qualityReport + quality_checks row per blog draft.
      const fallbackBlog: BlogOutline = {
        seoTitle: `${campaignName}: ${monthTheme || goal}`,
        metaDescription: `A practical article for ${campaignName} based on ${monthTheme || goal}.`,
        slug: campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "campaign-article",
        sections: ["Why this matters now", "What the audience should know", "How the brand helps", "Next steps"],
        faq: [],
      };
      const blogInserts = ((gen.blogOutlines?.length ? gen.blogOutlines : [fallbackBlog])).slice(0, 1).map((b) => ({
        clientId,
        campaignId:       effectiveCampaignId,
        storylineId:      storylineId ?? null,
        contentType:      "blog",
        contentSchema: {
          ...b,
          schedule: scheduleFor("blog", b.seoTitle, "blog"),
        },
        contentSchemaVersion: 1,
        topic:            b.seoTitle ?? "Blog Post",
        caption:          b.metaDescription ?? "",
        hashtags:         "",
        title:            b.seoTitle ?? "",
        longFormBody:     JSON.stringify(b),
        platform:         "blog" as string,
        postType:         "blog" as const,
        status:           "draft" as const,
        generationStatus: "ready" as const,
        skillId:          skillIdForCampaignDraft("blog", "blog"),
        generationMetadata: {
          ...generationMetadata,
          campaignItemType: "blog",
          topic: b.seoTitle ?? "Blog Post",
          platform: "blog",
          format: "blog",
        },
      }));
      const createdBlogs = blogInserts.length
        ? await db.insert(postsTable).values(blogInserts).returning()
        : [];

      // ── Persist newsletter drafts ────────────────────────────────────────
      const newsletterInserts = (gen.newsletterOutlines ?? []).slice(0, 1).map((n) => ({
        clientId,
        campaignId:       effectiveCampaignId,
        storylineId:      storylineId ?? null,
        contentType:      "newsletter",
        contentSchema: {
          ...n,
          schedule: scheduleFor("newsletter", n.subject, "newsletter"),
        },
        contentSchemaVersion: 1,
        topic:            n.subject ?? "Newsletter",
        caption:          n.preheader ?? "",
        hashtags:         "",
        title:            n.subject ?? "",
        longFormBody:     JSON.stringify(n),
        platform:         "newsletter",
        postType:         "newsletter" as const,
        status:           "draft" as const,
        generationStatus: "ready" as const,
        generationMetadata: {
          ...generationMetadata,
          campaignItemType: "newsletter",
          topic: n.subject ?? "Newsletter",
          platform: "newsletter",
          format: "newsletter",
        },
      }));
      const createdNewsletters = newsletterInserts.length
        ? await db.insert(postsTable).values(newsletterInserts).returning()
        : [];

      // ── Persist image prompt drafts ──────────────────────────────────────
      const imagePromptInserts = (gen.imagePrompts ?? []).map((i) => ({
        clientId,
        campaignId:       effectiveCampaignId,
        storylineId:      storylineId ?? null,
        contentType:      "image_prompt",
        contentSchema: {
          ...i,
          campaignName,
          campaignGoal: goal,
        },
        contentSchemaVersion: 1,
        topic:            `${campaignName}: ${i.style ?? "image"} prompt`,
        caption:          i.rationale ?? "",
        hashtags:         "",
        platform:         "image",
        postType:         "social" as const,
        status:           "draft" as const,
        generationStatus: "ready" as const,
        imagePrompt:      i.prompt ?? null,
        generationMetadata: {
          ...generationMetadata,
          campaignItemType: "image_prompt",
          topic: `${campaignName}: ${i.style ?? "image"} prompt`,
          platform: "image",
          format: "image_prompt",
        },
      }));
      const createdImagePrompts = imagePromptInserts.length
        ? await db.insert(postsTable).values(imagePromptInserts).returning()
        : [];

      // ── Persist video script drafts ──────────────────────────────────────
      const fallbackVideo: VideoConceptDraft = {
        platform: platforms.includes("instagram") ? "instagram_reels" : platforms[0] ?? "instagram_reels",
        hook: `${campaignName}: ${monthTheme || goal}`,
        estimatedDuration: "20s",
        scenes: [
          { order: 1, duration: "3s", visual: "Open with a clear client-relevant problem", text: "Why this matters", voiceover: `Here is why ${monthTheme || campaignName} matters right now.` },
          { order: 2, duration: "5s", visual: "Show the product, service, or team in context", text: "What to know", voiceover: "Give the audience one practical insight they can use." },
          { order: 3, duration: "5s", visual: "Show proof, process, or outcome", text: "Proof", voiceover: "Back it up with a concrete example or result." },
          { order: 4, duration: "4s", visual: "Close on brand/product/action", text: "Next step", voiceover: "Invite the viewer to save, share, or contact the brand." },
        ],
        subtitleStyle: "bold_captions",
        cta: "Save this and contact us when ready.",
        recommendedProvider: "kling",
      };
      const videoInserts = ((gen.videoConcepts?.length ? gen.videoConcepts : [fallbackVideo])).slice(0, 1).map((v) => ({
        clientId,
        campaignId:       effectiveCampaignId,
        storylineId:      storylineId ?? null,
        contentType:      "video_script",
        contentSchema: {
          ...v,
          voiceoverFull: (v.scenes ?? []).map(s => s.voiceover).join(" "),
          schedule: scheduleFor("video", v.hook, v.platform),
        },
        contentSchemaVersion: 1,
        topic:            v.hook ?? "Video Concept",
        caption:          v.hook ?? "",
        hashtags:         "",
        platform:         v.platform ?? "instagram_reels",
        postType:         "social" as const,
        status:           "draft" as const,
        generationStatus: "ready" as const,
        longFormBody:     (v.scenes ?? []).map(s => s.voiceover).join(" "),
        skillId:          skillIdForCampaignDraft("video_script", v.platform),
        generationMetadata: {
          ...generationMetadata,
          campaignItemType: "video_script",
          topic: v.hook ?? "Video Concept",
          platform: v.platform ?? "instagram_reels",
          format: "video_script",
        },
      }));
      const createdVideos = videoInserts.length
        ? await db.insert(postsTable).values(videoInserts).returning()
        : [];

      // ── Update campaign_outputs to ready ────────────────────────────────
      const [updated] = await db
        .update(campaignOutputsTable)
        .set({
          brief:                  gen.brief ?? null,
          socialPostsJson:        JSON.stringify(gen.socialPosts       ?? []),
          blogOutlinesJson:       JSON.stringify(gen.blogOutlines      ?? []),
          newsletterOutlinesJson: JSON.stringify(gen.newsletterOutlines ?? []),
          imagePromptsJson:       JSON.stringify(gen.imagePrompts       ?? []),
          videoConceptsJson:      JSON.stringify(gen.videoConcepts      ?? []),
          scheduleJson:           JSON.stringify(gen.schedule           ?? []),
          status:    "ready",
          updatedAt: new Date(),
        })
        .where(eq(campaignOutputsTable.id, outputRecord.id))
        .returning();

      res.json({
        output:      updated,
        campaignId:  effectiveCampaignId,
        createdPostsCount: createdPosts.length,
        carouselDraftsCount: createdCarousels.length,
        blogDraftsCount:   blogInserts.length,
        newsletterDraftsCount: createdNewsletters.length,
        imagePromptDraftsCount: createdImagePrompts.length,
        videoScriptsCount: createdVideos.length,
        createdPostIds: [
          ...createdPosts,
          ...createdCarousels,
          ...createdBlogs,
          ...createdNewsletters,
          ...createdImagePrompts,
          ...createdVideos,
        ].map((post) => post.id),
        createdDrafts: [
          ...createdPosts,
          ...createdCarousels,
          ...createdBlogs,
          ...createdNewsletters,
          ...createdImagePrompts,
          ...createdVideos,
        ],
        meta: { provider: usedProvider, requestedProvider: provider, model: usedModel, fallbackUsed },
      });
    } catch (err) {
      // Mark as failed, still return a clean response
      await db
        .update(campaignOutputsTable)
        .set({ status: "failed", errorMessage: safeErrorMessage(err), updatedAt: new Date() })
        .where(eq(campaignOutputsTable.id, outputRecord.id))
        .catch(() => {});

      const { status, message } = toAiErrorResponse(
        err, "Failed to generate campaign. Check your AI provider key in Settings."
      );
      logger.error({ provider: "text", errorCategory: aiErrorCategory(err) }, "Campaign generate error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/campaigns/outputs — list previous outputs
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/campaigns/outputs",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const outputs = await db
        .select({
          id: campaignOutputsTable.id,
          campaignName: campaignOutputsTable.campaignName,
          goal: campaignOutputsTable.goal,
          monthTheme: campaignOutputsTable.monthTheme,
          platforms: campaignOutputsTable.platforms,
          intensity: campaignOutputsTable.intensity,
          qualityMode: campaignOutputsTable.qualityMode,
          status: campaignOutputsTable.status,
          createdAt: campaignOutputsTable.createdAt,
        })
        .from(campaignOutputsTable)
        .where(eq(campaignOutputsTable.clientId, req.params.clientId))
        .orderBy(campaignOutputsTable.createdAt);

      res.json({ outputs });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Campaign outputs list error");
      res.status(500).json({ error: "Failed to list campaign outputs" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/campaigns/outputs/:outputId — full detail
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/campaigns/outputs/:outputId",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const [output] = await db
        .select()
        .from(campaignOutputsTable)
        .where(
          and(
            eq(campaignOutputsTable.id, req.params.outputId),
            eq(campaignOutputsTable.clientId, req.params.clientId)
          )
        )
        .limit(1);

      if (!output) {
        res.status(404).json({ error: "Campaign output not found" });
        return;
      }
      res.json({ output });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Campaign output get error");
      res.status(500).json({ error: "Failed to get campaign output" });
    }
  }
);

export default router;
