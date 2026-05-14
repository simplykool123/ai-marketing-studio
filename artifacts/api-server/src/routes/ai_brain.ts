import { Router } from "express";
import { db } from "@workspace/db";
import { aiIdeasTable, postsTable, userSettingsTable } from "@workspace/db/schema";
import { eq, and, notInArray, desc } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket, writeClientMemory } from "../lib/client-memory-packet.js";
import {
  generateTextWithFallback,
  resolveProviderAndModel,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import {
  EDIT_CONTENT_ROLES,
  requireClientRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return settings ?? null;
}

const router = Router();

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

type AvoidEntry = { title: string; status: string; dismissReason: string | null };

function buildAvoidSection(entries: AvoidEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.map((e) => {
    const reason = e.dismissReason ? ` — reason dismissed: "${e.dismissReason}"` : ` (${e.status})`;
    return `- ${e.title}${reason}`;
  });
  return `\n## Memory — do NOT repeat or closely echo these:\n${lines.join("\n")}`;
}

const GOAL_VALUES = "awareness | engagement | lead_generation | trust_building | product_education";

const RESPONSE_SHAPE = `{
  "ideas": [
    {
      "title": "Short catchy title (max 8 words)",
      "idea": "1–2 sentence description of what the post should be about",
      "goal": "one of: awareness | engagement | lead_generation | trust_building | product_education",
      "platforms": ["instagram", "linkedin"],
      "rationale": "WHY this idea works for the brand right now — explicitly mention storyline, brand DNA, past post gap, performance memory, or rejection memory",
      "caption_angle": "Strong opening line or angle (not a description — write it as a hook)",
      "image_direction": "What the ideal image looks like visually — be specific",
      "suggested_date": "YYYY-MM-DD within the next 14 days",
      "storyline_connection": "How this connects to the active storyline, or null",
      "avoid_repeat_warning": "Brief warning if a recent post covered a very similar topic, or null",
      "confidence_score": 85
    }
  ]
}`;

function buildStandardPrompt(context: string, avoidSection: string, today: string): string {
  return `You are a senior digital marketing strategist. Analyse the brand context below and suggest 8 highly specific content ideas for the next 14 days.

${context}
${avoidSection}

Today's date: ${today}

## Rules
- Be SPECIFIC — no generic ideas like "share a tip" or "post an inspirational quote"
- Each idea must serve a clear business goal (${GOAL_VALUES})
- Mix 2–3 platforms across all 8 ideas; tailor tone per platform (LinkedIn = professional, Instagram = visual)
- suggested_date must be a real calendar date within the next 14 days
- If an active storyline exists, connect at least 2 ideas to it
- avoid_repeat_warning: set only when a recent post directly overlaps in topic
- rationale must clearly say why the idea was suggested: based on storyline, based on brand DNA, based on past post gap, based on performance memory, or based on rejection memory
- Vary formats: case study, behind-the-scenes, educational post, social proof, product spotlight, seasonal hook, thought leadership
- Use Content Growth Rules from memory when useful: CTAs, website links, WhatsApp, hashtags, SEO/location/service keywords, and avoid phrases should guide ideas without making posts feel spammy.
- confidence_score (0–100): your honest assessment of how well this idea fits the brand right now
- Do NOT hallucinate trends or statistics
- Do NOT suggest meme or joke content unless brand voice explicitly allows it
- LinkedIn ideas must be more professional and insight-driven
- Instagram ideas can be more visual and emotion-driven

Respond with ONLY valid JSON:
${RESPONSE_SHAPE}`;
}

function buildStrategicPrompt(context: string, avoidSection: string, today: string): string {
  return `You are an agency-level marketing strategist hired to plan the next 14 days of content for this brand. Think deeply about business outcomes, not just content.

${context}
${avoidSection}

Today's date: ${today}

## Strategic Mandate
Generate 6 ideas only. Each idea must:
1. Directly serve a measurable business outcome (${GOAL_VALUES})
2. Be rooted in the brand's specific industry, audience pain points, and USPs — no generic advice
3. Have a clear rationale tied to WHY this moves the needle right now
4. Differ from every other idea in this batch (no overlapping angles)
5. Be the kind of idea a real agency strategist would put in a client deck

## Quality Bar
- confidence_score must reflect genuine fit — do not inflate scores
- If the brand is in pharma/healthcare/regulated industry, ensure all ideas are compliant and avoid making medical claims
- LinkedIn ideas must read as thought leadership, not promotional posts
- Instagram ideas must lead with a visual story, not text-heavy content
- Avoid ideas that are timely only (e.g. "Happy International X Day") unless they tie to brand values
- Apply Content Growth Rules where relevant, especially CTA and keyword opportunities, but do not force links into every idea.

Respond with ONLY valid JSON:
${RESPONSE_SHAPE}`;
}

// ---------------------------------------------------------------------------
// POST /clients/:clientId/brain/generate
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/brain/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    try {
      const { clientId } = req.params;
      const strategic: boolean = req.body?.strategic === true;
      const mode = strategic ? "strategic" : "standard";

      // Full brand + history context
      const memoryPacket = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(memoryPacket);

      // Dismissed/used ideas with reasons so AI builds genuine memory
      const recentIdeas = await db
        .select({
          title: aiIdeasTable.title,
          status: aiIdeasTable.status,
          dismissReason: aiIdeasTable.dismissReason,
        })
        .from(aiIdeasTable)
        .where(
          and(
            eq(aiIdeasTable.clientId, clientId),
            notInArray(aiIdeasTable.status, ["suggested", "saved"])
          )
        )
        .orderBy(desc(aiIdeasTable.createdAt))
        .limit(30);

      const avoidSection = buildAvoidSection(recentIdeas);

      const settings = await getUserSettings(req.userId);
      const { provider, model } = await resolveProviderAndModel(settings, req.userId);

      const today = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      const prompt = strategic
        ? buildStrategicPrompt(context, avoidSection, today)
        : buildStandardPrompt(context, avoidSection, today);

      const { text: responseText, usedProvider, usedModel, fallbackUsed } =
        await generateTextWithFallback(provider, model, prompt, 3000, req.userId);

      logger.info(
        { chosenProvider: usedProvider, chosenModel: usedModel, fallbackUsed, requestedProvider: provider, mode },
        "AI Brain: generation complete"
      );

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Invalid AI response format — no JSON found");
      const parsed = JSON.parse(jsonMatch[0]) as {
        ideas: Array<{
          title: string;
          idea: string;
          goal?: string;
          platforms: string[];
          rationale: string;
          caption_angle: string;
          image_direction: string;
          suggested_date?: string;
          storyline_connection?: string | null;
          avoid_repeat_warning?: string | null;
          confidence_score?: number;
        }>;
      };

      if (!Array.isArray(parsed.ideas)) throw new Error("AI response missing ideas array");

      const VALID_GOALS = new Set([
        "awareness", "engagement", "lead_generation", "trust_building", "product_education",
      ]);

      const inserted = await db
        .insert(aiIdeasTable)
        .values(
          parsed.ideas.map((idea) => ({
            clientId,
            title: idea.title ?? "Untitled Idea",
            idea: idea.idea ?? "",
            goal: VALID_GOALS.has(idea.goal ?? "") ? idea.goal! : null,
            platforms: JSON.stringify(idea.platforms ?? []),
            rationale: idea.rationale ?? "",
            captionAngle: idea.caption_angle ?? "",
            imageDirection: idea.image_direction ?? "",
            suggestedDate: idea.suggested_date ?? null,
            storylineConnection: idea.storyline_connection ?? null,
            avoidRepeatWarning: idea.avoid_repeat_warning ?? null,
            confidenceScore:
              typeof idea.confidence_score === "number"
                ? Math.min(100, Math.max(0, Math.round(idea.confidence_score)))
                : null,
            generationMode: mode,
            status: "suggested",
          }))
        )
        .returning();

      res.json({ ideas: inserted, meta: { mode, provider: usedProvider, fallbackUsed } });
    } catch (err) {
      const { status, message } = toAiErrorResponse(
        err,
        "Failed to generate ideas. Check that your AI provider key is configured in Settings."
      );
      logger.error({ error: safeErrorMessage(err) }, "AI Brain generate error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/brain/ideas
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/brain/ideas",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const { clientId } = req.params;
      const ideas = await db
        .select()
        .from(aiIdeasTable)
        .where(
          and(
            eq(aiIdeasTable.clientId, clientId),
            notInArray(aiIdeasTable.status, ["dismissed"])
          )
        )
        .orderBy(desc(aiIdeasTable.createdAt));

      res.json({ ideas });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "AI Brain list error");
      res.status(500).json({ error: "Failed to load ideas" });
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /clients/:clientId/brain/ideas/:ideaId
// ---------------------------------------------------------------------------

router.patch(
  "/clients/:clientId/brain/ideas/:ideaId",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    try {
      const { clientId, ideaId } = req.params;
      const { status, dismissReason } = req.body as {
        status: "saved" | "dismissed" | "used";
        dismissReason?: string;
      };

      const allowed = ["saved", "dismissed", "used"];
      if (!allowed.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
        return;
      }

      const [updated] = await db
        .update(aiIdeasTable)
        .set({
          status,
          dismissReason: dismissReason ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(aiIdeasTable.id, ideaId), eq(aiIdeasTable.clientId, clientId)))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Idea not found" });
        return;
      }

      if (status === "saved") {
        await writeClientMemory(clientId, "Rejection Memory / Saved AI idea", `User saved AI idea "${updated.title}". Rationale: ${updated.rationale}`);
      }
      if (status === "dismissed") {
        await writeClientMemory(clientId, "Rejection Memory / Dismissed AI idea", `User dismissed "${updated.title}"${dismissReason ? ` because: ${dismissReason}` : "."} Avoid repeating similar ideas.`);
      }

      res.json({ idea: updated });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "AI Brain update error");
      res.status(500).json({ error: "Failed to update idea" });
    }
  }
);

