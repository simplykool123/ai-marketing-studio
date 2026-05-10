/**
 * Image Studio routes
 *
 * POST /clients/:clientId/image-studio/generate-prompts
 *   - Topic/concept input
 *   - AI generates 4 prompt variations (photorealistic, illustration,
 *     bold typography, minimalist) using brand context
 *   - Returns prompts + optionally generates the photorealistic image via DALL-E 3
 *
 * POST /clients/:clientId/image-studio/generate-image
 *   - Takes a single prompt + provider (only "openai" / DALL-E 3 available now)
 *   - Generates image, returns URL
 *
 * POST /clients/:clientId/image-studio/save-style
 *   - Saves the "winning" style choice to client memory
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { imagesTable, postsTable } from "@workspace/db/schema";
import { buildClientMemoryPacket, formatClientMemoryPacket, writeClientMemory } from "../lib/client-memory-packet.js";
import {
  generateTextWithFallback,
  resolveApiKey,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { resolveTextProviderForMode, IMAGE_PROVIDERS, type QualityMode } from "../lib/provider-router.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { persistRemoteImageUrl } from "../lib/durable-image-storage.js";
import OpenAI from "openai";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImagePromptVariation {
  variation: number;
  style: string;
  prompt: string;
  rationale: string;
}

interface GeneratedPrompts {
  topic: string;
  brandContext: string;
  variations: ImagePromptVariation[];
}

// ---------------------------------------------------------------------------
// Prompt builder for variations
// ---------------------------------------------------------------------------

function buildPromptVariationsRequest(context: string, topic: string): string {
  return `You are a creative art director specialising in brand-consistent social media visuals.
Generate 4 distinct image prompt variations for the topic below.
Each variation uses a different visual style and should feel unique while staying true to the brand.

${context}

## Image Topic
"${topic}"

## Style Requirements
- variation 1: photorealistic — real-world photography feel, natural lighting, high resolution
- variation 2: illustration — digital artwork or flat/vector illustration, branded colour palette
- variation 3: bold typography — text-heavy design, strong typeface, minimal imagery, colour blocking
- variation 4: minimalist/clean — lots of whitespace, simple shapes, elegant and premium feel

For each variation write a detailed, DALL-E-ready prompt (50–80 words) including:
- Subject and composition
- Lighting and colour palette aligned to brand
- Mood/atmosphere
- Any text overlays (for typography style) or "no text" for others

Respond with ONLY valid JSON — no markdown fences:
{
  "topic": "the topic string",
  "brandContext": "one-sentence brand summary used",
  "variations": [
    {
      "variation": 1,
      "style": "photorealistic",
      "prompt": "...",
      "rationale": "When to use this style for this brand"
    },
    { "variation": 2, "style": "illustration", "prompt": "...", "rationale": "..." },
    { "variation": 3, "style": "bold typography", "prompt": "...", "rationale": "..." },
    { "variation": 4, "style": "minimalist", "prompt": "...", "rationale": "..." }
  ]
}`;
}

// ---------------------------------------------------------------------------
// POST /clients/:clientId/image-studio/generate-prompts
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/generate-prompts",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId } = req.params;
    const {
      topic,
      qualityMode = "balanced",
      generateFirst = false, // optionally also render variation 1 via DALL-E
      campaignId,
      storylineId,
    } = req.body as {
      topic?: string;
      qualityMode?: QualityMode;
      generateFirst?: boolean;
      campaignId?: string;
      storylineId?: string;
    };

    if (!topic?.trim()) {
      res.status(400).json({ error: "topic is required" });
      return;
    }

    try {
      const packet  = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const { provider, model, label } = await resolveTextProviderForMode(
        qualityMode as QualityMode,
        req.userId
      );

      const prompt = buildPromptVariationsRequest(context, topic);
      const { text: raw, usedProvider, fallbackUsed } = await generateTextWithFallback(
        provider, model, prompt, 2000, req.userId
      );

      logger.info(
        { chosenProvider: usedProvider, requestedProvider: provider, label, fallbackUsed, clientId },
        "Image Studio: prompts generated"
      );

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI returned no JSON");
      const gen = JSON.parse(jsonMatch[0]) as GeneratedPrompts;

      // Optionally generate the first variation image via DALL-E 3
      let previewImageUrl: string | null = null;
      let previewProviderUrl: string | null = null;
      if (generateFirst && gen.variations?.[0]) {
        try {
          const { key } = await resolveApiKey("openai", req.userId);
          const openai = new OpenAI({ apiKey: key });
          const imgRes = await openai.images.generate({
            model: "dall-e-3",
            prompt: gen.variations[0].prompt,
            n: 1,
            size: "1024x1024",
          });
          previewProviderUrl = imgRes.data?.[0]?.url ?? null;
          if (previewProviderUrl) {
            const persisted = await persistRemoteImageUrl(previewProviderUrl, clientId, "image-studio-preview");
            previewImageUrl = persisted.durableUrl;
          }
        } catch (imgErr) {
          logger.warn({ error: safeErrorMessage(imgErr) }, "Image Studio: DALL-E preview/storage failed");
        }
      }

      const [post] = await db
        .insert(postsTable)
        .values({
          clientId,
          campaignId:       campaignId ?? null,
          storylineId:      storylineId ?? null,
          contentType:      "image_prompt",
          contentSchema: {
            topic: gen.topic ?? topic,
            brandContext: gen.brandContext ?? null,
            variations: gen.variations ?? [],
            previewImageUrl,
            previewProviderUrl,
            styleMemoryUsed: packet.imageStyleMemory,
          },
          contentSchemaVersion: 1,
          topic:            gen.topic ?? topic,
          caption:          gen.brandContext ?? "",
          hashtags:         "",
          platform:         "image",
          postType:         "social",
          status:           "draft",
          generationStatus: "ready",
          imagePrompt:      gen.variations?.[0]?.prompt ?? null,
          selectedImageUrl: previewImageUrl,
          originalImageUrl: previewImageUrl,
          generationMetadata: {
            route: "image_studio.generate_prompts",
            provider: usedProvider,
            requestedProvider: provider,
            model,
            fallbackUsed,
            qualityMode,
            generateFirst,
            imageStorage: previewImageUrl ? "supabase" : "none",
          },
        })
        .returning();

      if (previewImageUrl) {
        await db.insert(imagesTable).values({
          clientId,
          postId: post.id,
          url: previewImageUrl,
          originalImageUrl: previewImageUrl,
          provider: "openai",
          status: "selected",
          type: "generated",
          prompt: gen.variations?.[0]?.prompt ?? null,
          notes: "Stored copy of Image Studio preview",
        });
      }

      res.json({
        post,
        generated: gen,
        previewImageUrl,
        providers: IMAGE_PROVIDERS,
        meta: { provider: usedProvider, fallbackUsed },
      });
    } catch (err) {
      const { status, message } = toAiErrorResponse(
        err, "Failed to generate image prompts. Check your AI provider key in Settings."
      );
      logger.error({ error: safeErrorMessage(err) }, "Image Studio generate-prompts error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/image-studio/generate-image
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/generate-image",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId } = req.params;
    const {
      prompt,
      style = "photorealistic",
      size = "1024x1024",
      topic,
      campaignId,
      storylineId,
    } = req.body as {
      prompt?: string;
      style?: string;
      size?: string;
      topic?: string;
      campaignId?: string;
      storylineId?: string;
    };

    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const { key } = await resolveApiKey("openai", req.userId);
      const openai = new OpenAI({ apiKey: key });

      const validSize = ["1024x1024", "1792x1024", "1024x1792"].includes(size)
        ? (size as "1024x1024" | "1792x1024" | "1024x1792")
        : "1024x1024";

      const imgRes = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: validSize,
      });

      const imageUrl = imgRes.data?.[0]?.url;
      if (!imageUrl) throw new Error("DALL-E returned no image URL");
      const persisted = await persistRemoteImageUrl(imageUrl, clientId, "image-studio");
      const durableImageUrl = persisted.durableUrl;

      const [post] = await db
        .insert(postsTable)
        .values({
          clientId,
          campaignId:       campaignId ?? null,
          storylineId:      storylineId ?? null,
          contentType:      "image_asset",
          contentSchema: {
            prompt,
            provider: "openai",
            model: "dall-e-3",
            imageUrl: durableImageUrl,
            providerImageUrl: imageUrl,
            variations: [],
            style,
            size: validSize,
            styleMemoryUsed: packet.imageStyleMemory,
          },
          contentSchemaVersion: 1,
          topic:            topic?.trim() || style || "Generated image",
          caption:          prompt,
          hashtags:         "",
          platform:         "image",
          postType:         "social",
          status:           "draft",
          generationStatus: "ready",
          imagePrompt:      prompt,
          selectedImageUrl: durableImageUrl,
          originalImageUrl: durableImageUrl,
          generationMetadata: {
            route: "image_studio.generate_image",
            provider: "openai",
            model: "dall-e-3",
            size: validSize,
            imageStorage: "supabase",
            providerImageUrl: imageUrl,
          },
        })
        .returning();

      await db.insert(imagesTable).values({
        clientId,
        postId: post.id,
        url: durableImageUrl,
        originalImageUrl: durableImageUrl,
        provider: "openai",
        status: "selected",
        type: "generated",
        prompt,
        notes: "Stored copy of generated Image Studio asset",
      });

      logger.info({ clientId }, "Image Studio: image generated");
      res.json({ post, imageUrl: durableImageUrl, providerImageUrl: imageUrl, prompt, style });
    } catch (err) {
      const { status, message } = toAiErrorResponse(
        err, "Failed to generate image. Check your OpenAI API key in Settings."
      );
      logger.error({ error: safeErrorMessage(err) }, "Image Studio generate-image error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/image-studio/save-style
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/save-style",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId } = req.params;
    const { style, rationale, topic } = req.body as {
      style?: string;
      rationale?: string;
      topic?: string;
    };

    if (!style) {
      res.status(400).json({ error: "style is required" });
      return;
    }

    try {
      await writeClientMemory(
        clientId,
        "Image Style Memory / Winning Style",
        `User selected "${style}" style for topic "${topic ?? "general"}". ${rationale ?? ""} Use this style preference when generating future image prompts.`
      );
      res.json({ ok: true });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Image Studio save-style error");
      res.status(500).json({ error: "Failed to save style preference" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/image-studio/providers
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/image-studio/providers",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (_req: AuthRequest, res) => {
    res.json({ providers: IMAGE_PROVIDERS });
  }
);

export default router;
