import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry"),
  color: text("color").notNull().default("#6366f1"),
  avatarInitials: text("avatar_initials").notNull(),
  logoUrl: text("logo_url"),
  webhookUrl: text("webhook_url"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
