import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const postingLogsTable = pgTable("posting_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  postId: uuid("post_id").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("success"),
  provider: text("provider"),
  payload: jsonb("payload"),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPostingLogSchema = createInsertSchema(postingLogsTable).omit({ id: true, createdAt: true });
export type InsertPostingLog = z.infer<typeof insertPostingLogSchema>;
export type PostingLog = typeof postingLogsTable.$inferSelect;