router.post(
  "/clients/:clientId/brain/ideas/:ideaId/use",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    try {
      const { clientId, ideaId } = req.params;
      const [idea] = await db
        .select()
        .from(aiIdeasTable)
        .where(and(eq(aiIdeasTable.id, ideaId), eq(aiIdeasTable.clientId, clientId)))
        .limit(1);

      if (!idea) {
        res.status(404).json({ error: "Idea not found" });
        return;
      }

      let platforms: string[] = [];
      try {
        const parsed = JSON.parse(idea.platforms || "[]");
        platforms = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {}

      const platform = platforms[0] || "instagram";
      const suggestedDate = idea.suggestedDate ? new Date(`${idea.suggestedDate}T09:00:00`) : null;
      const caption = [idea.captionAngle || idea.idea, idea.idea].filter(Boolean).join("\n\n");

      const [post] = await db
        .insert(postsTable)
        .values({
          clientId,
          sourceAiIdeaId: idea.id,
          topic: idea.title,
          caption,
          platform,
          scheduledAt: suggestedDate && !Number.isNaN(suggestedDate.getTime()) ? suggestedDate : undefined,
          postType: platform === "blog" ? "blog" : platform === "newsletter" ? "newsletter" : "social",
          title: ["blog", "newsletter", "youtube"].includes(platform) ? idea.title : undefined,
          imagePrompt: idea.imageDirection || undefined,
          generationStatus: "ready",
          status: "draft",
        })
        .returning();

      const [updatedIdea] = await db
        .update(aiIdeasTable)
        .set({ status: "used", updatedAt: new Date() })
        .where(and(eq(aiIdeasTable.id, idea.id), eq(aiIdeasTable.clientId, clientId)))
        .returning();

      await writeClientMemory(clientId, "Content Rules / Used AI idea", `User used "${idea.title}" as a ${platform} draft. Goal: ${idea.goal ?? "not specified"}. Caption angle: ${idea.captionAngle || "not specified"}.`);

      res.status(201).json({ post, idea: updatedIdea });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "AI Brain use idea error");
      res.status(500).json({ error: "Failed to use idea" });
    }
  }
);

export default router;
