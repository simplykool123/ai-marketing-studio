import { jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { postsTable } from "./posts";

export const qualityChecksTable = pgTable("quality_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").references(() => postsTable.id, { onDelete: "cascade" }),
  skillId: text("skill_id"),
  score: real("score").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQualityCheckSchema = createInsertSchema(qualityChecksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertQualityCheck = z.infer<typeof insertQualityCheckSchema>;
export type QualityCheck = typeof qualityChecksTable.$inferSelect;
