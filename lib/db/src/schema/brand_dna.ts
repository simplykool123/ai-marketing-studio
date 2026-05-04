import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brandDnaTable = pgTable("brand_dna", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  brandName: text("brand_name").notNull(),
  voiceTone: text("voice_tone"),
  targetAudience: text("target_audience"),
  industry: text("industry"),
  brandValues: text("brand_values"),
  visualStyle: text("visual_style"),
  competitors: text("competitors"),
  additionalContext: text("additional_context"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  accentColor: text("accent_color"),
  fontStyle: text("font_style"),
  designNotes: text("design_notes"),
  contentThemes: text("content_themes"),
  postingCadence: text("posting_cadence"),
  audiencePersonas: text("audience_personas"),
  campaignGoals: text("campaign_goals"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrandDnaSchema = createInsertSchema(brandDnaTable).omit({ id: true, updatedAt: true });
export type InsertBrandDna = z.infer<typeof insertBrandDnaSchema>;
export type BrandDna = typeof brandDnaTable.$inferSelect;
