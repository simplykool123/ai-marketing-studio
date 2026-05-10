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
