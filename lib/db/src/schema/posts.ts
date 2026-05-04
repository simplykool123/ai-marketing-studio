import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const postsTable = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  campaignId: uuid("campaign_id"),
  topic: text("topic").notNull(),
  caption: text("caption").notNull(),
  hashtags: text("hashtags"),
  selectedImageUrl: text("selected_image_url"),
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
