import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import { findOccasion, listOccasionsForYear, occasionDate, type MarketingOccasion } from "../lib/marketing-occasions.js";
import {
  generateTextWithProvider,
  resolveProviderAndModel,
  safeErrorMessage,
  toAiErrorResponse,
} from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

type OccasionDraft = {
  contentType?: string;
  platform?: string;
  topic?: string;
  caption?: string;
  imagePrompt?: string;
  artworkDirection?: string;
  hashtags?: string;
};

type OccasionDraftResponse = {
  drafts?: OccasionDraft[];
};

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return settings ?? null;
}

function buildOccasionPrompt(context: string, occasion: MarketingOccasion, date: string, count: number) {
  return `You are a senior Indian digital marketing strategist. Generate ${count} brand-fit content draft${count === 1 ? "" : "s"} for this marketing calendar occasion.

${context}

## Occasion
Title: ${occasion.title}
Date: ${date}
Category: ${occasion.category}
Observance type: ${occasion.observanceType}
Country: ${occasion.country ?? "GLOBAL"}
Region/state: ${occasion.region ?? "Not applicable"}
Yearly update note: ${occasion.requiresYearlyUpdate ? occasion.notes ?? "Verify date yearly." : "Fixed date."}

## Rules
- Generate between 1 and ${count} drafts, no more.
- Keep it respectful, useful, and brand-safe.
- Include a caption and an imagePrompt/artwork direction for every draft.
- Do not schedule or publish anything.
- Do not claim this calendar is exhaustive.

Respond with ONLY valid JSON:
{
  "drafts": [
    {
      "contentType": "social_post",
      "platform": "instagram",
      "topic": "specific topic",
      "caption": "ready-to-review caption",
      "imagePrompt": "detailed branded image prompt",
      "artworkDirection": "short visual direction",
      "hashtags": "#optional #hashtags"
    }
  ]
}`;
}

router.get("/clients/:clientId/occasions", async (req, res) => {
  const yearParam = Number(req.query.year);
  const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : new Date().getFullYear();
  res.json({
    year,
    sourceNote: "Marketing calendar includes curated Indian occasions and can be expanded yearly.",
    adapterReady: true,
    occasions: listOccasionsForYear(year),
  });
});

router.post(
  "/clients/:clientId/occasions/:occasionId/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId, occasionId } = req.params;
    const occasion = findOccasion(occasionId);
    if (!occasion) {
      res.status(404).json({ error: "Occasion not found" });
      return;
    }

    const count = Math.max(1, Math.min(Number(req.body?.count ?? 2), 3));
    const year = Number(req.body?.year) || new Date().getFullYear();
    const date = occasionDate(occasion, year);

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const settings = await getUserSettings(req.userId);
      const { provider, model } = await resolveProviderAndModel(settings, req.userId);
      const prompt = buildOccasionPrompt(context, occasion, date, count);
      const raw = await generateTextWithProvider(provider, model, prompt, 2200, req.userId);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI returned no JSON");

      const parsed = JSON.parse(jsonMatch[0]) as OccasionDraftResponse;
      const drafts = (Array.isArray(parsed.drafts) ? parsed.drafts : []).slice(0, 3);
      if (!drafts.length) throw new Error("AI returned no drafts");

      const generationMetadata = {
        route: "occasion_calendar.generate",
        provider,
        model,
        occasionId: occasion.id,
        occasionTitle: occasion.title,
        occasionDate: date,
      };

      const inserts = drafts.map((draft) => ({
        clientId,
        contentType: draft.contentType ?? "social_post",
        contentSchema: {
          occasionId: occasion.id,
          occasionTitle: occasion.title,
          occasionDate: date,
          observanceType: occasion.observanceType,
          caption: draft.caption ?? "",
          imagePrompt: draft.imagePrompt ?? draft.artworkDirection ?? "",
          artworkDirection: draft.artworkDirection ?? draft.imagePrompt ?? "",
        },
        contentSchemaVersion: 1,
        topic: draft.topic || `${occasion.title} content idea`,
        caption: draft.caption ?? "",
        hashtags: draft.hashtags ?? "",
        platform: draft.platform ?? "instagram",
        postType: "social" as const,
        status: "draft" as const,
        generationStatus: "ready" as const,
        imagePrompt: draft.imagePrompt ?? draft.artworkDirection ?? null,
        generationMetadata,
      }));

      const createdDrafts = await db.insert(postsTable).values(inserts).returning();
      logger.info({ clientId, occasionId, count: createdDrafts.length }, "Occasion Calendar: drafts created");

      res.json({
        occasion: { ...occasion, date },
        createdDrafts,
      });
    } catch (err) {
      logger.error({ err: safeErrorMessage(err), clientId, occasionId }, "Occasion Calendar generation failed");
      const aiError = toAiErrorResponse(err, "Failed to generate occasion drafts");
      res.status(aiError.status).json({ error: aiError.message });
    }
  }
);

export default router;
