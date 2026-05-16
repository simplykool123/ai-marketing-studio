import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, qualityChecksTable, skillConfigsTable, type Post } from "@workspace/db/schema";
import { buildClientMemoryPacket } from "../lib/client-memory-packet.js";
import { executeSkill, getSkillSaveDestination, SkillEngineError } from "../lib/skill-engine.js";
import { evaluateQuality } from "../lib/quality-gate.js";
import { getProviderKeyStatus, toAiErrorResponse, safeErrorMessage } from "../lib/ai-provider.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
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
      "Rewrite the source caption from {{sourcePlatform}} for {{targetPlatform}}.\n\nTopic: {{topic}}\nSource caption:\n{{sourceCaption}}\n\nUse Brand DNA, AI Memory, Content Growth Rules, the active Storyline if present, and recent posts to avoid repetition. Keep the same strategic idea, but adapt length, tone, CTA, link/WhatsApp usage, hashtags, SEO keywords, and formatting for the target platform. For Blog intro, write only an intro-style caption/lead, not a full blog. Return only JSON matching the output schema.",
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
      "Review this draft before approval.\n\nPost ID: {{postId}}\nTopic: {{topic}}\nPlatform: {{platform}}\nContent type: {{contentType}}\nCaption:\n{{caption}}\nImage/artwork prompt:\n{{imagePrompt}}\nContent schema:\n{{contentSchema}}\n\nUse Brand DNA, AI Memory, Content Growth Rules, active Storyline, recent approved/published posts, rejection memory, and performance memory. Judge brand fit, platform fit, CTA quality, website/WhatsApp/link usage, hashtags, SEO keywords, avoid phrases, trend relevance, posting readiness, repetition risk, and artwork/image prompt fit. If the draft can be improved, provide revisedCaption and revisedHashtags, but do not assume the app will apply them automatically. Return only JSON matching the output schema.",
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

const CONTENT_QUALITY_REVIEWER_SKILL = {
  ...QUALITY_REVIEW_SKILL,
  skillId: "content_quality_reviewer",
  displayName: "Content Quality Reviewer",
  config: {
    ...QUALITY_REVIEW_SKILL.config,
    skill_id: "content_quality_reviewer",
    display_name: "Content Quality Reviewer",
    description: "Reviews generated social, carousel, blog, and short-video drafts for business readiness before Review approval.",
    prompt_template:
      "Review this generated draft before it reaches approval.\n\nTopic: {{topic}}\nPlatform: {{platform}}\nContent type: {{contentType}}\nCaption/body/script:\n{{caption}}\nContent schema:\n{{contentSchema}}\n\nUse Brand DNA, AI Memory, Content Growth Rules, active Storyline, recent approved/published posts, rejection memory, and performance memory. Judge brand fit, platform fit, CTA quality, website/WhatsApp/link usage, hashtags, SEO keywords, avoid phrases, trend relevance, posting readiness, repetition risk, and media readiness. Return a practical non-blocking review. Return only JSON matching the output schema.",
    save_destination: {
      table: "quality_checks",
      status: "reviewed",
    },
    memory_writeback: {},
  },
};

