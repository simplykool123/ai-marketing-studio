import { sql } from "drizzle-orm";
import { db } from "../index";
import { skillConfigsTable, type InsertSkillConfig } from "../schema";

type SkillDefinition = {
  skill_id: string;
  version: string;
  display_name: string;
  category: string;
  description: string;
  required_memory: string[];
  optional_memory: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  prompt_template: string;
  quality_gate: Record<string, unknown>;
  provider_routing: Record<string, unknown>;
  save_destination: Record<string, unknown>;
  memory_writeback: Record<string, unknown>;
};

const skillRows = [
  {
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
    } satisfies SkillDefinition,
    isGlobal: true,
    isActive: true,
  },
  {
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
    } satisfies SkillDefinition,
    isGlobal: true,
    isActive: true,
  },
  {
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
    } satisfies SkillDefinition,
    isGlobal: true,
    isActive: true,
  },
  {
    skillId: "linkedin_thought_leader",
    version: "1.0.0",
    displayName: "LinkedIn Thought Leader",
    category: "social_post",
    config: {
      skill_id: "linkedin_thought_leader",
      version: "1.0.0",
      display_name: "LinkedIn Thought Leader",
      category: "social_post",
      description: "Creates a sharp LinkedIn educational or opinion post grounded in brand memory.",
      required_memory: ["brand_dna", "content_rules", "recent_posts"],
      optional_memory: ["story_memory", "performance_memory", "rejection_memory"],
      input_schema: {
        type: "object",
        required: ["topic", "goal"],
        properties: {
          topic: { type: "string" },
          goal: { type: "string", enum: ["authority", "education", "lead_generation", "awareness"] },
          audienceSegment: { type: "string" },
        },
      },
      output_schema: {
        type: "object",
        required: ["title", "caption", "angle", "cta"],
        properties: {
          title: { type: "string" },
          caption: { type: "string" },
          angle: { type: "string" },
          cta: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          imagePrompt: { type: "string" },
        },
      },
      prompt_template:
        "Using the client memory packet, write one LinkedIn post about {{topic}} for {{goal}}. Make it specific, useful, non-generic, and aligned to the brand voice. Return only JSON matching the output schema.",
      quality_gate: {
        min_score: 0.78,
        checks: ["brand_voice_match", "specificity", "no_banned_phrases", "not_too_similar_to_recent_posts"],
      },
      provider_routing: {
        default_quality_mode: "balanced",
        allow_fallback: true,
        max_tokens: 1800,
      },
      save_destination: {
        table: "posts",
        content_type: "social_post",
        platform: "linkedin",
        status: "draft",
      },
      memory_writeback: {
        on_approved: "Record approved LinkedIn angle and CTA pattern.",
        on_rejected: "Record rejection reason and avoid similar angle.",
      },
    } satisfies SkillDefinition,
    isGlobal: true,
    isActive: true,
  },
  {
    skillId: "instagram_carousel_builder",
    version: "1.0.0",
    displayName: "Instagram Carousel Builder",
    category: "carousel",
    config: {
      skill_id: "instagram_carousel_builder",
      version: "1.0.0",
      display_name: "Instagram Carousel Builder",
      category: "carousel",
      description: "Plans an Instagram carousel with slide copy, caption, and visual direction.",
      required_memory: ["brand_dna", "image_style_memory", "content_rules"],
      optional_memory: ["story_memory", "performance_memory", "rejection_memory"],
      input_schema: {
        type: "object",
        required: ["topic", "slideCount"],
        properties: {
          topic: { type: "string" },
          slideCount: { type: "integer", minimum: 4, maximum: 10 },
          goal: { type: "string", enum: ["saveable_education", "product_story", "engagement", "awareness"] },
        },
      },
      output_schema: {
        type: "object",
        required: ["title", "slides", "caption", "visualDirection"],
        properties: {
          title: { type: "string" },
          slides: {
            type: "array",
            items: {
              type: "object",
              required: ["headline", "body", "visual"],
              properties: {
                headline: { type: "string" },
                body: { type: "string" },
                visual: { type: "string" },
              },
            },
          },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          visualDirection: { type: "string" },
        },
      },
      prompt_template:
        "Using the client memory packet, build a {{slideCount}} slide Instagram carousel for {{topic}}. Keep each slide concise, visually clear, and brand-consistent. Return only JSON matching the output schema.",
      quality_gate: {
        min_score: 0.8,
        checks: ["clear_slide_progression", "brand_visual_fit", "caption_quality", "no_generic_advice"],
      },
      provider_routing: {
        default_quality_mode: "balanced",
        allow_fallback: true,
        max_tokens: 2600,
      },
      save_destination: {
        table: "posts",
        content_type: "carousel",
        platform: "instagram",
        status: "draft",
      },
      memory_writeback: {
        on_approved: "Record carousel structure and visual direction that worked.",
        on_rejected: "Record rejected carousel pattern or visual style.",
      },
    } satisfies SkillDefinition,
    isGlobal: true,
    isActive: true,
  },
  {
    skillId: "seo_blog_strategist",
    version: "1.0.0",
    displayName: "SEO Blog Strategist",
    category: "blog",
    config: {
      skill_id: "seo_blog_strategist",
      version: "1.0.0",
      display_name: "SEO Blog Strategist",
      category: "blog",
      description: "Creates an SEO blog plan or draft grounded in brand, audience, and SEO memory.",
      required_memory: ["brand_dna", "seo_memory", "content_rules"],
      optional_memory: ["story_memory", "performance_memory", "recent_posts"],
      input_schema: {
        type: "object",
        required: ["keyword", "intent"],
        properties: {
          keyword: { type: "string" },
          intent: { type: "string", enum: ["informational", "commercial", "comparison", "local"] },
          wordCount: { type: "integer", minimum: 700, maximum: 3000 },
        },
      },
      output_schema: {
        type: "object",
        required: ["seoTitle", "metaDescription", "outline", "fullDraft"],
        properties: {
          seoTitle: { type: "string" },
          metaDescription: { type: "string" },
          slug: { type: "string" },
          outline: { type: "array", items: { type: "string" } },
          fullDraft: { type: "string" },
          faq: { type: "array", items: { type: "object" } },
          targetKeywords: { type: "array", items: { type: "string" } },
        },
      },
      prompt_template:
        "Using the client memory packet, create an SEO-focused blog for {{keyword}} with {{intent}} search intent. Use brand voice, avoid banned phrases, and return only JSON matching the output schema.",
      quality_gate: {
        min_score: 0.82,
        checks: ["search_intent_match", "brand_voice_match", "keyword_naturalness", "useful_outline", "no_duplicate_recent_topic"],
      },
      provider_routing: {
        default_quality_mode: "best_quality",
        allow_fallback: true,
        max_tokens: 6000,
      },
      save_destination: {
        table: "posts",
        content_type: "blog",
        platform: "blog",
        status: "draft",
      },
      memory_writeback: {
        on_approved: "Record approved SEO angle, keyword, and structure.",
        on_rejected: "Record SEO topic or structure to avoid repeating.",
      },
    } satisfies SkillDefinition,
    isGlobal: true,
    isActive: true,
  },
] satisfies InsertSkillConfig[];

export const globalSkillConfigs = skillRows;

export async function seedGlobalSkillConfigs() {
  return db
    .insert(skillConfigsTable)
    .values(skillRows)
    .onConflictDoUpdate({
      target: skillConfigsTable.skillId,
      set: {
        version: sql`excluded.version`,
        displayName: sql`excluded.display_name`,
        category: sql`excluded.category`,
        config: sql`excluded.config`,
        isGlobal: sql`excluded.is_global`,
        clientId: sql`excluded.client_id`,
        isActive: sql`excluded.is_active`,
        updatedAt: new Date(),
      },
    })
    .returning();
}
