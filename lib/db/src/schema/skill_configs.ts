import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const skillConfigsTable = pgTable(
  "skill_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: text("skill_id").notNull(),
    version: text("version").notNull().default("1.0.0"),
    displayName: text("display_name").notNull(),
    category: text("category").notNull(),
    config: jsonb("config").notNull(),
    isGlobal: boolean("is_global").notNull().default(true),
    clientId: uuid("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    skillIdUnique: uniqueIndex("skill_configs_skill_id_unique").on(table.skillId),
  })
);

export const insertSkillConfigSchema = createInsertSchema(skillConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSkillConfig = z.infer<typeof insertSkillConfigSchema>;
export type SkillConfig = typeof skillConfigsTable.$inferSelect;