const SOCIAL_POST_CREATOR_SKILL = {
  skillId: "social_post_creator",
  version: "1.0.0",
  displayName: "Social Post Creator",
  category: "social_post",
  config: {
    skill_id: "social_post_creator",
    version: "1.0.0",
    display_name: "Social Post Creator",
    category: "social_post",
    description: "Creates one high-quality platform-ready social post draft from a brief, trend context, Brand DNA, AI Memory, and Content Growth Rules.",
    required_memory: ["brand_dna", "content_rules", "recent_posts"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "social_intelligence"],
    input_schema: {
      type: "object",
      required: ["topic", "platform"],
      properties: {
        topic: { type: "string", description: "The post idea or business topic." },
        platform: { type: "string", description: "Target platform such as instagram, linkedin, facebook, or twitter." },
        goal: { type: "string", description: "Optional content goal such as awareness, engagement, leads, or sales." },
        trendContext: { type: "string", description: "Optional trend insight or source angle." },
        notes: { type: "string", description: "Optional extra direction from the user." },
      },
    },
    output_schema: {
      type: "object",
      required: ["topic", "platform", "caption", "hook", "body", "cta", "hashtags", "imagePrompt", "qualityRationale"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string" },
        caption: { type: "string" },
        hook: { type: "string" },
        body: { type: "string" },
        cta: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        imagePrompt: { type: "string" },
        qualityRationale: { type: "string" },
        trendContextUsed: { type: "string" },
      },
    },
    prompt_template:
      "Create a polished {{platform}} social post for this topic:\n{{topic}}\n\nGoal: {{goal}}\nTrend context: {{trendContext}}\nExtra notes: {{notes}}\n\nUse Brand DNA, AI Memory, Content Growth Rules, active Storyline if present, and recent posts. Apply platform structure: Instagram needs hook, short value body, CTA, and relevant hashtags; LinkedIn needs a professional hook, useful insight, soft CTA, and fewer hashtags; Facebook should be friendly with link/WhatsApp only when useful; X/Twitter must be concise. Do not force spammy links. Avoid banned phrases. Include an imagePrompt suitable for Image Studio. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.78,
      checks: ["brand_voice_match", "platform_fit", "cta_quality", "growth_rules_used", "not_repetitive"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 2200,
    },
    save_destination: {
      table: "posts",
      content_type: "social_post",
      platform: "social",
      status: "draft",
    },
    memory_writeback: {
      on_approved: "Record approved social post hook, CTA, platform format, and topic pattern.",
      on_rejected: "Record rejected social post angle, tone, or formatting issue.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const INSTAGRAM_CAROUSEL_BUILDER_SKILL = {
  skillId: "instagram_carousel_builder",
  version: "1.0.0",
  displayName: "Instagram Carousel Builder",
  category: "carousel",
  config: {
    skill_id: "instagram_carousel_builder",
    version: "1.0.0",
    display_name: "Instagram Carousel Builder",
    category: "carousel",
    description: "Builds a structured Instagram carousel with slide copy, caption, CTA, and visual direction.",
    required_memory: ["brand_dna", "content_rules", "image_style_memory"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "recent_posts"],
    input_schema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string", description: "Carousel topic or audience problem." },
        platform: { type: "string", description: "Usually instagram." },
        goal: { type: "string" },
        trendContext: { type: "string" },
        notes: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["topic", "platform", "caption", "cta", "hashtags", "slides", "coverHeadline", "visualDirection", "imagePrompt"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string" },
        coverHeadline: { type: "string" },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slide: { type: "number" },
              headline: { type: "string" },
              body: { type: "string" },
              visualNote: { type: "string" },
            },
          },
        },
        caption: { type: "string" },
        cta: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        visualDirection: { type: "string" },
        imagePrompt: { type: "string" },
      },
    },
    prompt_template:
      "Build an Instagram carousel for this topic:\n{{topic}}\n\nGoal: {{goal}}\nTrend context: {{trendContext}}\nExtra notes: {{notes}}\n\nUse Brand DNA, visual style memory, Content Growth Rules, and recent post memory. Create 5-7 slides. Slide 1 must have a strong cover headline. Slides must be concise enough for artwork. Caption should include hook, value, CTA, and hashtags. Recommend a premium brand-safe visual direction and a background/image prompt with no rendered text. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.78,
      checks: ["slide_structure", "brand_visual_fit", "platform_fit", "cta_quality"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 2800,
    },
    save_destination: {
      table: "posts",
      content_type: "carousel",
      platform: "instagram",
      status: "draft",
    },
    memory_writeback: {
      on_approved: "Record approved carousel structure, cover hook, and visual direction.",
      on_rejected: "Record rejected carousel angle, slide structure, or visual direction.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const SEO_BLOG_WRITER_SKILL = {
  skillId: "seo_blog_writer",
  version: "1.0.0",
  displayName: "SEO Blog Writer",
  category: "blog",
  config: {
    skill_id: "seo_blog_writer",
    version: "1.0.0",
    display_name: "SEO Blog Writer",
    category: "blog",
    description: "Creates an SEO-friendly blog draft with title, outline, body, meta description, CTA, and social excerpt.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "recent_posts", "social_intelligence"],
    input_schema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string" },
        goal: { type: "string" },
        trendContext: { type: "string" },
        notes: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["topic", "title", "seoTitle", "metaDescription", "keywordFocus", "outline", "fullDraft", "cta", "caption"],
      properties: {
        topic: { type: "string" },
        title: { type: "string" },
        seoTitle: { type: "string" },
        metaDescription: { type: "string" },
        keywordFocus: { type: "array", items: { type: "string" } },
        outline: { type: "array", items: { type: "string" } },
        fullDraft: { type: "string" },
        cta: { type: "string" },
        caption: { type: "string" },
      },
    },
    prompt_template:
      "Write a client-ready SEO blog draft for this topic:\n{{topic}}\n\nGoal: {{goal}}\nTrend context: {{trendContext}}\nExtra notes: {{notes}}\n\nUse Brand DNA, Content Growth Rules, SEO keywords, location/service keywords, website link rules, and AI Memory. Produce useful original guidance, not filler. Include a concise social caption excerpt for Review. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.78,
      checks: ["seo_focus", "brand_voice_match", "cta_quality", "useful_structure"],
    },
    provider_routing: {
      default_quality_mode: "best_quality",
      allow_fallback: true,
      max_tokens: 4200,
    },
    save_destination: {
      table: "posts",
      content_type: "blog",
      platform: "blog",
      status: "draft",
    },
    memory_writeback: {
      on_approved: "Record approved blog topic, SEO focus, CTA, and useful structure.",
      on_rejected: "Record rejected blog angle, SEO mismatch, or tone issue.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const SHORT_VIDEO_REEL_SCRIPT_SKILL = {
  skillId: "short_video_reel_script",
  version: "1.0.0",
  displayName: "Short Video Reel Script",
  category: "video",
  config: {
    skill_id: "short_video_reel_script",
    version: "1.0.0",
    display_name: "Short Video Reel Script",
    category: "video",
    description: "Creates a short-form video/Reel script with hook, scene beats, voiceover, caption, CTA, and production notes.",
    required_memory: ["brand_dna", "content_rules", "image_style_memory"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "recent_posts", "social_intelligence"],
    input_schema: {
      type: "object",
      required: ["topic", "platform"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string" },
        goal: { type: "string" },
        trendContext: { type: "string" },
        notes: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["topic", "platform", "hook", "scenes", "voiceoverFull", "caption", "cta", "visualDirection", "productionNotes"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string" },
        hook: { type: "string" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene: { type: "number" },
              visual: { type: "string" },
              voiceover: { type: "string" },
              onScreenText: { type: "string" },
            },
          },
        },
        voiceoverFull: { type: "string" },
        caption: { type: "string" },
        cta: { type: "string" },
        visualDirection: { type: "string" },
        productionNotes: { type: "string" },
      },
    },
    prompt_template:
      "Create a premium short-form video/Reel script for {{platform}}.\n\nTopic: {{topic}}\nGoal: {{goal}}\nTrend context: {{trendContext}}\nExtra notes: {{notes}}\n\nUse Brand DNA, Content Growth Rules, AI Memory, and visual style memory. Create a sharp opening hook, 5-7 scene beats, voiceover, optional on-screen text, caption, CTA, and practical production notes. Do not claim exact trending audio unless verified; suggest a style only if useful. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.78,
      checks: ["hook_strength", "scene_structure", "brand_fit", "platform_fit", "cta_quality"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 3200,
    },
    save_destination: {
      table: "posts",
      content_type: "video",
      platform: "instagram_reels",
      status: "draft",
    },
    memory_writeback: {
      on_approved: "Record approved short-video hook, scene structure, and CTA pattern.",
      on_rejected: "Record rejected video hook, pacing, trend usage, or visual direction.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const INITIAL_GLOBAL_SKILLS = [
  PLATFORM_REWRITE_SKILL,
  OCCASION_ARTWORK_SKILL,
  QUALITY_REVIEW_SKILL,
  CONTENT_QUALITY_REVIEWER_SKILL,
  SOCIAL_POST_CREATOR_SKILL,
  INSTAGRAM_CAROUSEL_BUILDER_SKILL,
  SEO_BLOG_WRITER_SKILL,
  SHORT_VIDEO_REEL_SCRIPT_SKILL,
];

async function ensureInitialGlobalSkill(skillId: string) {
  const skill = INITIAL_GLOBAL_SKILLS.find((candidate) => candidate.skillId === skillId);
  if (!skill) return;
  await db
    .insert(skillConfigsTable)
    .values(skill)
    .onConflictDoNothing();
}

async function ensureInitialGlobalSkills() {
  for (const skill of INITIAL_GLOBAL_SKILLS) {
    await db
      .insert(skillConfigsTable)
      .values(skill)
      .onConflictDoNothing();
  }
}

function stringFromOutput(output: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = output[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const nestedText = [nested.voiceover, nested.onScreenText, nested.on_screen_text, nested.text]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ");
      if (nestedText.trim()) return nestedText;
    }
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

function arrayFromOutput(output: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = output[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function blogDraftText(value: unknown): string {
  if (typeof value === "string") return value;
  const draft = objectFrom(value);
  if (!Object.keys(draft).length) return "";
  const paragraphs = Array.isArray(draft.body_paragraphs)
    ? draft.body_paragraphs.map((item) => {
        const row = objectFrom(item);
        return [row.heading ? `## ${row.heading}` : null, row.content].filter(Boolean).join("\n");
      })
    : [];
  return [
    draft.title ? `# ${draft.title}` : null,
    draft.introduction,
    ...paragraphs,
    draft.conclusion ? `## Conclusion\n${draft.conclusion}` : null,
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("\n\n");
}

function normalizeSkillOutput(skillId: string, rawOutput: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  const output = { ...rawOutput };
  const inputTopic = typeof input.topic === "string" ? input.topic : "Untitled skill draft";

  if (skillId === "instagram_carousel_builder") {
    const rawSlides = arrayFromOutput(rawOutput, ["slides", "carousel_slides"]);
    const slides = rawSlides.map((slide, index) => {
      const row = objectFrom(slide);
      return {
        ...row,
        slide: row.slide ?? row.slide_number ?? index + 1,
        headline: stringFromOutput(row, ["headline", "title"], `Slide ${index + 1}`),
        body: stringFromOutput(row, ["body", "text", "caption"], ""),
        visualNote: stringFromOutput(row, ["visualNote", "visual_idea", "visual"], ""),
      };
    });
    const coverHeadline = stringFromOutput(rawOutput, ["coverHeadline", "cover_headline", "title"], stringFromOutput(objectFrom(rawSlides[0]), ["headline", "title"], inputTopic));
    const caption = stringFromOutput(rawOutput, ["caption"], [
      coverHeadline,
      ...slides.slice(1).map((slide) => `${slide.headline}: ${slide.body}`),
      stringFromOutput(rawOutput, ["cta", "call_to_action"], ""),
    ].filter(Boolean).join("\n"));
    output.slides = slides;
    output.coverHeadline = coverHeadline;
    output.caption = caption;
    output.cta = stringFromOutput(rawOutput, ["cta", "call_to_action"], "Swipe through and save this for later.");
    output.hashtags = rawOutput.hashtags ?? [];
    output.visualDirection = stringFromOutput(rawOutput, ["visualDirection", "visual_direction"], slides.map((slide) => slide.visualNote).filter(Boolean).join(" "));
    output.imagePrompt = stringFromOutput(rawOutput, ["imagePrompt", "image_prompt"], output.visualDirection as string);
    output.platform = stringFromOutput(rawOutput, ["platform"], "instagram");
    output.topic = stringFromOutput(rawOutput, ["topic"], inputTopic);
  }

  if (skillId === "seo_blog_writer") {
    const fullDraft = stringFromOutput(rawOutput, ["fullDraft", "body", "blog_draft"], blogDraftText(rawOutput.blog_post_draft));
    const title = stringFromOutput(rawOutput, ["title", "seoTitle", "blog_title"], stringFromOutput(objectFrom(rawOutput.blog_post_draft), ["title"], inputTopic));
    const bodyParagraphs = arrayFromOutput(objectFrom(rawOutput.blog_post_draft), ["body_paragraphs"]);
    output.title = title;
    output.seoTitle = stringFromOutput(rawOutput, ["seoTitle", "seo_title", "blog_title"], title);
    output.metaDescription = stringFromOutput(rawOutput, ["metaDescription", "meta_description", "summary"], stringFromOutput(rawOutput, ["social_caption_excerpt"], title));
    output.keywordFocus = rawOutput.keywordFocus ?? rawOutput.keyword_focus ?? rawOutput.seo_keywords ?? [];
    output.outline = rawOutput.outline ?? rawOutput.sections ?? bodyParagraphs.map((item) => stringFromOutput(objectFrom(item), ["heading"], "")).filter(Boolean);
    output.fullDraft = fullDraft;
    output.cta = stringFromOutput(rawOutput, ["cta", "call_to_action"], stringFromOutput(objectFrom(rawOutput.blog_post_draft), ["conclusion"], ""));
    output.caption = stringFromOutput(rawOutput, ["caption", "social_caption_excerpt", "metaDescription", "meta_description"], title);
    output.topic = stringFromOutput(rawOutput, ["topic"], inputTopic);
    output.platform = stringFromOutput(rawOutput, ["platform"], "blog");
  }

  if (skillId === "short_video_reel_script") {
    const rawScenes = arrayFromOutput(rawOutput, ["scenes"]);
    output.scenes = rawScenes.map((scene, index) => {
      const row = objectFrom(scene);
      return {
        ...row,
        scene: row.scene ?? row.scene_number ?? index + 1,
        visual: stringFromOutput(row, ["visual"], ""),
        voiceover: stringFromOutput(row, ["voiceover"], ""),
        onScreenText: stringFromOutput(row, ["onScreenText", "on_screen_text", "text"], ""),
      };
    });
    output.hook = stringFromOutput(rawOutput, ["hook"], inputTopic);
    output.cta = stringFromOutput(rawOutput, ["cta", "call_to_action"], "");
    output.visualDirection = stringFromOutput(rawOutput, ["visualDirection", "visual_direction"], "");
    output.productionNotes = stringFromOutput(rawOutput, ["productionNotes", "production_notes"], "");
    output.title = stringFromOutput(rawOutput, ["title", "script_title"], inputTopic);
    output.topic = stringFromOutput(rawOutput, ["topic"], inputTopic);
    output.platform = stringFromOutput(rawOutput, ["platform"], typeof input.platform === "string" ? input.platform : "instagram_reels");
  }

  if (skillId === "social_post_creator") {
    output.topic = stringFromOutput(rawOutput, ["topic"], inputTopic);
    output.platform = stringFromOutput(rawOutput, ["platform"], typeof input.platform === "string" ? input.platform : "social");
    output.caption = stringFromOutput(rawOutput, ["caption", "hook"], stringFromOutput(rawOutput, ["body"], inputTopic));
    output.cta = stringFromOutput(rawOutput, ["cta", "call_to_action"], "");
    output.imagePrompt = stringFromOutput(rawOutput, ["imagePrompt", "image_prompt", "visualDirection"], "");
  }

  return output;
}

function postTypeForContentType(contentType: string): "social" | "blog" | "newsletter" {
  if (contentType === "blog") return "blog";
  if (contentType === "newsletter") return "newsletter";
  return "social";
}

router.get(
  "/clients/:clientId/skills/connectivity",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const creativeSkillIds = [
      "social_post_creator",
      "instagram_carousel_builder",
      "seo_blog_writer",
      "short_video_reel_script",
      "content_quality_reviewer",
    ];

    const checks: Array<{
      id: string;
      label: string;
      status: "green" | "yellow" | "red";
      message: string;
    }> = [];

    try {
      await ensureInitialGlobalSkills();
      const skills = await db
        .select({
          skillId: skillConfigsTable.skillId,
          displayName: skillConfigsTable.displayName,
          isActive: skillConfigsTable.isActive,
        })
        .from(skillConfigsTable);
      const skillMap = new Map(skills.map((skill) => [skill.skillId, skill]));
      const missingSkills = creativeSkillIds.filter((skillId) => !skillMap.get(skillId)?.isActive);
      checks.push({
        id: "skill_configs",
        label: "Skill configs available",
        status: missingSkills.length ? "red" : "green",
        message: missingSkills.length
          ? `Missing or inactive: ${missingSkills.join(", ")}.`
          : "Creative Studio skills are seeded and active.",
      });

      const providerStatus = await getProviderKeyStatus(req.userId);
      const configuredProviders = Object.entries(providerStatus)
        .filter(([, status]) => status.keyExists)
        .map(([provider, status]) => `${provider} (${status.source})`);
      checks.push({
        id: "ai_keys",
        label: "AI key configured",
        status: configuredProviders.length ? "green" : "red",
        message: configuredProviders.length
          ? `Configured: ${configuredProviders.join(", ")}.`
          : "No AI provider key configured. Add one in Settings -> AI Keys.",
      });

      let providerRoute: { provider: string; model: string; label: string } | null = null;
      try {
        providerRoute = await resolveTextProviderForMode("balanced", req.userId);
        checks.push({
          id: "provider_route",
          label: "Provider route resolved",
          status: "green",
          message: `${providerRoute.label} is ready for balanced skill generation.`,
        });
      } catch (err) {
        checks.push({
          id: "provider_route",
          label: "Provider route resolved",
          status: "red",
          message: err instanceof Error ? err.message : "Could not resolve an AI provider route.",
        });
      }

      try {
        const packet = await buildClientMemoryPacket(clientId);
        const memoryCount = packet.memoryEntries.length;
        checks.push({
          id: "memory_packet",
          label: "Memory packet loaded",
          status: packet.client ? "green" : "yellow",
          message: packet.client
            ? `Loaded Brand DNA/context packet with ${memoryCount} memory entries.`
            : "Client context loaded, but client profile was not found.",
        });
      } catch (err) {
        checks.push({
          id: "memory_packet",
          label: "Memory packet loaded",
          status: "red",
          message: err instanceof Error ? err.message : "Could not load client memory packet.",
        });
      }

      const status = checks.some((check) => check.status === "red")
        ? "red"
        : checks.some((check) => check.status === "yellow")
          ? "yellow"
          : "green";

      res.json({
        status,
        generatedAt: new Date().toISOString(),
        skills: creativeSkillIds.map((skillId) => ({
          skillId,
          displayName: skillMap.get(skillId)?.displayName ?? skillId,
          active: Boolean(skillMap.get(skillId)?.isActive),
        })),
        providerRoute,
        checks,
      });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err), clientId }, "Skill connectivity check failed");
      res.status(500).json({ error: "Failed to check AI skill connectivity." });
    }
  }
);

function qualityBadgeForReview(output: Record<string, unknown> | null, fallbackScore: number): "Good" | "Needs Review" | "Weak Brand Match" {
  function nested(path: string): unknown {
    return path.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in acc) return (acc as Record<string, unknown>)[part];
      return undefined;
    }, output ?? {});
  }

  if (output) {
    const verdict = [
      output.verdict,
      output.status,
      output.overall_score,
      nested("review.status"),
      nested("review.overall_score"),
      nested("feedback.overall_score"),
    ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
    const brandFitNotes = [
      output.brandFitNotes,
      nested("review.brandFitNotes"),
      nested("review.review_details.brand_fit.score"),
      nested("review.review_details.brand_fit.notes"),
    ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
    const rawScore = typeof output.score === "number" ? output.score : typeof nested("review.score") === "number" ? nested("review.score") : Number(output.score);
    const score = typeof rawScore === "number" ? rawScore : Number(rawScore);

    if (verdict.includes("reject") || brandFitNotes.includes("weak") || (!Number.isNaN(score) && score < 0.55)) {
      return "Weak Brand Match";
    }
    if (verdict.includes("improve") || verdict.includes("needs") || (!Number.isNaN(score) && score < 0.75)) return "Needs Review";
    if (verdict.includes("approve") || verdict.includes("approved") || verdict.includes("excellent") || verdict.includes("good")) return "Good";
  }

  if (fallbackScore >= 0.78) return "Good";
  if (fallbackScore >= 0.55) return "Needs Review";
  return "Weak Brand Match";
}

async function runNonBlockingQualityReview({
  clientId,
  userId,
  postId,
  topic,
  platform,
  contentType,
  caption,
  contentSchema,
}: {
  clientId: string;
  userId?: string;
  postId?: string;
  topic: string;
  platform: string;
  contentType: string;
  caption: string;
  contentSchema: Record<string, unknown>;
}): Promise<{ output: Record<string, unknown>; metadata: Record<string, unknown> } | null> {
  try {
    await ensureInitialGlobalSkill("content_quality_reviewer");
    const result = await executeSkill({
      clientId,
      skillId: "content_quality_reviewer",
      userId,
      input: {
        postId: postId ?? "pending",
        topic,
        platform,
        contentType,
        caption,
        contentSchema,
      },
    });
    logger.info(
      {
        skillId: "content_quality_reviewer",
        clientId,
        provider: result.metadata.provider,
        model: result.metadata.model,
        fallbackUsed: result.metadata.fallbackUsed,
      },
      "Skill quality review executed"
    );
    return { output: result.output, metadata: result.metadata };
  } catch (err) {
    logger.warn(
      { error: safeErrorMessage(err), clientId, postId },
      "Skill quality review skipped"
    );
    return null;
  }
}

export async function executeSkillToReviewDraft({
  clientId,
  skillId,
  input,
  userId,
  campaignId,
  storylineId,
  scheduledAt,
  extraContentSchema,
  generationRoute = "skill_engine.execute",
}: {
  clientId: string;
  skillId: string;
  input: Record<string, unknown>;
  userId?: string;
  campaignId?: string | null;
  storylineId?: string | null;
  scheduledAt?: Date | null;
  extraContentSchema?: Record<string, unknown>;
  generationRoute?: string;
}): Promise<{
  post: Post;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  skill: { skillId: string; version: string; displayName: string; category: string };
}> {
  await ensureInitialGlobalSkill(skillId);
  const result = await executeSkill({
    clientId,
    skillId,
    input,
    userId,
  });
  const output = normalizeSkillOutput(skillId, result.output, input);

  const saveDestination = getSkillSaveDestination(result.skill);
  const contentType = saveDestination.content_type ?? result.skill.category ?? "social_post";
  const platform = stringFromOutput(output, ["platform"], saveDestination.platform ?? "social");
  const topic = stringFromOutput(output, ["topic", "title", "seoTitle", "subject"], typeof input.topic === "string" ? input.topic : "Untitled skill draft");
  const caption = stringFromOutput(output, ["caption", "rewrittenCaption", "revisedCaption", "metaDescription", "preheader", "hook"], "");
  const imagePrompt = stringFromOutput(output, ["imagePrompt", "visualDirection"], "");
  const title = stringFromOutput(output, ["title", "seoTitle", "subject"], "");
  const longFormBody = stringFromOutput(output, ["fullDraft", "body", "voiceoverFull"], "");
  const quality = evaluateQuality({ skill: result.skill, output });
  const shouldRunQualityReview = skillId !== "content_quality_reviewer" && skillId !== "quality_review";
  const aiQualityReview = shouldRunQualityReview
    ? await runNonBlockingQualityReview({
        clientId,
        userId,
        topic,
        platform,
        contentType,
        caption: caption || longFormBody,
        contentSchema: output,
      })
    : null;
  const qualityBadge = qualityBadgeForReview(aiQualityReview?.output ?? null, quality.score);
  const skillMetadata = {
    skillId,
    skillVersion: result.skill.version,
    provider: result.metadata.provider,
    model: result.metadata.model,
    fallbackUsed: result.metadata.fallbackUsed,
    qualityScore: quality.score,
    qualityBadge,
  };
  logger.info(
      {
        skillId,
        clientId,
        campaignId,
        provider: result.metadata.provider,
        model: result.metadata.model,
        fallbackUsed: result.metadata.fallbackUsed,
    },
    "Skill executed"
  );

  const contentSchema = skillId === "platform_rewrite"
    ? {
        ...output,
        ...(extraContentSchema ?? {}),
        caption,
        sourcePostId: typeof input.sourcePostId === "string" ? input.sourcePostId : null,
        sourcePlatform: typeof input.sourcePlatform === "string" ? input.sourcePlatform : null,
        targetPlatform: typeof input.targetPlatform === "string" ? input.targetPlatform : platform,
        skillId,
        aiSkill: skillMetadata,
        qualityReview: aiQualityReview?.output ?? null,
        formatNotes: stringFromOutput(result.output, ["formatNotes"], ""),
      }
    : {
        ...output,
        ...(extraContentSchema ?? {}),
        aiSkill: skillMetadata,
        qualityReview: aiQualityReview?.output ?? null,
      };

  const [post] = await db.transaction(async (tx) => {
    const [createdPost] = await tx
      .insert(postsTable)
      .values({
        clientId,
        campaignId: campaignId ?? null,
        storylineId: storylineId ?? null,
        skillId,
        contentType,
        contentSchema,
        contentSchemaVersion: 1,
        topic,
        caption,
        hashtags: hashtagsFromOutput(output),
        platform,
        postType: postTypeForContentType(contentType),
        title: title || null,
        longFormBody: longFormBody || null,
        imagePrompt: imagePrompt || null,
        qualityScore: quality.score,
        qualityReport: quality.report,
        status: "draft",
        scheduledAt: scheduledAt ?? null,
        generationStatus: "ready",
        generationMetadata: {
          ...result.metadata,
          skillVersion: result.skill.version,
          qualityScore: quality.score,
          qualityBadge,
          qualityReviewMetadata: aiQualityReview?.metadata ?? null,
          route: generationRoute,
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

  return {
    post,
    output,
    metadata: {
      ...result.metadata,
      skillVersion: result.skill.version,
      qualityScore: quality.score,
      qualityBadge,
      qualityReview: aiQualityReview,
    },
    skill: {
      skillId: result.skill.skillId,
      version: result.skill.version,
      displayName: result.skill.displayName,
      category: result.skill.category,
    },
  };
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
      const result = await executeSkillToReviewDraft({
        clientId,
        skillId,
        input,
        userId: req.userId,
        campaignId: campaignId ?? null,
        storylineId: storylineId ?? null,
      });

      res.json({
        post: result.post,
        output: result.output,
        metadata: result.metadata,
        skill: result.skill,
      });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err instanceof Error && err.message.includes("No AI provider API keys configured")) {
        res.status(503).json({ error: "No AI provider key configured. Add one in Settings → AI Keys." });
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
