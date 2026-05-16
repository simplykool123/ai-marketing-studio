import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const blogSiteConnectionsTable = pgTable("blog_site_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  siteName: text("site_name").notNull(),
  siteUrl: text("site_url").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  secretHash: text("secret_hash").notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BlogSiteConnection = typeof blogSiteConnectionsTable.$inferSelect;
