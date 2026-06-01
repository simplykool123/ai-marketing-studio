import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const blogSiteConnectionsTable = pgTable("blog_site_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  siteName: text("site_name").notNull(),
  siteUrl: text("site_url").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  platform: text("platform").notNull().default("webhook"),
  secretHash: text("secret_hash").notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  status: text("status").notNull().default("active"),
  lastTestStatus: text("last_test_status"),
  lastTestMessage: text("last_test_message"),
  lastTestedAt: timestamp("last_tested_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BlogSiteConnection = typeof blogSiteConnectionsTable.$inferSelect;
