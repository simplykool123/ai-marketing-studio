import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const imagesTable = pgTable("images", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  postId: uuid("post_id").notNull(),
  url: text("url").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("pending"),
  type: text("type").notNull().default("generated"),
  prompt: text("prompt"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImageSchema = createInsertSchema(imagesTable).omit({ id: true, createdAt: true });
export type InsertImage = z.infer<typeof insertImageSchema>;
export type Image = typeof imagesTable.$inferSelect;
