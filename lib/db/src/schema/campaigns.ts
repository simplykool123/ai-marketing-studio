import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const campaignsTable = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  goal: text("goal"),
  description: text("description"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  platforms: text("platforms"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
