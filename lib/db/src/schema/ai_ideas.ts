import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiIdeasTable = pgTable("ai_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  title: text("title").notNull(),
  idea: text("idea").notNull(),
  platforms: text("platforms").notNull().default("[]"), // JSON array string
  rationale: text("rationale").notNull().default(""),
  captionAngle: text("caption_angle").notNull().default(""),
  imageDirection: text("image_direction").notNull().default(""),
  suggestedDate: text("suggested_date"),
  storylineConnection: text("storyline_connection"),
  avoidRepeatWarning: text("avoid_repeat_warning"),
  // New agency-level fields
  goal: text("goal"),                        // awareness | engagement | lead_generation | trust_building | product_education
  confidenceScore: integer("confidence_score"), // 0–100
  generationMode: text("generation_mode").notNull().default("standard"), // standard | strategic
  // status: suggested | saved | dismissed | used
  status: text("status").notNull().default("suggested"),
  dismissReason: text("dismiss_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAiIdeaSchema = createInsertSchema(aiIdeasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiIdea = z.infer<typeof insertAiIdeaSchema>;
export type AiIdea = typeof aiIdeasTable.$inferSelect;
