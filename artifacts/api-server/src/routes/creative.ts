import { Router } from "express";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import { generateTextWithFallback, safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

type CreativeMode = "image" | "video";
type CreativeAspectRatio = "9:16" | "1:1" | "16:9";

function parseCreativeMode(value: unknown): CreativeMode | null {
  return value === "image" || value === "video" ? value : null;
}

function parseAspectRatio(value: unknown): CreativeAspectRatio | undefined {
  return value === "9:16" || value === "1:1" || value === "16:9" ? value : undefined;
}

function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned no JSON.");
  return JSON.parse(match[0]);
}

function buildCreativePrompt(params: {
  mode: CreativeMode;
  context: string;
  userIdea: string;
  platform?: string;
  occasionTitle?: string;
  contentType?: string;
  aspectRatio?: CreativeAspectRatio;
}): string {
  const assignment = [
    `Mode: ${params.mode}`,
    `Rough idea: ${params.userIdea}`,
    params.platform ? `Platform: ${params.platform}` : null,
    params.occasionTitle ? `Occasion: ${params.occasionTitle}` : null,
    params.contentType ? `Content type: ${params.contentType}` : null,
    params.aspectRatio ? `Aspect ratio: ${params.aspectRatio}` : null,
  ].filter(Boolean).join("\n");

  if (params.mode === "image") {
    return `You are a senior creative director preparing an image generation prompt for an AI Marketing Studio.
Use Brand DNA, AI Memory, active Storyline, image style memory, and recent posts below. Improve the rough idea into a specific, brand-safe image prompt.

${params.context}

## Assignment
${assignment}

Rules:
- Do not generate an image.
- Do not mention internal memory system names in the prompt.
- Keep the prompt editable and practical for DALL-E / image models.
- Avoid repeating recent post angles too closely.
- Include concrete subject, composition, lighting, palette, mood, and any text overlay guidance.
- If text should appear in artwork, keep it short and put it in headlineSuggestion/sublineSuggestion.

Return ONLY valid JSON:
{
  "improvedPrompt": "detailed image generation prompt",
  "negativePrompt": "things to avoid",
  "headlineSuggestion": "short optional artwork headline",
  "sublineSuggestion": "short optional subline",
  "styleDirection": "visual style guidance",
  "paletteSuggestion": "brand color palette guidance",
  "layoutSuggestion": "layout/composition guidance",
  "platformNotes": "platform-specific notes"
}`;
  }

  return `You are a senior creative director preparing a video generation prompt for an AI Marketing Studio.
Use Brand DNA, AI Memory, active Storyline, video/image style memory, and recent posts below. Improve the rough story into a specific provider-ready video prompt.

${params.context}

## Assignment
${assignment}

Rules:
- Do not generate a video.
- Keep the final improvedPrompt usable in a text-to-video or image-to-video model.
- Be specific about scene, camera, motion, lighting, brand mood, and visual continuity.
- Avoid direct social publishing instructions.
- Avoid repeating recent post angles too closely.
- Text overlays must be short and optional because video models may render text poorly.

Return ONLY valid JSON:
{
  "improvedPrompt": "provider-ready video generation prompt",
  "visualStory": "one paragraph visual story",
  "sceneBreakdown": ["scene 1", "scene 2", "scene 3"],
  "cameraStyle": "camera/framing guidance",
  "motionStyle": "motion and transition guidance",
  "textOverlaySuggestions": ["short overlay 1", "short overlay 2"],
  "brandOverlayNotes": "logo/color/text overlay notes for later editing",
  "durationSuggestion": "5 seconds or 10 seconds",
  "platformNotes": "platform-specific notes"
}`;
}

// POST /clients/:clientId/creative/prepare-prompt
router.post(
  "/clients/:clientId/creative/prepare-prompt",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const body = req.body as {
      mode?: unknown;
      userIdea?: unknown;
      platform?: string;
      occasionTitle?: string;
      contentType?: string;
      aspectRatio?: unknown;
    };
    const mode = parseCreativeMode(body.mode);
    const userIdea = typeof body.userIdea === "string" ? body.userIdea.trim() : "";

    if (!mode) {
      res.status(400).json({ error: "mode must be image or video" });
      return;
    }
    if (!userIdea) {
      res.status(400).json({ error: "userIdea is required" });
      return;
    }

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const { provider, model } = await resolveTextProviderForMode("balanced", req.userId);
      const prompt = buildCreativePrompt({
        mode,
        context,
        userIdea: userIdea.slice(0, 1200),
        platform: body.platform,
        occasionTitle: body.occasionTitle,
        contentType: body.contentType,
        aspectRatio: parseAspectRatio(body.aspectRatio),
      });
      const { text, usedProvider, fallbackUsed } = await generateTextWithFallback(provider, model, prompt, 1800, req.userId);
      const prepared = extractJsonObject(text);

      logger.info({ clientId, mode, provider: usedProvider, requestedProvider: provider, fallbackUsed }, "Creative prompt prepared");
      res.json({
        mode,
        prepared,
        meta: {
          provider: usedProvider,
          requestedProvider: provider,
          model,
          fallbackUsed,
          contextUsed: {
            brandDna: !!packet.brandDna,
            activeStoryline: !!packet.storyMemory.activeStoryline,
            memoryEntries: packet.memoryEntries.length,
            recentPosts: packet.recentApprovedOrPublishedPosts.length,
          },
        },
      });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Failed to improve prompt. Check your AI provider key in Settings.");
      logger.error({ error: safeErrorMessage(err) }, "Creative prepare-prompt error");
      res.status(status).json({ error: message });
    }
  }
);

export default router;
