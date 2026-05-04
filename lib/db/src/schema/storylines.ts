import { pgTable, text, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storylinesTable = pgTable("storylines", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  title: text("title").notNull(),
  narrative: text("narrative").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStorylineSchema = createInsertSchema(storylinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStoryline = z.infer<typeof insertStorylineSchema>;
export type Storyline = typeof storylinesTable.$inferSelect;
