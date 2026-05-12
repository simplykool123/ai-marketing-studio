import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, qualityChecksTable, skillConfigsTable } from "@workspace/db/schema";
import { executeSkill, getSkillSaveDestination, SkillEngineError } from "../lib/skill-engine.js";
import { evaluateQuality } from "../lib/quality-gate.js";
import { toAiErrorResponse, safeErrorMessage } from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

const PLATFORM_REWRITE_SKILL = {
  skillId: "platform_rewrite",
  version: "1.0.0",
  displayName: "Platform Rewrite",
  category: "social_post",
  config: {
    skill_id: "platform_rewrite",
    version: "1.0.0",
    display_name: "Platform Rewrite",
    category: "social_post",
    description: "Rewrites an existing draft or caption for another platform using Brand DNA, AI Memory, active Storyline, and recent posts.",
    required_memory: ["brand_dna", "content_rules", "recent_posts"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory"],
    input_schema: {
      type: "object",
      required: ["sourceCaption", "sourcePlatform", "targetPlatform", "topic"],
      properties: {
        sourceCaption: { type: "string" },
        sourcePlatform: { type: "string" },
        targetPlatform: { type: "string", enum: ["instagram", "linkedin", "facebook", "twitter", "blog"] },
        topic: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["caption", "platform", "hashtags", "cta", "formatNotes"],
      properties: {
        caption: { type: "string" },
        platform: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        cta: { type: "string" },
        formatNotes: { type: "string" },
      },
    },
    prompt_template:
      "Rewrite the source caption from {{sourcePlatform}} for {{targetPlatform}}.\n\nTopic: {{topic}}\nSource caption:\n{{sourceCaption}}\n\nUse Brand DNA, AI Memory, the active Storyline if present, and recent posts to avoid repetition. Keep the same strategic idea, but adapt length, tone, CTA, and formatting for the target platform. For Blog intro, write only an intro-style caption/lead, not a full blog. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.76,
      checks: ["brand_voice_match", "platform_fit", "not_too_similar_to_source", "not_too_similar_to_recent_posts"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 1600,
    },
    save_destination: {
      table: "posts",
      content_type: "social_post",
      platform: "social",
      status: "draft",
    },
    memory_writeback: {
      on_approved: "Record approved platform rewrite pattern and platform-specific CTA.",
      on_rejected: "Record rejected rewrite pattern or platform mismatch.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const OCCASION_ARTWORK_SKILL = {
  skillId: "occasion_artwork",
  version: "1.0.0",
  displayName: "Occasion Artwork",
  category: "artwork",
  config: {
    skill_id: "occasion_artwork",
    version: "1.0.0",
    display_name: "Occasion Artwork",
    category: "artwork",
    description: "Prepares branded artwork guidance for Marketing Calendar occasion drafts using Brand DNA, AI Memory, active Storyline, platform, and existing artwork templates.",
    required_memory: ["brand_dna", "image_style_memory", "content_rules"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "recent_posts"],
    input_schema: {
      type: "object",
      required: ["occasion", "platform", "topic"],
      properties: {
        occasion: { type: "object" },
        platform: { type: "string", enum: ["instagram", "linkedin", "facebook", "twitter"] },
        topic: { type: "string" },
        caption: { type: "string" },
        brandColors: { type: "array", items: { type: "string" } },
        imageStyleNotes: { type: "string" },
        artworkTemplates: { type: "array", items: { type: "string" } },
      },
    },
    output_schema: {
      type: "object",
      required: ["headline", "subline", "supportingLine", "artDirection", "layoutSuggestion", "recommendedFontStyle", "recommendedPalette", "overlayStyle", "ctaStyle", "platformNotes", "imagePrompt"],
      properties: {
        headline: { type: "string" },
        subline: { type: "string" },
        supportingLine: { type: "string" },
        artDirection: { type: "string" },
        layoutSuggestion: { type: "string", enum: ["festival_greeting", "announcement", "minimal_brand", "carousel_cover"] },
        recommendedFontStyle: { type: "string" },
        recommendedPalette: { type: "array", items: { type: "string" } },
        overlayStyle: { type: "string" },
        ctaStyle: { type: "string" },
        platformNotes: { type: "string" },
        imagePrompt: { type: "string" },
      },
    },
    prompt_template:
      "Prepare branded artwork guidance for this occasion draft.\n\nOccasion: {{occasion.title}} on {{occasion.date}} ({{occasion.category}})\nPlatform: {{platform}}\nTopic: {{topic}}\nCaption: {{caption}}\nBrand colors: {{brandColors}}\nImage style notes: {{imageStyleNotes}}\nAvailable templates: {{artworkTemplates}}\n\nUse Brand DNA, AI Memory, image style memory, active Storyline if relevant, and recent approved/rejected posts. Platform rules: Instagram needs a stronger visual headline and less text; LinkedIn should be cleaner and more professional; Facebook should be warmer and more general-audience. Choose only one layoutSuggestion from festival_greeting, announcement, minimal_brand, carousel_cover. Image prompt must describe a background-only image with no text, logo, watermark, letters, or typography. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.78,
      checks: ["brand_visual_fit", "platform_fit", "occasion_relevance", "usable_artwork_direction"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 1800,
    },
    save_destination: {
      table: "posts",
      content_type: "artwork",
      platform: "social",
      status: "draft",
    },
    memory_writeback: {
      on_approved: "Record approved occasion artwork layout, palette, and template pattern.",
      on_rejected: "Record rejected occasion artwork direction or visual style.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const QUALITY_REVIEW_SKILL = {
  skillId: "quality_review",
  version: "1.0.0",
  displayName: "Quality Review",
  category: "quality",
  config: {
    skill_id: "quality_review",
    version: "1.0.0",
    display_name: "Quality Review",
    category: "quality",
    description: "Reviews a draft for brand fit, platform fit, clarity, CTA quality, repetition risk, and artwork/image prompt fit.",
    required_memory: ["brand_dna", "content_rules", "recent_posts"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "image_style_memory"],
    input_schema: {
      type: "object",
      required: ["postId", "caption", "platform", "contentType", "topic"],
      properties: {
        postId: { type: "string" },
        caption: { type: "string" },
        platform: { type: "string" },
        contentType: { type: "string" },
        topic: { type: "string" },
        imagePrompt: { type: "string" },
        contentSchema: { type: "object" },
      },
    },
    output_schema: {
      type: "object",
      required: ["score", "verdict", "issues", "suggestions", "revisedCaption", "revisedHashtags", "brandFitNotes", "platformFitNotes", "repeatRiskNotes", "ctaSuggestion"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        verdict: { type: "string", enum: ["approve", "improve", "reject"] },
        issues: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } },
        revisedCaption: { type: "string" },
        revisedHashtags: { type: "array", items: { type: "string" } },
        brandFitNotes: { type: "string" },
        platformFitNotes: { type: "string" },
        repeatRiskNotes: { type: "string" },
        ctaSuggestion: { type: "string" },
      },
    },
    prompt_template:
      "Review this draft before approval.\n\nPost ID: {{postId}}\nTopic: {{topic}}\nPlatform: {{platform}}\nContent type: {{contentType}}\nCaption:\n{{caption}}\nImage/artwork prompt:\n{{imagePrompt}}\nContent schema:\n{{contentSchema}}\n\nUse Brand DNA, AI Memory, active Storyline, recent approved/published posts, rejection memory, and performance memory. Judge brand fit, platform fit, clarity, CTA quality, repetition risk, and artwork/image prompt fit. If the draft can be improved, provide revisedCaption and revisedHashtags, but do not assume the app will apply them automatically. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.75,
      checks: ["brand_voice_match", "platform_fit", "clarity", "cta_quality", "repetition_risk", "artwork_prompt_fit"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 2200,
    },
    save_destination: {
      table: "quality_checks",
      status: "reviewed",
    },
    memory_writeback: {},
  },
  isGlobal: true,
  isActive: true,
};

async function ensurePlatformRewriteSkill(skillId: string) {
  if (skillId !== "platform_rewrite" && skillId !== "occasion_artwork" && skillId !== "quality_review") return;
  const skill = skillId === "occasion_artwork"
    ? OCCASION_ARTWORK_SKILL
    : skillId === "quality_review"
      ? QUALITY_REVIEW_SKILL
      : PLATFORM_REWRITE_SKILL;
  await db
    .insert(skillConfigsTable)
    .values(skill)
    .onConflictDoNothing();
}

function stringFromOutput(output: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = output[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function hashtagsFromOutput(output: Record<string, unknown>): string {
  const hashtags = output.hashtags;
  if (Array.isArray(hashtags)) return hashtags.map(String).join(" ");
  if (typeof hashtags === "string") return hashtags;
  const caption = stringFromOutput(output, ["caption", "rewrittenCaption", "revisedCaption"]);
  const extracted = caption.match(/#[\p{L}\p{N}_]+/gu);
  if (extracted?.length) return extracted.join(" ");
  return "";
}

function postTypeForContentType(contentType: string): "social" | "blog" | "newsletter" {
  if (contentType === "blog") return "blog";
  if (contentType === "newsletter") return "newsletter";
  return "social";
}

router.post(
  "/clients/:clientId/skills/:skillId/execute",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId, skillId } = req.params;
    const {
      input,
      campaignId,
      storylineId,
    } = req.body as {
      input?: Record<string, unknown>;
      campaignId?: string;
      storylineId?: string;
    };

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      res.status(400).json({ error: "input object is required" });
      return;
    }

    try {
      await ensurePlatformRewriteSkill(skillId);
      const result = await executeSkill({
        clientId,
        skillId,
        input,
        userId: req.userId,
      });

      const saveDestination = getSkillSaveDestination(result.skill);
      const contentType = saveDestination.content_type ?? result.skill.category ?? "social_post";
      const platform = stringFromOutput(result.output, ["platform"], saveDestination.platform ?? "social");
      const topic = stringFromOutput(result.output, ["topic", "title", "seoTitle", "subject"], typeof input.topic === "string" ? input.topic : "Untitled skill draft");
      const caption = stringFromOutput(result.output, ["caption", "rewrittenCaption", "revisedCaption", "metaDescription", "preheader", "hook"], "");
      const imagePrompt = stringFromOutput(result.output, ["imagePrompt", "visualDirection"], "");
      const title = stringFromOutput(result.output, ["title", "seoTitle", "subject"], "");
      const longFormBody = stringFromOutput(result.output, ["fullDraft", "body", "voiceoverFull"], "");
      const quality = evaluateQuality({ skill: result.skill, output: result.output });

      const [post] = await db.transaction(async (tx) => {
        const [createdPost] = await tx
          .insert(postsTable)
          .values({
            clientId,
            campaignId: campaignId ?? null,
            storylineId: storylineId ?? null,
            skillId,
            contentType,
            contentSchema: skillId === "platform_rewrite"
              ? {
                  ...result.output,
                  caption,
                  sourcePostId: typeof input.sourcePostId === "string" ? input.sourcePostId : null,
                  sourcePlatform: typeof input.sourcePlatform === "string" ? input.sourcePlatform : null,
                  targetPlatform: typeof input.targetPlatform === "string" ? input.targetPlatform : platform,
                  skillId,
                  formatNotes: stringFromOutput(result.output, ["formatNotes"], ""),
                }
              : result.output,
            contentSchemaVersion: 1,
            topic,
            caption,
            hashtags: hashtagsFromOutput(result.output),
            platform,
            postType: postTypeForContentType(contentType),
            title: title || null,
            longFormBody: longFormBody || null,
            imagePrompt: imagePrompt || null,
            qualityScore: quality.score,
            qualityReport: quality.report,
            status: "draft",
            generationStatus: "ready",
            generationMetadata: {
              ...result.metadata,
              route: "skill_engine.execute",
            },
          })
          .returning();

        await tx.insert(qualityChecksTable).values({
          postId: createdPost.id,
          skillId,
          score: quality.score,
          report: quality.report,
        });

        return [createdPost];
      });

      res.json({ post, output: result.output });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }

      const { status, message } = toAiErrorResponse(
        err,
        "Failed to execute skill. Check the skill config and AI provider settings."
      );
      logger.error({ error: safeErrorMessage(err), skillId, clientId }, "Skill execute error");
      res.status(status).json({ error: message });
    }
  }
);

export default router;
