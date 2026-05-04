import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userSettingsTable = pgTable("user_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  aiProvider: text("ai_provider").notNull().default("anthropic"),
  aiModel: text("ai_model").notNull().default("claude-opus-4-5"),
  imageProvider: text("image_provider").notNull().default("openai"),
  imageModel: text("image_model").notNull().default("dall-e-3"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettingsTable.$inferSelect;
