import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const socialAccountsTable = pgTable("social_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  accountName: text("account_name").notNull(),
  accountHandle: text("account_handle"),
  accountId: text("account_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  avatarUrl: text("avatar_url"),
  followerCount: integer("follower_count"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSocialAccountSchema = createInsertSchema(socialAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccountsTable.$inferSelect;
