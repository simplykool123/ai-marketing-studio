import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brandAssetsTable = pgTable("brand_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  assetType: text("asset_type").notNull().default("reference_image"),
  fileUrl: text("file_url").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBrandAssetSchema = createInsertSchema(brandAssetsTable).omit({ id: true, createdAt: true });
export type InsertBrandAsset = z.infer<typeof insertBrandAssetSchema>;
export type BrandAsset = typeof brandAssetsTable.$inferSelect;
