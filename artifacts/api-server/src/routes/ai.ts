import { Router } from "express";
import OpenAI from "openai";
import { buildClientContext, buildImagePrompt } from "../lib/context-engine.js";
import { GenerateCaptionsBody, GenerateImagesBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  EDIT_CONTENT_ROLES,
  requireClientRole,
  userHasClientRole,
  type AuthRequest,
} from "../middleware/auth.js";
import {
  generateTextWithProvider,
  resolveProviderAndModel,
  resolveApiKey,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { logger } from "../lib/logger.js";

const router = Router();

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return settings ?? null;
}

router.post("/ai/generate-captions", async (req: AuthRequest, res) => {
  try {
    const body = GenerateCaptionsBody.parse(req.body);
    const hasAccess = await userHasClientRole(req.userId!, body.clientId, EDIT_CONTENT_ROLES);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }

    const context = await buildClientContext(body.clientId);
    const settings = await getUserSettings(req.userId);
    const { provider, model } = await resolveProviderAndModel(settings, req.userId);

    const prompt = `You are a professional social media content strategist. Using the brand context below, generate exactly 3 distinct caption options for a post about the given topic. Each caption must match the brand's voice and tone.

${context}

## Post Topic
${body.topic}

## Instructions
- Generate exactly 3 caption options
- Each caption should be distinct in approach and style
- Include relevant hashtags for each caption (5-10 hashtags)
- Keep captions engaging and platform-appropriate
- Do NOT number the captions in the text itself

Respond with ONLY valid JSON in this exact format:
{
  "options": [
    { "id": 1, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" },
    { "id": 2, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" },
    { "id": 3, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" }
  ]
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 1500, req.userId);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response format");
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    const { status, message } = toAiErrorResponse(err, "Failed to generate captions. Check that your AI provider key is configured in Settings.");
    logger.error({ error: safeErrorMessage(err) }, "Caption generation error");
    res.status(status).json({ error: message });
  }
});

type ImagePanel = "left" | "right";
type ImageProvider = "openai" | "google";

interface GeneratedImage {
  provider: ImageProvider;
  panel: ImagePanel;
  url: string;
  prompt: string;
  error?: string;
}

router.post("/ai/generate-images", async (req: AuthRequest, res) => {
  try {
    const body = GenerateImagesBody.parse(req.body);
    const hasAccess = await userHasClientRole(req.userId!, body.clientId, EDIT_CONTENT_ROLES);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }

    const basePrompt = await buildImagePrompt(body.clientId, body.caption, body.visualStyle);
    const altPrompt = `${basePrompt} Alternative artistic interpretation with a different visual angle.`;

    const { key } = await resolveApiKey("openai", req.userId);
    const openai = new OpenAI({ apiKey: key });

    const [leftResult, rightResult] = await Promise.allSettled([
      openai.images.generate({ model: "dall-e-3", prompt: basePrompt, n: 1, size: "1024x1024", quality: "standard", response_format: "url" }),
      openai.images.generate({ model: "dall-e-3", prompt: altPrompt,  n: 1, size: "1024x1024", quality: "standard", response_format: "url" }),
    ]);

    const images: GeneratedImage[] = [
      {
        provider: "openai",
        panel: "left",
        url: leftResult.status === "fulfilled" ? (leftResult.value.data?.[0]?.url ?? "") : "",
        prompt: basePrompt,
        ...(leftResult.status === "rejected" ? { error: safeErrorMessage(leftResult.reason) } : {}),
      },
      {
        provider: "openai",
        panel: "right",
        url: rightResult.status === "fulfilled" ? (rightResult.value.data?.[0]?.url ?? "") : "",
        prompt: altPrompt,
        ...(rightResult.status === "rejected" ? { error: safeErrorMessage(rightResult.reason) } : {}),
      },
    ];

    res.json({ images });
  } catch (err) {
    const { status, message } = toAiErrorResponse(err, "Failed to generate images. Check that your OpenAI key is configured in Settings.");
    logger.error({ error: safeErrorMessage(err) }, "Image generation error");
    res.status(status).json({ error: message });
  }
});

// POST /clients/:clientId/suggestions — AI Brain content ideas
router.post("/clients/:clientId/suggestions", requireClientRole(EDIT_CONTENT_ROLES), async (req: AuthRequest, res) => {
  try {
    const { clientId } = req.params;
    const context = await buildClientContext(clientId);
    const settings = await getUserSettings(req.userId);
    const { provider, model } = await resolveProviderAndModel(settings, req.userId);
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    const prompt = `You are a senior content strategist. Based on the brand context below, suggest 5 specific content ideas for the next 7 days of posts.

${context}

Today's date: ${today}

Rules:
- Each idea must be specific (not generic like "share a tip")
- Mix platforms and post types
- Consider current season and timing
- Make the hook irresistible

Respond with ONLY valid JSON:
{
  "suggestions": [
    {
      "topic": "Specific post idea in 1 sentence",
      "platform": "instagram",
      "postType": "social",
      "rationale": "Why this fits the brand right now (1 sentence)",
      "hook": "Opening line or visual concept"
    }
  ]
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 1500, req.userId);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response");
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    const { status, message } = toAiErrorResponse(err, "Failed to generate suggestions. Check that your AI provider key is configured in Settings.");
    logger.error({ error: safeErrorMessage(err) }, "Suggestions error");
    res.status(status).json({ error: message });
  }
});

export default router;
