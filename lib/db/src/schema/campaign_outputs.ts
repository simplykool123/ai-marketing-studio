import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const campaignOutputsTable = pgTable("campaign_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  campaignId: uuid("campaign_id"), // optional link to campaigns table

  // ── Input params stored for reference / replay ──────────────────────────
  campaignName: text("campaign_name").notNull(),
  goal: text("goal").notNull(),
  monthTheme: text("month_theme"),
  platforms: text("platforms").notNull().default("[]"),   // JSON string[]
  intensity: text("intensity").notNull().default("standard"), // light|standard|aggressive
  qualityMode: text("quality_mode").notNull().default("balanced"), // cheap|balanced|best_quality
  startDate: text("start_date"),
  endDate: text("end_date"),

  // ── Generated outputs (all JSON strings) ────────────────────────────────
  brief: text("brief"),                          // campaign strategy text
  socialPostsJson: text("social_posts_json"),    // SocialPostDraft[]
  blogOutlinesJson: text("blog_outlines_json"),  // BlogOutline[]
  newsletterOutlinesJson: text("newsletter_outlines_json"), // NewsletterOutline[]
  imagePromptsJson: text("image_prompts_json"),  // ImagePromptVariation[]
  videoConceptsJson: text("video_concepts_json"), // VideoConceptDraft[]
  scheduleJson: text("schedule_json"),           // ScheduleEntry[]

  // ── Status ───────────────────────────────────────────────────────────────
  status: text("status").notNull().default("generating"), // generating|ready|failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CampaignOutput = typeof campaignOutputsTable.$inferSelect;
