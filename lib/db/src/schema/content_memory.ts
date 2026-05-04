import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contentMemoryTable = pgTable("content_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContentMemorySchema = createInsertSchema(contentMemoryTable).omit({ id: true, createdAt: true });
export type InsertContentMemory = z.infer<typeof insertContentMemorySchema>;
export type ContentMemory = typeof contentMemoryTable.$inferSelect;
