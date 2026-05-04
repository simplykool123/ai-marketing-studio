import { pgTable, text, timestamp, uuid, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const postingRulesTable = pgTable("posting_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().unique(),
  maxPostsPerDay: jsonb("max_posts_per_day").$type<Record<string, number>>().notNull().default({}),
  preferredWindows: jsonb("preferred_windows").$type<number[]>().notNull().default([9, 12, 15, 18]),
  blackoutDates: jsonb("blackout_dates").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PostingRules = typeof postingRulesTable.$inferSelect;
