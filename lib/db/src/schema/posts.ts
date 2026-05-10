import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { storylinesTable } from "./storylines";

export const postsTable = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  campaignId: uuid("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  storylineId: uuid("storyline_id").references(() => storylinesTable.id, { onDelete: "set null" }),
  sourceAiIdeaId: uuid("source_ai_idea_id"),
  contentType: text("content_type").notNull().default("social_post"),
  contentSchema: jsonb("content_schema").notNull().default({}),
  contentSchemaVersion: integer("content_schema_version").notNull().default(0),
  skillId: text("skill_id"),
  qualityScore: real("quality_score"),
  qualityReport: jsonb("quality_report"),
  generationMetadata: jsonb("generation_metadata"),
  editHistory: jsonb("edit_history").notNull().default([]),
  memoryRefs: uuid("memory_refs").array().notNull().default(sql`'{}'::uuid[]`),
  topic: text("topic").notNull(),
  caption: text("caption").notNull(),
  hashtags: text("hashtags"),
  selectedImageUrl: text("selected_image_url"),
  originalImageUrl: text("original_image_url"),
  brandedImageUrl: text("branded_image_url"),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  platform: text("platform"),
  postType: text("post_type").notNull().default("social"),
  title: text("title"),
  longFormBody: text("long_form_body"),
  generationStatus: text("generation_status"),
  imagePrompt: text("image_prompt"),
  publishedAt: timestamp("published_at"),
  publishedUrl: text("published_url"),
  publishError: text("publish_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
