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
import multer from "multer";
import { db } from "@workspace/db";
import { brandAssetsTable, imagesTable, postsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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
import { uploadToSupabase } from "./upload.js";
import OpenAI, { toFile } from "openai";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

type PreparedImagePrompt = {
  finalPrompt: string;
  negativePrompt: string;
  suggestedAspectRatio: "1:1" | "4:5" | "16:9" | "9:16";
  styleTags: string[];
  brandColorNotes: string;
  compositionNotes: string;
  textRecommendation: string;
};

function aspectRatioToSize(aspectRatio?: string): "1024x1024" | "1792x1024" | "1024x1792" {
  if (aspectRatio === "16:9") return "1792x1024";
  if (aspectRatio === "9:16" || aspectRatio === "4:5") return "1024x1792";
  return "1024x1024";
}

function safeJson<T>(raw: string): T | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

function brandVisualContext(context: string, assetUrls: string[] = []): string {
  return `${context}

## Required Image Direction
- Use Brand DNA colors and visual style notes when present.
- Use saved image style memory and avoid rejected/weak visual patterns.
- Avoid repeating dismissed ideas or generic stock-photo compositions.
- Make the image premium, polished, commercially usable, and platform-ready.
- Do not include tiny unreadable text. Only include text when explicitly requested.
${assetUrls.length ? `- Selected brand/reference assets: ${assetUrls.join(", ")}` : ""}`;
}

async function selectedBrandAssetUrls(clientId: string, assetIds: unknown): Promise<string[]> {
  if (!Array.isArray(assetIds) || assetIds.length === 0) return [];
  const ids = assetIds.filter((id): id is string => typeof id === "string");
  if (!ids.length) return [];
  const assets = await db
    .select({ id: brandAssetsTable.id, fileUrl: brandAssetsTable.fileUrl })
    .from(brandAssetsTable)
    .where(eq(brandAssetsTable.clientId, clientId));
  const selected = new Set(ids);
  return assets.filter((asset) => selected.has(asset.id)).map((asset) => asset.fileUrl).slice(0, 4);
}

async function createImageAssetPost(input: {
  clientId: string;
  topic: string;
  caption: string;
  prompt: string;
  imageUrl: string;
  providerImageUrl?: string | null;
  style?: string;
  size?: string;
  contentType?: string;
  platform?: string;
  metadata?: Record<string, unknown>;
}) {
  const [post] = await db
    .insert(postsTable)
    .values({
      clientId: input.clientId,
      contentType: input.contentType ?? "image_asset",
      contentSchema: {
        prompt: input.prompt,
        provider: "openai",
        model: input.metadata?.model ?? "dall-e-3",
        imageUrl: input.imageUrl,
        providerImageUrl: input.providerImageUrl ?? null,
        style: input.style ?? null,
        size: input.size ?? null,
        ...input.metadata,
      },
      contentSchemaVersion: 1,
      topic: input.topic,
      caption: input.caption,
      hashtags: "",
      platform: input.platform ?? "image",
      postType: "social",
      status: "draft",
      generationStatus: "ready",
      imagePrompt: input.prompt,
      selectedImageUrl: input.imageUrl,
      originalImageUrl: input.imageUrl,
      generationMetadata: input.metadata ?? {},
    })
    .returning();

  await db.insert(imagesTable).values({
    clientId: input.clientId,
    postId: post.id,
    url: input.imageUrl,
    originalImageUrl: input.imageUrl,
    provider: "openai",
    status: "selected",
    type: "generated",
    prompt: input.prompt,
    notes: input.metadata?.notes ? String(input.metadata.notes) : "Stored Image Studio output",
  });

  return post;
}

async function generateOpenAiImage(params: {
  userId?: string;
  clientId: string;
  prompt: string;
  aspectRatio?: string;
  filenamePrefix: string;
}): Promise<{ durableUrl: string; providerUrl: string | null; model: string; size: string }> {
  const { key } = await resolveApiKey("openai", params.userId);
  const openai = new OpenAI({ apiKey: key });
  const size = aspectRatioToSize(params.aspectRatio);
  const imgRes = await openai.images.generate({
    model: "dall-e-3",
    prompt: params.prompt,
    n: 1,
    size,
  });
  const providerUrl = imgRes.data?.[0]?.url ?? null;
  if (!providerUrl) throw new Error("OpenAI returned no image URL");
  const persisted = await persistRemoteImageUrl(providerUrl, params.clientId, params.filenamePrefix);
  return { durableUrl: persisted.durableUrl, providerUrl, model: "dall-e-3", size };
}

async function editOpenAiImage(params: {
  userId?: string;
  clientId: string;
  prompt: string;
  file: Express.Multer.File;
  aspectRatio?: string;
}): Promise<{ durableUrl: string; model: string; size: string }> {
  const { key } = await resolveApiKey("openai", params.userId);
  const openai = new OpenAI({ apiKey: key });
  const size = aspectRatioToSize(params.aspectRatio);
  const image = await toFile(params.file.buffer, params.file.originalname || "reference.png", {
    type: params.file.mimetype || "image/png",
  });
  const result = await openai.images.edit({
    model: "gpt-image-1",
    image,
    prompt: params.prompt,
    size,
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image edit returned no image data");
  const buffer = Buffer.from(b64, "base64");
  const durableUrl = await uploadToSupabase(buffer, `generated/${params.clientId}/image-edit-${Date.now()}.png`, "image/png");
  return { durableUrl, model: "gpt-image-1", size };
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

function buildPromptHelperRequest(context: string, idea: string, platform: string, aspectRatio: string): string {
  return `You are a senior creative director preparing a premium AI image generation prompt.

${context}

User rough idea:
"${idea}"

Platform: ${platform}
Requested aspect ratio: ${aspectRatio}

Return ONLY valid JSON:
{
  "finalPrompt": "a detailed production-ready image prompt, 90-140 words",
  "negativePrompt": "things to avoid, comma-separated",
  "suggestedAspectRatio": "1:1 | 4:5 | 16:9 | 9:16",
  "styleTags": ["premium", "photorealistic", "clean composition"],
  "brandColorNotes": "how to use the brand colors",
  "compositionNotes": "framing, lighting, subject placement, background",
  "textRecommendation": "no text / short headline only / safe text guidance"
}`;
}

function fallbackPreparedPrompt(idea: string, aspectRatio: string): PreparedImagePrompt {
  return {
    finalPrompt: `${idea}. Premium commercial-quality visual, polished lighting, clean composition, brand-consistent colors, high-end social media artwork, realistic details, no clutter, platform-ready framing.`,
    negativePrompt: "low resolution, blurry, distorted hands, cluttered background, unreadable text, generic stock photo, off-brand colors",
    suggestedAspectRatio: aspectRatio === "16:9" || aspectRatio === "9:16" || aspectRatio === "4:5" ? aspectRatio : "1:1",
    styleTags: ["premium", "brand-consistent", "social-ready"],
    brandColorNotes: "Use Brand DNA colors where available.",
    compositionNotes: "Keep the hero subject clear with enough negative space for optional captioning.",
    textRecommendation: "Prefer no text unless a short headline is explicitly needed.",
  };
}

// ---------------------------------------------------------------------------
// POST /clients/:clientId/image-studio/prepare-prompt
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/prepare-prompt",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const { idea, platform = "instagram", aspectRatio = "1:1", assetIds = [] } = req.body as {
      idea?: string;
      platform?: string;
      aspectRatio?: string;
      assetIds?: string[];
    };
    if (!idea?.trim()) {
      res.status(400).json({ error: "idea is required" });
      return;
    }

    try {
      const [packet, assetUrls] = await Promise.all([
        buildClientMemoryPacket(clientId),
        selectedBrandAssetUrls(clientId, assetIds),
      ]);
      const context = brandVisualContext(formatClientMemoryPacket(packet), assetUrls);
      const { provider, model } = await resolveTextProviderForMode("best_quality", req.userId);
      const prompt = buildPromptHelperRequest(context, idea, platform, aspectRatio);
      const { text, usedProvider, usedModel, fallbackUsed } = await generateTextWithFallback(provider, model, prompt, 1600, req.userId);
      const prepared = safeJson<PreparedImagePrompt>(text) ?? fallbackPreparedPrompt(idea, aspectRatio);
      res.json({ prepared, meta: { provider: usedProvider, model: usedModel, fallbackUsed } });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Failed to improve image prompt. Check your AI provider key in Settings.");
      res.status(status).json({ error: message });
    }
  }
);

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
      aspectRatio = "1:1",
      assetIds = [],
      campaignId,
      storylineId,
    } = req.body as {
      topic?: string;
      qualityMode?: QualityMode;
      generateFirst?: boolean;
      aspectRatio?: string;
      assetIds?: string[];
      campaignId?: string;
      storylineId?: string;
    };

    if (!topic?.trim()) {
      res.status(400).json({ error: "topic is required" });
      return;
    }

    try {
      const [packet, assetUrls] = await Promise.all([
        buildClientMemoryPacket(clientId),
        selectedBrandAssetUrls(clientId, assetIds),
      ]);
      const context = brandVisualContext(formatClientMemoryPacket(packet), assetUrls);
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
          const generated = await generateOpenAiImage({
            userId: req.userId,
            clientId,
            prompt: gen.variations[0].prompt,
            aspectRatio,
            filenamePrefix: "image-studio-preview",
          });
          previewProviderUrl = generated.providerUrl;
          previewImageUrl = generated.durableUrl;
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
            selectedBrandAssetUrls: assetUrls,
            aspectRatio,
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
            selectedBrandAssetUrls: assetUrls,
            aspectRatio,
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
      aspectRatio = "1:1",
      assetIds = [],
      topic,
      campaignId,
      storylineId,
    } = req.body as {
      prompt?: string;
      style?: string;
      size?: string;
      aspectRatio?: string;
      assetIds?: string[];
      topic?: string;
      campaignId?: string;
      storylineId?: string;
    };

    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    try {
      const [packet, assetUrls] = await Promise.all([
        buildClientMemoryPacket(clientId),
        selectedBrandAssetUrls(clientId, assetIds),
      ]);
      const validSize = ["1024x1024", "1792x1024", "1024x1792"].includes(size)
        ? (size as "1024x1024" | "1792x1024" | "1024x1792")
        : aspectRatioToSize(aspectRatio);
      const fullPrompt = `${prompt}

${brandVisualContext(formatClientMemoryPacket(packet), assetUrls)}

Aspect ratio: ${aspectRatio}.`;
      const generated = await generateOpenAiImage({
        userId: req.userId,
        clientId,
        prompt: fullPrompt,
        aspectRatio,
        filenamePrefix: "image-studio",
      });

      const post = await createImageAssetPost({
        clientId,
        topic: topic?.trim() || style || "Generated image",
        caption: prompt,
        prompt: fullPrompt,
        imageUrl: generated.durableUrl,
        providerImageUrl: generated.providerUrl,
        style,
        size: validSize,
        metadata: {
          route: "image_studio.generate_image",
          provider: "openai",
          model: generated.model,
          size: generated.size,
          imageStorage: "supabase",
          providerImageUrl: generated.providerUrl,
          styleMemoryUsed: packet.imageStyleMemory,
          selectedBrandAssetUrls: assetUrls,
          aspectRatio,
          notes: "Generated in Image Studio",
        },
      });

      logger.info({ clientId }, "Image Studio: image generated");
      res.json({ post, imageUrl: generated.durableUrl, providerImageUrl: generated.providerUrl, prompt: fullPrompt, style });
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
// POST /clients/:clientId/image-studio/edit-image
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/edit-image",
  requireClientRole(EDIT_CONTENT_ROLES),
  upload.single("image"),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const instruction = typeof req.body.instruction === "string" ? req.body.instruction.trim() : "";
    const aspectRatio = typeof req.body.aspectRatio === "string" ? req.body.aspectRatio : "1:1";
    const topic = typeof req.body.topic === "string" && req.body.topic.trim() ? req.body.topic.trim() : "Edited image";
    if (!req.file) {
      res.status(400).json({ error: "Reference image is required" });
      return;
    }
    if (!instruction) {
      res.status(400).json({ error: "Edit instruction is required" });
      return;
    }

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const prompt = `${instruction}

${brandVisualContext(formatClientMemoryPacket(packet))}

Preserve the useful parts of the reference image while making the edit look premium, natural, and commercially usable.`;
      const edited = await editOpenAiImage({ userId: req.userId, clientId, prompt, file: req.file, aspectRatio });
      const post = await createImageAssetPost({
        clientId,
        topic,
        caption: instruction,
        prompt,
        imageUrl: edited.durableUrl,
        style: "edited reference",
        size: edited.size,
        metadata: {
          route: "image_studio.edit_image",
          provider: "openai",
          model: edited.model,
          size: edited.size,
          aspectRatio,
          originalFilename: req.file.originalname,
          notes: "Edited from uploaded reference in Image Studio",
        },
      });
      res.json({ post, imageUrl: edited.durableUrl, prompt, style: "edited reference" });
    } catch (err) {
      const { status, message } = toAiErrorResponse(
        err,
        "Image editing is unavailable. Check your OpenAI key in Settings, or generate a new image from text."
      );
      logger.error({ clientId, error: safeErrorMessage(err) }, "Image Studio edit-image error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/image-studio/variations
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/variations",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const {
      prompt,
      sourceImageUrl,
      count = 3,
      aspectRatio = "1:1",
      topic = "Image variations",
    } = req.body as {
      prompt?: string;
      sourceImageUrl?: string;
      count?: number;
      aspectRatio?: string;
      topic?: string;
    };
    if (!prompt?.trim() && !sourceImageUrl) {
      res.status(400).json({ error: "prompt or sourceImageUrl is required" });
      return;
    }

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = brandVisualContext(formatClientMemoryPacket(packet));
      const total = Math.min(Math.max(Number(count) || 3, 2), 4);
      const outputs = [];
      for (let i = 0; i < total; i++) {
        const variationPrompt = `${prompt || "Create a premium variation of the reference image."}

Variation ${i + 1}: change composition, lighting, crop, background styling, and visual emphasis while preserving brand fit.
${sourceImageUrl ? `Reference image URL: ${sourceImageUrl}` : ""}

${context}`;
        const generated = await generateOpenAiImage({
          userId: req.userId,
          clientId,
          prompt: variationPrompt,
          aspectRatio,
          filenamePrefix: `image-variation-${i + 1}`,
        });
        const post = await createImageAssetPost({
          clientId,
          topic,
          caption: prompt ?? "Image variation",
          prompt: variationPrompt,
          imageUrl: generated.durableUrl,
          providerImageUrl: generated.providerUrl,
          style: `variation ${i + 1}`,
          size: generated.size,
          metadata: {
            route: "image_studio.variations",
            provider: "openai",
            model: generated.model,
            size: generated.size,
            sourceImageUrl: sourceImageUrl ?? null,
            aspectRatio,
            variation: i + 1,
            notes: "Variation generated in Image Studio",
          },
        });
        outputs.push({ post, imageUrl: generated.durableUrl, prompt: variationPrompt, variation: i + 1 });
      }

      res.json({ variations: outputs });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Failed to create image variations. Check your OpenAI key in Settings.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Image Studio variations error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/image-studio/save-to-review
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/image-studio/save-to-review",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const { imageUrl, prompt, platform = "instagram", caption = "", topic = "Image draft" } = req.body as {
      imageUrl?: string;
      prompt?: string;
      platform?: string;
      caption?: string;
      topic?: string;
    };
    if (!imageUrl?.trim()) {
      res.status(400).json({ error: "imageUrl is required" });
      return;
    }

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const post = await createImageAssetPost({
        clientId,
        topic: topic || "Image draft",
        caption: caption || prompt || "Image draft ready for review.",
        prompt: prompt || "",
        imageUrl,
        platform,
        contentType: "social_post",
        metadata: {
          route: "image_studio.save_to_review",
          provider: "openai",
          model: "saved-image",
          brandContext: packet.brandDna,
          imagePrompt: prompt ?? null,
          notes: "Sent to Review from Image Studio",
        },
      });
      res.status(201).json({ post });
    } catch (err) {
      logger.error({ clientId, error: safeErrorMessage(err) }, "Image Studio save-to-review error");
      res.status(500).json({ error: "Failed to send image to Review" });
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
