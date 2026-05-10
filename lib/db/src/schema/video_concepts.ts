import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const videoConceptsTable = pgTable("video_concepts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  campaignOutputId: uuid("campaign_output_id"), // optional link to campaign_outputs
  postId: uuid("post_id"),                       // optional link to posts

  // ── Core fields ──────────────────────────────────────────────────────────
  topic: text("topic").notNull(),
  targetPlatform: text("target_platform"),       // instagram_reels|youtube_shorts|tiktok
  hook: text("hook").notNull().default(""),       // opening 3-second hook
  scenesJson: text("scenes_json").notNull().default("[]"),  // VideoScene[] JSON
  voiceoverScript: text("voiceover_script"),
  subtitleStyle: text("subtitle_style"),          // bold_captions|minimal|karaoke
  cta: text("cta"),                               // call-to-action
  estimatedDuration: text("estimated_duration"),  // "30s" | "60s" etc.

  // ── Provider routing ─────────────────────────────────────────────────────
  recommendedProvider: text("recommended_provider"), // kling|runway|pika|luma|veo
  providerNotes: text("provider_notes"),

  // ── Status ───────────────────────────────────────────────────────────────
  status: text("status").notNull().default("draft"), // draft|approved|rendering|done
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type VideoConcept = typeof videoConceptsTable.$inferSelect;

// ── Shared TypeScript shapes (used by routes + frontend) ──────────────────

export type VideoScene = {
  order: number;
  duration: string;        // "3s", "5s"
  visual: string;          // what camera sees
  text: string;            // on-screen text / title
  voiceover: string;       // spoken words for this scene
};
