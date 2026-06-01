import { Router } from "express";
import sharp from "sharp";
import { db } from "@workspace/db";
import { brandAssetsTable, campaignOutputsTable, campaignsTable, clientsTable, imagesTable, postsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import { safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";
import { generateJsonWithFallback, JsonParseError } from "../lib/ai-json.js";
import { validatorForSkill } from "../lib/skill-validators.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { generateImageWithProvider, type ImageProvider } from "../lib/image-provider.js";
import { persistRemoteImageUrl } from "../lib/durable-image-storage.js";
import { uploadToSupabase } from "./upload.js";

const router = Router();

type CreativeMode = "image" | "video";
type CreativeAspectRatio = "9:16" | "1:1" | "16:9";
type SizePresetId =
  | "instagram_square"
  | "instagram_portrait"
  | "instagram_story"
  | "linkedin_feed"
  | "linkedin_square"
  | "facebook_feed"
  | "youtube_thumbnail"
  | "blog_hero";

const SIZE_PRESETS: Record<SizePresetId, { label: string; width: number; height: number; aspectRatio: "1:1" | "4:5" | "9:16" | "16:9"; providerSize: "1024x1024" | "1792x1024" | "1024x1792" }> = {
  instagram_square: { label: "Instagram Square", width: 1080, height: 1080, aspectRatio: "1:1", providerSize: "1024x1024" },
  instagram_portrait: { label: "Instagram Portrait", width: 1080, height: 1350, aspectRatio: "4:5", providerSize: "1024x1792" },
  instagram_story: { label: "Instagram Story/Reel", width: 1080, height: 1920, aspectRatio: "9:16", providerSize: "1024x1792" },
  linkedin_feed: { label: "LinkedIn Feed", width: 1200, height: 627, aspectRatio: "16:9", providerSize: "1792x1024" },
  linkedin_square: { label: "LinkedIn Square", width: 1080, height: 1080, aspectRatio: "1:1", providerSize: "1024x1024" },
  facebook_feed: { label: "Facebook Feed", width: 1200, height: 630, aspectRatio: "16:9", providerSize: "1792x1024" },
  youtube_thumbnail: { label: "YouTube Thumbnail", width: 1280, height: 720, aspectRatio: "16:9", providerSize: "1792x1024" },
  blog_hero: { label: "Blog Hero", width: 1600, height: 900, aspectRatio: "16:9", providerSize: "1792x1024" },
};

const VALID_SIZE_IDS = Object.keys(SIZE_PRESETS) as SizePresetId[];

type CreativeConcept = {
  title: string;
  visualDirection: string;
  layoutIdea: string;
  mainHeadline: string;
  subtitle: string;
  cta: string;
  logoPlacement: string;
  colorDirection: string;
  fontStyle: string;
  backgroundStyle: string;
  imagePrompt: string;
  negativePrompt: string;
  providerRecommendation: "openai" | "ideogram" | "imagen" | "flux";
  whyThisWorks: string;
};

function parseCreativeMode(value: unknown): CreativeMode | null {
  return value === "image" || value === "video" ? value : null;
}

function parseAspectRatio(value: unknown): CreativeAspectRatio | undefined {
  return value === "9:16" || value === "1:1" || value === "16:9" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractAiVisibilityPromptDirections(schema: Record<string, unknown>): string[] {
  const values: string[] = [];
  const keys = ["imagePrompt", "imagePromptDirections", "visualDirection", "creativeDirection", "artworkDirection", "prompt"];
  for (const key of keys) {
    const value = schema[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
    if (Array.isArray(value)) values.push(...value.map(String).map((item) => item.trim()).filter(Boolean));
  }
  for (const value of Object.values(schema)) {
    if (value && typeof value === "object") values.push(...extractAiVisibilityPromptDirections(value as Record<string, unknown>));
  }
  return [...new Set(values)].slice(0, 6);
}

function normalizeConcepts(value: unknown, fallbackPrompt: string): CreativeConcept[] {
  const raw = asRecord(value);
  const list = Array.isArray(raw.concepts) ? raw.concepts : [];
  const concepts = list.map((item, index) => {
    const row = asRecord(item);
    return {
      title: firstString(row.title, row.conceptTitle) ?? `Concept ${index + 1}`,
      visualDirection: firstString(row.visualDirection) ?? "Premium branded social visual",
      layoutIdea: firstString(row.layoutIdea) ?? "Clear hero subject with readable headline space",
      mainHeadline: firstString(row.mainHeadline, row.headline) ?? "",
      subtitle: firstString(row.subtitle, row.subline) ?? "",
      cta: firstString(row.cta, row.CTA) ?? "",
      logoPlacement: firstString(row.logoPlacement) ?? "bottom-right",
      colorDirection: firstString(row.colorDirection) ?? "Use Brand DNA colors",
      fontStyle: firstString(row.fontStyle) ?? "Clean modern sans-serif",
      backgroundStyle: firstString(row.backgroundStyle) ?? "Polished uncluttered background",
      imagePrompt: firstString(row.imagePrompt, row.prompt) ?? fallbackPrompt,
      negativePrompt: firstString(row.negativePrompt) ?? "blurry, low resolution, distorted text, clutter, off-brand colors",
      providerRecommendation: (["openai", "ideogram", "imagen", "flux"].includes(String(row.providerRecommendation)) ? row.providerRecommendation : "openai") as CreativeConcept["providerRecommendation"],
      whyThisWorks: firstString(row.whyThisWorks, row.rationale) ?? "It keeps the artwork focused, brand-aligned, and platform-ready.",
    };
  }).filter((concept) => concept.imagePrompt.trim());

  while (concepts.length < 3) {
    concepts.push({
      title: `Concept ${concepts.length + 1}`,
      visualDirection: "Brand-led premium artwork",
      layoutIdea: "Hero visual, short headline zone, CTA near lower edge",
      mainHeadline: "",
      subtitle: "",
      cta: "",
      logoPlacement: "bottom-right",
      colorDirection: "Use Brand DNA colors",
      fontStyle: "Clean modern sans-serif",
      backgroundStyle: "Polished uncluttered background",
      imagePrompt: fallbackPrompt,
      negativePrompt: "blurry, low resolution, distorted text, clutter, off-brand colors",
      providerRecommendation: "openai",
      whyThisWorks: "It converts the draft direction into a usable, brand-safe image prompt.",
    });
  }
  return concepts.slice(0, 3);
}

function providerForRecommendation(value: unknown, mode: unknown): ImageProvider | "auto" {
  if (mode === "cheap") return "flux";
  if (mode === "fast") return "openai";
  if (value === "ideogram") return "ideogram";
  if (value === "flux") return "flux";
  if (value === "openai" || value === "imagen") return "openai";
  return "auto";
}

async function findLogoUrl(clientId: string): Promise<string | null> {
  const [client] = await db.select({ logoUrl: clientsTable.logoUrl }).from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
  if (client?.logoUrl) return client.logoUrl;
  const [asset] = await db
    .select({ fileUrl: brandAssetsTable.fileUrl })
    .from(brandAssetsTable)
    .where(and(eq(brandAssetsTable.clientId, clientId), eq(brandAssetsTable.assetType, "logo")))
    .orderBy(desc(brandAssetsTable.createdAt))
    .limit(1);
  return asset?.fileUrl ?? null;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch image: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function compositeLogo(baseUrl: string, logoUrl: string, clientId: string, placement: string): Promise<string> {
  const [baseBuffer, logoBuffer] = await Promise.all([fetchBuffer(baseUrl), fetchBuffer(logoUrl)]);
  const normalized = await sharp(baseBuffer).rotate().png().toBuffer();
  const meta = await sharp(normalized).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;
  const logoWidth = Math.round(width * 0.16);
  const resizedLogo = await sharp(logoBuffer).rotate().resize({ width: logoWidth, withoutEnlargement: true }).png().toBuffer();
  const logoMeta = await sharp(resizedLogo).metadata();
  const overlayWidth = logoMeta.width ?? logoWidth;
  const overlayHeight = logoMeta.height ?? logoWidth;
  const margin = Math.round(Math.min(width, height) * 0.04);
  const p = placement.toLowerCase();
  const left = p.includes("left") ? margin : p.includes("center") ? Math.round((width - overlayWidth) / 2) : width - overlayWidth - margin;
  const top = p.includes("top") ? margin : p.includes("center") ? Math.round((height - overlayHeight) / 2) : height - overlayHeight - margin;
  const output = await sharp(normalized).composite([{ input: resizedLogo, left, top }]).png().toBuffer();
  return uploadToSupabase(output, `generated/${clientId}/creative-logo-${Date.now()}.png`, "image/png");
}

function buildConceptPrompt(params: {
  context: string;
  post: typeof postsTable.$inferSelect;
  promptDirections: string[];
  logoUrl: string | null;
}) {
  const schema = asRecord(params.post.contentSchema);
  return `You are the Creative Director for AI Marketing Studio. Create exactly 3 image creative concepts for the draft below.

${params.context}

## Draft / campaign item
Topic: ${params.post.topic}
Platform: ${params.post.platform ?? "instagram"}
Caption: ${params.post.caption}
CTA / schema context: ${JSON.stringify(schema, null, 2).slice(0, 4500)}
Saved AI Visibility image prompt directions:
${params.promptDirections.length ? params.promptDirections.map((item) => `- ${item}`).join("\n") : "- none"}
Logo available: ${params.logoUrl ? "yes" : "no"}

Rules:
- Generate concepts only. Do not claim a logo is physically embedded by AI.
- If logo is available, include a practical logoPlacement.
- Use past approved image memory if present in context.
- Recommend openai for brand instruction following/editing, ideogram for text-heavy posters, imagen for polished premium visuals, flux for fallback/cheap.
- Keep artwork text short and readable.

Return ONLY valid JSON:
{
  "concepts": [
    {
      "title": "",
      "visualDirection": "",
      "layoutIdea": "",
      "mainHeadline": "",
      "subtitle": "",
      "cta": "",
      "logoPlacement": "",
      "colorDirection": "",
      "fontStyle": "",
      "backgroundStyle": "",
      "imagePrompt": "",
      "negativePrompt": "",
      "providerRecommendation": "openai | ideogram | imagen | flux",
      "whyThisWorks": ""
    }
  ]
}`;
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
      const { object: prepared, usedProvider, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider,
        model,
        prompt,
        maxTokens: 1800,
        userId: req.userId,
        schemaName: "creative_prompt_prep",
        validate: validatorForSkill("creative_prompt_prep"),
      });

      logger.info({ clientId, mode, provider: usedProvider, requestedProvider: provider, fallbackUsed, repairUsed }, "Creative prompt prepared");
      res.json({
        mode,
        prepared,
        meta: {
          provider: usedProvider,
          requestedProvider: provider,
          model,
          fallbackUsed,
          repairUsed,
          contextUsed: {
            brandDna: !!packet.brandDna,
            activeStoryline: !!packet.storyMemory.activeStoryline,
            memoryEntries: packet.memoryEntries.length,
            recentPosts: packet.recentApprovedOrPublishedPosts.length,
          },
        },
      });
    } catch (err) {
      if (err instanceof JsonParseError) {
        logger.error({ error: err.message, sample: err.rawSample }, "Creative prepare-prompt JSON failure");
        res.status(422).json({ error: "AI could not produce a valid creative prompt. Please retry." });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Failed to improve prompt. Check your AI provider key in Settings.");
      logger.error({ error: safeErrorMessage(err) }, "Creative prepare-prompt error");
      res.status(status).json({ error: message });
    }
  }
);

router.post(
  "/clients/:clientId/creative/concepts",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const postId = typeof req.body?.postId === "string" ? req.body.postId : "";
    if (!postId) {
      res.status(400).json({ error: "postId is required" });
      return;
    }

    try {
      const [post] = await db.select().from(postsTable).where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId))).limit(1);
      if (!post) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      const [packet, logoUrl] = await Promise.all([buildClientMemoryPacket(clientId), findLogoUrl(clientId)]);
      const promptDirections = extractAiVisibilityPromptDirections(asRecord(post.contentSchema));
      const context = formatClientMemoryPacket(packet);
      const { provider, model } = await resolveTextProviderForMode("best_quality", req.userId);
      const prompt = buildConceptPrompt({ context, post, promptDirections, logoUrl });
      const { object, usedProvider, usedModel, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider,
        model,
        prompt,
        maxTokens: 2800,
        userId: req.userId,
        schemaName: "creative_concepts",
        validate: validatorForSkill("creative_concepts"),
      });
      const concepts = normalizeConcepts(object, promptDirections[0] || post.imagePrompt || post.caption);

      res.json({
        post,
        concepts,
        aiVisibilityPromptDirections: promptDirections,
        logo: { found: !!logoUrl, url: logoUrl },
        sizePresets: SIZE_PRESETS,
        meta: { provider: usedProvider, model: usedModel, fallbackUsed, repairUsed },
      });
    } catch (err) {
      if (err instanceof JsonParseError) {
        logger.error({ clientId, error: err.message, sample: err.rawSample }, "Creative concepts JSON failure");
        res.status(422).json({ error: "AI could not produce valid creative concepts. Please retry." });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Failed to generate creative concepts. Check your AI provider key in Settings.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Creative concept generation error");
      res.status(status).json({ error: message });
    }
  }
);

router.post(
  "/clients/:clientId/creative/generate-image",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const postId = typeof req.body?.postId === "string" ? req.body.postId : "";
    const selectedSizeIds: SizePresetId[] = Array.isArray(req.body?.sizePresetIds)
      ? req.body.sizePresetIds.filter((id: unknown): id is SizePresetId => VALID_SIZE_IDS.includes(id as SizePresetId)).slice(0, 4)
      : [];
    const concept = asRecord(req.body?.concept);
    const imagePrompt = firstString(req.body?.prompt, concept.imagePrompt);
    if (!postId || !imagePrompt || !selectedSizeIds.length) {
      res.status(400).json({ error: "postId, prompt/concept, and at least one sizePresetId are required" });
      return;
    }

    try {
      const [post] = await db.select().from(postsTable).where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId))).limit(1);
      if (!post) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      const [packet, logoUrl] = await Promise.all([buildClientMemoryPacket(clientId), findLogoUrl(clientId)]);
      const outputs = [];
      const shouldUseLogo = req.body?.useLogo === true && !!logoUrl;
      const provider = providerForRecommendation(concept.providerRecommendation, req.body?.providerMode);
      for (const sizeId of selectedSizeIds) {
        const preset = SIZE_PRESETS[sizeId];
        const fullPrompt = `${imagePrompt}

Platform size: ${preset.label} ${preset.width}x${preset.height}.
Headline: ${firstString(concept.mainHeadline) ?? ""}
Subtitle: ${firstString(concept.subtitle) ?? ""}
CTA: ${firstString(concept.cta) ?? ""}
Logo placement guidance: ${firstString(concept.logoPlacement) ?? "bottom-right"}.
Color direction: ${firstString(concept.colorDirection) ?? "Use Brand DNA colors"}.
Font style: ${firstString(concept.fontStyle) ?? "Clean modern sans-serif"}.
Background style: ${firstString(concept.backgroundStyle) ?? "polished"}.
Avoid: ${firstString(concept.negativePrompt) ?? "blurry, distorted, unreadable text"}.

${formatClientMemoryPacket(packet)}`;
        const generated = await generateImageWithProvider({
          prompt: fullPrompt,
          userId: req.userId,
          provider,
          aspectRatio: preset.aspectRatio,
          size: preset.providerSize,
        });
        const persisted = await persistRemoteImageUrl(generated.providerUrl, clientId, `creative-${sizeId}`);
        const finalUrl = shouldUseLogo
          ? await compositeLogo(persisted.durableUrl, logoUrl!, clientId, firstString(concept.logoPlacement) ?? "bottom-right")
          : persisted.durableUrl;

        await db.insert(imagesTable).values({
          clientId,
          postId,
          url: finalUrl,
          originalImageUrl: persisted.durableUrl,
          brandedImageUrl: shouldUseLogo ? finalUrl : null,
          provider: generated.provider,
          status: "selected",
          type: "generated",
          prompt: fullPrompt,
          notes: `${preset.label}; provider URL copied to Supabase${shouldUseLogo ? "; logo composited in editor pipeline" : ""}`,
        });
        outputs.push({
          sizePresetId: sizeId,
          label: preset.label,
          width: preset.width,
          height: preset.height,
          imageUrl: finalUrl,
          selectedImageUrl: finalUrl,
          providerImageUrl: generated.providerUrl,
          storedImageUrl: persisted.durableUrl,
          provider: generated.provider,
          model: generated.model,
          logoComposited: shouldUseLogo,
        });
      }

      const primary = outputs[0]!;
      const schema = asRecord(post.contentSchema);
      const nextSchema = {
        ...schema,
        creativeConcept: concept,
        creativeOutputs: outputs,
        backgroundImageUrl: schema.backgroundImageUrl || primary.storedImageUrl,
        selectedImageUrl: primary.selectedImageUrl,
        finalArtworkUrl: primary.imageUrl,
        imageUrl: primary.imageUrl,
        logoUsed: shouldUseLogo,
        logoHandling: shouldUseLogo ? "composited_after_generation" : logoUrl ? "available_not_used" : "no_logo_available",
      };
      const [updatedPost] = await db
        .update(postsTable)
        .set({
          selectedImageUrl: primary.imageUrl,
          originalImageUrl: primary.storedImageUrl,
          brandedImageUrl: shouldUseLogo ? primary.imageUrl : null,
          imagePrompt,
          contentSchema: nextSchema,
          contentSchemaVersion: 1,
          generationMetadata: { ...(asRecord(post.generationMetadata)), route: "creative.generate_image", providerMode: req.body?.providerMode ?? "best_quality" },
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .returning();

      res.json({ post: updatedPost, outputs, logo: { found: !!logoUrl, composited: shouldUseLogo } });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Image generation failed. Add an image provider key in Settings or try a different provider mode.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Creative image generation error");
      res.status(status).json({ error: message });
    }
  }
);

// ===========================================================================
// PHASE 45 — Carousel / Reel / Campaign Pack generators
// ===========================================================================

type Phase45Source = "creative_studio_phase45" | "ai_visibility_phase45" | "ai_brain_phase45";

const VALID_CAROUSEL_PLATFORMS = new Set(["instagram", "linkedin", "facebook"]);
const VALID_REEL_PLATFORMS = new Set(["instagram_reel", "youtube_shorts", "tiktok"]);
const VALID_GOALS = new Set(["awareness", "lead", "sale", "education", "festival", "launch", "engagement"]);
const VALID_DURATIONS = new Set([15, 30, 45]);

function parsePhase45Source(value: unknown, fallback: Phase45Source): Phase45Source {
  if (value === "creative_studio_phase45" || value === "ai_visibility_phase45" || value === "ai_brain_phase45") return value;
  return fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

async function loadSourcePost(clientId: string, postId: string | undefined) {
  if (!postId) return null;
  const [post] = await db
    .select()
    .from(postsTable)
    .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
    .limit(1);
  return post ?? null;
}

function topicFromSourcePost(post: typeof postsTable.$inferSelect | null, fallback: string): string {
  if (!post) return fallback;
  if (post.topic && post.topic.trim()) return post.topic.trim();
  return fallback;
}

function normalizeCarouselSchema(raw: unknown, params: { topic: string; platform: string; goal: string }) {
  const root = asRecord(raw);
  const slidesRaw = asArray(root.slides);
  const slides = slidesRaw.slice(0, 8).map((entry, index) => {
    const row = asRecord(entry);
    const slideNumber = typeof row.slideNumber === "number" ? row.slideNumber : index + 1;
    const allowedTypes = ["hook", "problem", "insight", "solution", "proof", "offer", "cta", "contact", "benefit"];
    const slideType = allowedTypes.includes(String(row.slideType).toLowerCase())
      ? String(row.slideType).toLowerCase()
      : ["hook", "problem", "insight", "solution", "proof", "offer", "cta", "contact"][index] ?? "insight";
    return {
      slideNumber,
      slideType,
      headline: firstString(row.headline, row.title) ?? `Slide ${slideNumber}`,
      bodyCopy: firstString(row.bodyCopy, row.body, row.copy) ?? "",
      visualDirection: firstString(row.visualDirection, row.visual) ?? "Clean, brand-aligned visual with clear focal point.",
      backgroundStyle: firstString(row.backgroundStyle, row.background) ?? "Premium gradient with brand colours.",
      imagePrompt: firstString(row.imagePrompt, row.prompt) ?? `${params.topic} — slide ${slideNumber} concept`,
      brandColorGuidance: firstString(row.brandColorGuidance, row.colorGuidance) ?? "Use Brand DNA primary + accent.",
      logoPlacement: firstString(row.logoPlacement) ?? (slideNumber === 1 ? "bottom-right" : "small bottom corner"),
      notesForDesigner: firstString(row.notesForDesigner, row.designerNotes) ?? "Keep on-screen text short and legible.",
    };
  });

  while (slides.length < 5) {
    const slideNumber = slides.length + 1;
    const fallbackTypes = ["hook", "problem", "insight", "solution", "proof", "offer", "cta", "contact"];
    slides.push({
      slideNumber,
      slideType: fallbackTypes[slideNumber - 1] ?? "insight",
      headline: `Slide ${slideNumber}`,
      bodyCopy: "",
      visualDirection: "Brand-led editorial visual.",
      backgroundStyle: "Premium gradient with brand colours.",
      imagePrompt: `${params.topic} — slide ${slideNumber} concept`,
      brandColorGuidance: "Use Brand DNA primary + accent.",
      logoPlacement: "bottom-right",
      notesForDesigner: "Keep on-screen text short and legible.",
    });
  }

  const recommendedSize = params.platform === "linkedin"
    ? "1080x1350 (portrait)"
    : params.platform === "facebook"
      ? "1080x1080 (square)"
      : "1080x1350 (portrait)";

  return {
    carouselTitle: firstString(root.carouselTitle, root.title) ?? `Carousel: ${params.topic}`,
    platform: params.platform,
    recommendedSize: firstString(root.recommendedSize) ?? recommendedSize,
    caption: firstString(root.caption) ?? "",
    hashtags: firstString(root.hashtags) ?? "",
    cta: firstString(root.cta, root.CTA) ?? "",
    coverPrompt: firstString(root.coverPrompt, slides[0]?.imagePrompt) ?? `${params.topic} — premium carousel cover, brand aligned`,
    slides,
  };
}

function normalizeReelSchema(raw: unknown, params: { topic: string; platform: string; durationSeconds: number }) {
  const root = asRecord(raw);
  const scenesRaw = asArray(root.scenes);
  const targetSceneCount = params.durationSeconds <= 15 ? 4 : params.durationSeconds <= 30 ? 6 : 8;
  const scenes = scenesRaw.slice(0, 10).map((entry, index) => {
    const row = asRecord(entry);
    return {
      sceneNumber: typeof row.sceneNumber === "number" ? row.sceneNumber : index + 1,
      timestamp: firstString(row.timestamp) ?? `${Math.round((index * params.durationSeconds) / Math.max(targetSceneCount, 1))}s`,
      shotType: firstString(row.shotType) ?? "medium",
      visualDirection: firstString(row.visualDirection) ?? "",
      onScreenText: firstString(row.onScreenText, row.overlayText) ?? "",
      voiceoverLine: firstString(row.voiceoverLine, row.voiceover) ?? "",
      motionDirection: firstString(row.motionDirection, row.motion) ?? "subtle camera move",
      transition: firstString(row.transition) ?? "cut",
      imagePrompt: firstString(row.imagePrompt) ?? `${params.topic} — scene ${index + 1}`,
      videoPrompt: firstString(row.videoPrompt) ?? `${params.topic} — short vertical motion clip for scene ${index + 1}`,
    };
  });

  while (scenes.length < Math.min(targetSceneCount, 4)) {
    const idx = scenes.length;
    scenes.push({
      sceneNumber: idx + 1,
      timestamp: `${Math.round((idx * params.durationSeconds) / Math.max(targetSceneCount, 1))}s`,
      shotType: "medium",
      visualDirection: "Brand-aligned vertical visual.",
      onScreenText: "",
      voiceoverLine: "",
      motionDirection: "subtle camera move",
      transition: "cut",
      imagePrompt: `${params.topic} — scene ${idx + 1}`,
      videoPrompt: `${params.topic} — short vertical motion clip for scene ${idx + 1}`,
    });
  }

  return {
    reelTitle: firstString(root.reelTitle, root.title) ?? `Reel: ${params.topic}`,
    platform: params.platform,
    duration: params.durationSeconds,
    aspectRatio: "9:16",
    resolution: "1080x1920",
    hookFirstTwoSeconds: firstString(root.hookFirstTwoSeconds, root.hook) ?? "",
    fullScript: firstString(root.fullScript, root.script) ?? "",
    caption: firstString(root.caption) ?? "",
    hashtags: firstString(root.hashtags) ?? "",
    cta: firstString(root.cta, root.CTA) ?? "",
    thumbnailPrompt: firstString(root.thumbnailPrompt, root.thumbnail) ?? `${params.topic} — vertical reel thumbnail, hook headline, brand aligned`,
    suggestedMusicMood: firstString(root.suggestedMusicMood, root.musicMood, root.music) ?? "upbeat brand mood",
    scenes,
  };
}

// ---------------------------------------------------------------------------
// POST /clients/:clientId/creative/generate-carousel
// ---------------------------------------------------------------------------
router.post(
  "/clients/:clientId/creative/generate-carousel",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const body = req.body as {
      topic?: unknown;
      platform?: unknown;
      goal?: unknown;
      occasionTitle?: unknown;
      source?: unknown;
      sourcePostId?: unknown;
      campaignId?: unknown;
    };

    const sourcePost = await loadSourcePost(clientId, typeof body.sourcePostId === "string" ? body.sourcePostId : undefined);
    const fallbackTopic = typeof body.topic === "string" ? body.topic.trim() : "";
    const topic = topicFromSourcePost(sourcePost, fallbackTopic);
    if (!topic) {
      res.status(400).json({ error: "topic or sourcePostId is required" });
      return;
    }

    const platform = typeof body.platform === "string" && VALID_CAROUSEL_PLATFORMS.has(body.platform)
      ? body.platform
      : "instagram";
    const goal = typeof body.goal === "string" && VALID_GOALS.has(body.goal) ? body.goal : "awareness";
    const source = parsePhase45Source(body.source, sourcePost ? "ai_visibility_phase45" : "creative_studio_phase45");
    const occasionTitle = typeof body.occasionTitle === "string" ? body.occasionTitle.trim() : "";
    const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const sourceSchema = sourcePost ? asRecord(sourcePost.contentSchema) : {};
      const sourceDirections = sourcePost ? extractAiVisibilityPromptDirections(sourceSchema) : [];

      const { provider, model } = await resolveTextProviderForMode("best_quality", req.userId);
      const prompt = `You are the Carousel Builder for AI Marketing Studio. Create one platform-ready ${platform} carousel about the topic below.

${context}

## Carousel brief
Topic: ${topic}
Platform: ${platform}
Goal: ${goal}
${occasionTitle ? `Occasion: ${occasionTitle}` : ""}
${sourcePost ? `Source draft topic: ${sourcePost.topic}` : ""}
${sourcePost ? `Source draft caption: ${sourcePost.caption}` : ""}
${sourceDirections.length ? `Saved image prompt directions: ${sourceDirections.map((item) => `- ${item}`).join("\n")}` : ""}

Rules:
- Produce between 5 and 8 slides. Default structure: Hook → Problem → Insight → Solution → Proof → Benefit/Offer → CTA → Contact.
- Each slide must have slideNumber, slideType, headline, bodyCopy, visualDirection, backgroundStyle, imagePrompt, brandColorGuidance, logoPlacement, notesForDesigner.
- slideType is one of: hook, problem, insight, solution, proof, offer, cta, contact.
- Keep headlines short (under 10 words). Body copy under 35 words per slide.
- Use Brand DNA colors and content rules from context.
- Caption ≤ 220 words. Add a CTA. Add 12–18 relevant hashtags as a single string.
- Provide a coverPrompt that captures the carousel hero visual for AI image generation.

Return ONLY valid JSON:
{
  "carouselTitle": "",
  "recommendedSize": "1080x1350 (portrait)",
  "caption": "",
  "hashtags": "",
  "cta": "",
  "coverPrompt": "",
  "slides": [
    {
      "slideNumber": 1,
      "slideType": "hook",
      "headline": "",
      "bodyCopy": "",
      "visualDirection": "",
      "backgroundStyle": "",
      "imagePrompt": "",
      "brandColorGuidance": "",
      "logoPlacement": "",
      "notesForDesigner": ""
    }
  ]
}`;

      const { object, usedProvider, usedModel, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider,
        model,
        prompt,
        maxTokens: 4200,
        userId: req.userId,
        schemaName: "carousel_builder",
        validate: validatorForSkill("carousel_builder"),
      });
      const carousel = normalizeCarouselSchema(object, { topic, platform, goal });

      const slidePrompts = carousel.slides.map((slide) => slide.imagePrompt).filter(Boolean);
      const carouselSlidesLegacy = carousel.slides.map((slide) => ({
        slideNumber: slide.slideNumber,
        headline: slide.headline,
        copy: slide.bodyCopy,
        visual: slide.visualDirection,
      }));

      const contentSchema = {
        source,
        sourcePostId: sourcePost?.id ?? null,
        carousel,
        coverPrompt: carousel.coverPrompt,
        slidePrompts,
        imagePromptDirections: slidePrompts,
        imagePrompt: carousel.coverPrompt,
        // legacy keys so existing AI Visibility carousel render paths still work
        carouselSlides: carouselSlidesLegacy,
        cta: carousel.cta,
      };

      const [created] = await db
        .insert(postsTable)
        .values({
          clientId,
          campaignId: campaignId ?? undefined,
          contentType: "carousel",
          topic: carousel.carouselTitle || topic,
          caption: carousel.caption,
          hashtags: carousel.hashtags,
          platform,
          postType: "social",
          status: "draft",
          imagePrompt: carousel.coverPrompt,
          contentSchema,
          contentSchemaVersion: 1,
          generationMetadata: {
            route: "creative.generate_carousel",
            provider: usedProvider,
            model: usedModel,
            fallbackUsed,
            repairUsed,
            source,
            goal,
            sourcePostId: sourcePost?.id ?? null,
          },
        })
        .returning();

      logger.info({ clientId, postId: created.id, source, provider: usedProvider, fallbackUsed, repairUsed }, "Phase 45 carousel saved");
      res.status(201).json({
        post: created,
        carousel,
        meta: { provider: usedProvider, model: usedModel, fallbackUsed, repairUsed, source },
      });
    } catch (err) {
      if (err instanceof JsonParseError) {
        logger.error({ clientId, error: err.message, sample: err.rawSample }, "Phase 45 carousel JSON failure");
        res.status(422).json({ error: "AI could not produce a valid carousel. Please retry." });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Failed to generate carousel. Check your AI provider key in Settings.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Phase 45 carousel generation error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/creative/generate-reel-storyboard
// ---------------------------------------------------------------------------
router.post(
  "/clients/:clientId/creative/generate-reel-storyboard",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const body = req.body as {
      topic?: unknown;
      platform?: unknown;
      durationSeconds?: unknown;
      goal?: unknown;
      source?: unknown;
      sourcePostId?: unknown;
      campaignId?: unknown;
    };

    const sourcePost = await loadSourcePost(clientId, typeof body.sourcePostId === "string" ? body.sourcePostId : undefined);
    const fallbackTopic = typeof body.topic === "string" ? body.topic.trim() : "";
    const topic = topicFromSourcePost(sourcePost, fallbackTopic);
    if (!topic) {
      res.status(400).json({ error: "topic or sourcePostId is required" });
      return;
    }

    const platform = typeof body.platform === "string" && VALID_REEL_PLATFORMS.has(body.platform)
      ? body.platform
      : "instagram_reel";
    const durationSeconds = typeof body.durationSeconds === "number" && VALID_DURATIONS.has(body.durationSeconds)
      ? body.durationSeconds
      : 30;
    const goal = typeof body.goal === "string" && VALID_GOALS.has(body.goal) ? body.goal : "awareness";
    const source = parsePhase45Source(body.source, sourcePost ? "ai_visibility_phase45" : "creative_studio_phase45");
    const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const sourceSchema = sourcePost ? asRecord(sourcePost.contentSchema) : {};
      const sourceDirections = sourcePost ? extractAiVisibilityPromptDirections(sourceSchema) : [];

      const { provider, model } = await resolveTextProviderForMode("best_quality", req.userId);
      const prompt = `You are the Reel & Shorts Storyboard Builder for AI Marketing Studio. Create one vertical short-form video storyboard for the topic below.

${context}

## Reel brief
Topic: ${topic}
Platform: ${platform}
Goal: ${goal}
Duration: ${durationSeconds} seconds (vertical 9:16, target 1080x1920)
${sourcePost ? `Source draft topic: ${sourcePost.topic}` : ""}
${sourcePost ? `Source draft caption: ${sourcePost.caption}` : ""}
${sourceDirections.length ? `Saved visibility directions: ${sourceDirections.map((item) => `- ${item}`).join("\n")}` : ""}

Rules:
- Vertical 9:16 format, 1080x1920.
- Strong hook in the first 2 seconds.
- ${durationSeconds <= 15 ? "Produce 3–4 scenes." : durationSeconds <= 30 ? "Produce 5–6 scenes." : "Produce 7–8 scenes."}
- Each scene must include sceneNumber, timestamp, shotType, visualDirection, onScreenText, voiceoverLine, motionDirection, transition, imagePrompt, videoPrompt.
- Keep on-screen text short. Avoid walls of text.
- Place the CTA near the end (last 3 seconds).
- Provide a single thumbnailPrompt for an AI image generator.

Return ONLY valid JSON:
{
  "reelTitle": "",
  "hookFirstTwoSeconds": "",
  "fullScript": "",
  "caption": "",
  "hashtags": "",
  "cta": "",
  "thumbnailPrompt": "",
  "suggestedMusicMood": "",
  "scenes": [
    {
      "sceneNumber": 1,
      "timestamp": "0s",
      "shotType": "",
      "visualDirection": "",
      "onScreenText": "",
      "voiceoverLine": "",
      "motionDirection": "",
      "transition": "",
      "imagePrompt": "",
      "videoPrompt": ""
    }
  ]
}`;

      const { object, usedProvider, usedModel, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider,
        model,
        prompt,
        maxTokens: 4500,
        userId: req.userId,
        schemaName: "reel_storyboard_builder",
        validate: validatorForSkill("reel_storyboard_builder"),
      });
      const reelStoryboard = normalizeReelSchema(object, { topic, platform, durationSeconds });

      const scenePrompts = reelStoryboard.scenes.map((scene) => scene.imagePrompt).filter(Boolean);

      const contentSchema = {
        source,
        sourcePostId: sourcePost?.id ?? null,
        reelStoryboard,
        thumbnailPrompt: reelStoryboard.thumbnailPrompt,
        scenePrompts,
        imagePromptDirections: [reelStoryboard.thumbnailPrompt, ...scenePrompts].filter(Boolean),
        imagePrompt: reelStoryboard.thumbnailPrompt,
        // legacy keys so existing AI Visibility reel render path still works
        storyboard: reelStoryboard.fullScript,
        hook: reelStoryboard.hookFirstTwoSeconds,
        scenes: reelStoryboard.scenes,
        audioSuggestion: reelStoryboard.suggestedMusicMood,
        cta: reelStoryboard.cta,
      };

      const [created] = await db
        .insert(postsTable)
        .values({
          clientId,
          campaignId: campaignId ?? undefined,
          contentType: "reel_storyboard",
          topic: reelStoryboard.reelTitle || topic,
          caption: reelStoryboard.caption,
          hashtags: reelStoryboard.hashtags,
          platform,
          postType: "video",
          status: "draft",
          imagePrompt: reelStoryboard.thumbnailPrompt,
          contentSchema,
          contentSchemaVersion: 1,
          generationMetadata: {
            route: "creative.generate_reel_storyboard",
            provider: usedProvider,
            model: usedModel,
            fallbackUsed,
            repairUsed,
            source,
            goal,
            durationSeconds,
            sourcePostId: sourcePost?.id ?? null,
          },
        })
        .returning();

      logger.info({ clientId, postId: created.id, source, durationSeconds, provider: usedProvider, fallbackUsed, repairUsed }, "Phase 45 reel storyboard saved");
      res.status(201).json({
        post: created,
        reelStoryboard,
        meta: { provider: usedProvider, model: usedModel, fallbackUsed, repairUsed, source },
      });
    } catch (err) {
      if (err instanceof JsonParseError) {
        logger.error({ clientId, error: err.message, sample: err.rawSample }, "Phase 45 reel storyboard JSON failure");
        res.status(422).json({ error: "AI could not produce a valid reel storyboard. Please retry." });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Failed to generate reel storyboard. Check your AI provider key in Settings.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Phase 45 reel storyboard generation error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/creative/generate-campaign-pack
// ---------------------------------------------------------------------------
router.post(
  "/clients/:clientId/creative/generate-campaign-pack",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const body = req.body as {
      topic?: unknown;
      goal?: unknown;
      platforms?: unknown;
      source?: unknown;
      sourcePostId?: unknown;
    };

    const sourcePost = await loadSourcePost(clientId, typeof body.sourcePostId === "string" ? body.sourcePostId : undefined);
    const fallbackTopic = typeof body.topic === "string" ? body.topic.trim() : "";
    const topic = topicFromSourcePost(sourcePost, fallbackTopic);
    if (!topic) {
      res.status(400).json({ error: "topic or sourcePostId is required" });
      return;
    }

    const goal = typeof body.goal === "string" && VALID_GOALS.has(body.goal) ? body.goal : "awareness";
    const platforms = Array.isArray(body.platforms) && body.platforms.length
      ? body.platforms.map((p) => String(p).trim()).filter(Boolean)
      : ["instagram", "linkedin", "facebook"];
    const source = parsePhase45Source(body.source, sourcePost ? "ai_visibility_phase45" : "creative_studio_phase45");

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const sourceSchema = sourcePost ? asRecord(sourcePost.contentSchema) : {};
      const sourceDirections = sourcePost ? extractAiVisibilityPromptDirections(sourceSchema) : [];

      const { provider, model } = await resolveTextProviderForMode("best_quality", req.userId);
      const prompt = `You are the Full Campaign Pack Generator for AI Marketing Studio. From ONE topic, produce a complete reviewable campaign pack.

${context}

## Pack brief
Topic: ${topic}
Goal: ${goal}
Platforms: ${platforms.join(", ")}
${sourcePost ? `Source draft topic: ${sourcePost.topic}` : ""}
${sourceDirections.length ? `Saved visibility directions:\n${sourceDirections.map((item) => `- ${item}`).join("\n")}` : ""}

Produce:
1) instagramCarousel — full 5–8 slide carousel for Instagram.
2) linkedinPost — one LinkedIn authority post OR document-style carousel; set "format": "authority_post" or "document_carousel".
3) reelStoryboard — one 30-second vertical reel storyboard.
4) socialPosts — exactly 2 short-form posts targeting any two of: ${platforms.join(", ")}.
5) blogOutline — one SEO-ready blog outline (only required if AI Visibility context is available; otherwise return null).
6) imageDirections — exactly 3 image creative directions for the pack.
7) postingSuggestions — 5 short scheduling tips.

Each carousel slide: slideNumber, slideType, headline, bodyCopy, visualDirection, backgroundStyle, imagePrompt, brandColorGuidance, logoPlacement, notesForDesigner.
Reel storyboard: reelTitle, hookFirstTwoSeconds, fullScript, caption, hashtags, cta, thumbnailPrompt, suggestedMusicMood, scenes[] (each with sceneNumber, timestamp, shotType, visualDirection, onScreenText, voiceoverLine, motionDirection, transition, imagePrompt, videoPrompt).
Each socialPost: platform, caption, hashtags, cta, imagePrompt.
LinkedIn post: format, title, hook, body, cta, hashtags, imagePrompt OR slides[] for document_carousel.
Image direction: concept, imagePrompt, recommendedProvider, brandColorGuidance.

Return ONLY valid JSON:
{
  "campaignName": "",
  "instagramCarousel": { ... },
  "linkedinPost": { ... },
  "reelStoryboard": { ... },
  "socialPosts": [ ... ],
  "blogOutline": null,
  "imageDirections": [ ... ],
  "postingSuggestions": [ ... ]
}`;

      const { object, usedProvider, usedModel, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider,
        model,
        prompt,
        maxTokens: 8000,
        userId: req.userId,
        schemaName: "campaign_pack_builder",
        validate: validatorForSkill("campaign_pack_builder"),
      });
      const pack = asRecord(object);

      const campaignName = firstString(pack.campaignName) ?? `Campaign Pack — ${topic}`;
      const carousel = normalizeCarouselSchema(asRecord(pack.instagramCarousel), { topic, platform: "instagram", goal });
      const reelStoryboard = normalizeReelSchema(asRecord(pack.reelStoryboard), { topic, platform: "instagram_reel", durationSeconds: 30 });
      const linkedinPost = asRecord(pack.linkedinPost);
      const socialPosts = asArray<Record<string, unknown>>(pack.socialPosts).slice(0, 4);
      const blogOutline = pack.blogOutline ? asRecord(pack.blogOutline) : null;
      const imageDirections = asArray<Record<string, unknown>>(pack.imageDirections).slice(0, 6);
      const postingSuggestions = asArray<unknown>(pack.postingSuggestions).map(String).filter(Boolean).slice(0, 10);

      // 1) Campaign container
      const [campaign] = await db
        .insert(campaignsTable)
        .values({
          clientId,
          name: campaignName,
          goal,
          description: `Phase 45 Campaign Pack for "${topic}". Source: ${source}.`,
          platforms: JSON.stringify(platforms),
          status: "draft",
        })
        .returning();

      const campaignId = campaign.id;
      const createdPosts: typeof postsTable.$inferSelect[] = [];

      // 2) Instagram carousel post
      {
        const slidePrompts = carousel.slides.map((slide) => slide.imagePrompt).filter(Boolean);
        const carouselSlidesLegacy = carousel.slides.map((slide) => ({
          slideNumber: slide.slideNumber,
          headline: slide.headline,
          copy: slide.bodyCopy,
          visual: slide.visualDirection,
        }));
        const [created] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "carousel",
          topic: carousel.carouselTitle || topic,
          caption: carousel.caption,
          hashtags: carousel.hashtags,
          platform: "instagram",
          postType: "social",
          status: "draft",
          imagePrompt: carousel.coverPrompt,
          contentSchema: {
            source,
            sourcePostId: sourcePost?.id ?? null,
            carousel,
            coverPrompt: carousel.coverPrompt,
            slidePrompts,
            imagePromptDirections: slidePrompts,
            imagePrompt: carousel.coverPrompt,
            carouselSlides: carouselSlidesLegacy,
            cta: carousel.cta,
            packRole: "instagram_carousel",
          },
          contentSchemaVersion: 1,
          generationMetadata: { route: "creative.generate_campaign_pack", provider: usedProvider, model: usedModel, fallbackUsed, source, role: "instagram_carousel" },
        }).returning();
        createdPosts.push(created);
      }

      // 3) LinkedIn post (carousel or authority post)
      if (linkedinPost && (firstString(linkedinPost.body) || asArray(linkedinPost.slides).length)) {
        const linkedinFormat = firstString(linkedinPost.format) === "document_carousel" ? "document_carousel" : "authority_post";
        const linkedinCaption = firstString(linkedinPost.body, linkedinPost.hook) ?? "";
        const linkedinImagePrompt = firstString(linkedinPost.imagePrompt) ?? `${topic} — LinkedIn authority visual`;
        const linkedinSlides = asArray(linkedinPost.slides);
        const contentType = linkedinFormat === "document_carousel" ? "carousel" : "social_post";
        const linkedinCarouselNormalized = linkedinFormat === "document_carousel"
          ? normalizeCarouselSchema({ slides: linkedinSlides, caption: linkedinCaption, hashtags: linkedinPost.hashtags, cta: linkedinPost.cta }, { topic, platform: "linkedin", goal })
          : null;
        const [created] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType,
          topic: firstString(linkedinPost.title) ?? `LinkedIn: ${topic}`,
          caption: linkedinCaption,
          hashtags: firstString(linkedinPost.hashtags) ?? "",
          platform: "linkedin",
          postType: "social",
          status: "draft",
          imagePrompt: linkedinImagePrompt,
          contentSchema: {
            source,
            sourcePostId: sourcePost?.id ?? null,
            linkedinFormat,
            title: firstString(linkedinPost.title) ?? "",
            hook: firstString(linkedinPost.hook) ?? "",
            cta: firstString(linkedinPost.cta) ?? "",
            imagePrompt: linkedinImagePrompt,
            ...(linkedinCarouselNormalized ? {
              carousel: linkedinCarouselNormalized,
              coverPrompt: linkedinCarouselNormalized.coverPrompt,
              slidePrompts: linkedinCarouselNormalized.slides.map((s) => s.imagePrompt),
              carouselSlides: linkedinCarouselNormalized.slides.map((s) => ({ slideNumber: s.slideNumber, headline: s.headline, copy: s.bodyCopy, visual: s.visualDirection })),
            } : {}),
            packRole: "linkedin_post",
          },
          contentSchemaVersion: 1,
          generationMetadata: { route: "creative.generate_campaign_pack", provider: usedProvider, model: usedModel, fallbackUsed, source, role: "linkedin_post" },
        }).returning();
        createdPosts.push(created);
      }

      // 4) Reel storyboard post
      {
        const scenePrompts = reelStoryboard.scenes.map((scene) => scene.imagePrompt).filter(Boolean);
        const [created] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "reel_storyboard",
          topic: reelStoryboard.reelTitle || topic,
          caption: reelStoryboard.caption,
          hashtags: reelStoryboard.hashtags,
          platform: "instagram_reel",
          postType: "video",
          status: "draft",
          imagePrompt: reelStoryboard.thumbnailPrompt,
          contentSchema: {
            source,
            sourcePostId: sourcePost?.id ?? null,
            reelStoryboard,
            thumbnailPrompt: reelStoryboard.thumbnailPrompt,
            scenePrompts,
            imagePromptDirections: [reelStoryboard.thumbnailPrompt, ...scenePrompts].filter(Boolean),
            imagePrompt: reelStoryboard.thumbnailPrompt,
            storyboard: reelStoryboard.fullScript,
            hook: reelStoryboard.hookFirstTwoSeconds,
            scenes: reelStoryboard.scenes,
            audioSuggestion: reelStoryboard.suggestedMusicMood,
            cta: reelStoryboard.cta,
            packRole: "reel_storyboard",
          },
          contentSchemaVersion: 1,
          generationMetadata: { route: "creative.generate_campaign_pack", provider: usedProvider, model: usedModel, fallbackUsed, source, role: "reel_storyboard" },
        }).returning();
        createdPosts.push(created);
      }

      // 5) Social posts (up to 2)
      for (let i = 0; i < Math.min(socialPosts.length, 2); i++) {
        const post = socialPosts[i];
        const platform = firstString(post.platform) ?? platforms[i] ?? "instagram";
        const caption = firstString(post.caption) ?? "";
        if (!caption) continue;
        const imagePrompt = firstString(post.imagePrompt) ?? `${topic} — ${platform} hero visual`;
        const [created] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "social_post",
          topic,
          caption,
          hashtags: firstString(post.hashtags) ?? "",
          platform,
          postType: "social",
          status: "draft",
          imagePrompt,
          contentSchema: {
            source,
            sourcePostId: sourcePost?.id ?? null,
            cta: firstString(post.cta) ?? "",
            imagePrompt,
            imagePromptDirections: [imagePrompt],
            packRole: `social_post_${i + 1}`,
          },
          contentSchemaVersion: 1,
          generationMetadata: { route: "creative.generate_campaign_pack", provider: usedProvider, model: usedModel, fallbackUsed, source, role: `social_post_${i + 1}` },
        }).returning();
        createdPosts.push(created);
      }

      // 6) Blog outline (only if model returned one)
      if (blogOutline) {
        const blogTitle = firstString(blogOutline.title, blogOutline.seoTitle) ?? `Blog: ${topic}`;
        const [created] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "blog",
          topic: blogTitle,
          caption: firstString(blogOutline.metaDescription, blogOutline.summary) ?? "",
          title: blogTitle,
          longFormBody: JSON.stringify(blogOutline.outline ?? blogOutline),
          platform: "blog",
          postType: "blog",
          status: "draft",
          contentSchema: {
            source,
            sourcePostId: sourcePost?.id ?? null,
            seoTitle: firstString(blogOutline.seoTitle) ?? blogTitle,
            metaDescription: firstString(blogOutline.metaDescription) ?? "",
            outline: blogOutline.outline ?? "",
            faqs: asArray(blogOutline.faqs),
            imagePrompt: firstString(blogOutline.imagePrompt) ?? `${topic} — blog hero illustration`,
            imagePromptDirections: [firstString(blogOutline.imagePrompt) ?? `${topic} — blog hero illustration`],
            packRole: "blog_outline",
          },
          contentSchemaVersion: 1,
          generationMetadata: { route: "creative.generate_campaign_pack", provider: usedProvider, model: usedModel, fallbackUsed, source, role: "blog_outline" },
        }).returning();
        createdPosts.push(created);
      }

      // 7) Campaign output record
      await db.insert(campaignOutputsTable).values({
        clientId,
        campaignId,
        campaignName,
        goal,
        platforms: JSON.stringify(platforms),
        intensity: "standard",
        qualityMode: "balanced",
        brief: `Phase 45 Campaign Pack from topic "${topic}". Source: ${source}.`,
        socialPostsJson: JSON.stringify(socialPosts),
        blogOutlinesJson: JSON.stringify(blogOutline ? [blogOutline] : []),
        imagePromptsJson: JSON.stringify(imageDirections),
        videoConceptsJson: JSON.stringify([reelStoryboard]),
        scheduleJson: JSON.stringify(postingSuggestions),
        status: "ready",
      });

      logger.info({ clientId, campaignId, postsCreated: createdPosts.length, source }, "Phase 45 campaign pack saved");
      res.status(201).json({
        campaign,
        posts: createdPosts,
        pack: {
          campaignName,
          instagramCarousel: carousel,
          linkedinPost,
          reelStoryboard,
          socialPosts,
          blogOutline,
          imageDirections,
          postingSuggestions,
        },
        meta: { provider: usedProvider, model: usedModel, fallbackUsed, repairUsed, source, postsCreated: createdPosts.length },
      });
    } catch (err) {
      if (err instanceof JsonParseError) {
        logger.error({ clientId, error: err.message, sample: err.rawSample }, "Phase 45 campaign pack JSON failure");
        res.status(422).json({ error: "AI could not produce a valid campaign pack. Please retry." });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Failed to generate campaign pack. Check your AI provider key in Settings.");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Phase 45 campaign pack error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /clients/:clientId/creative/generate-cover-image
// Lightweight wrapper around /creative/generate-image that uses a stored
// coverPrompt (carousel) or thumbnailPrompt (reel) from contentSchema.
// ---------------------------------------------------------------------------
router.post(
  "/clients/:clientId/creative/generate-cover-image",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { clientId } = req.params;
    const postId = typeof req.body?.postId === "string" ? req.body.postId : "";
    const promptType = req.body?.promptType === "thumbnail" ? "thumbnail" : "cover";
    const sizePresetId: SizePresetId = req.body?.sizePresetId && VALID_SIZE_IDS.includes(req.body.sizePresetId as SizePresetId)
      ? req.body.sizePresetId as SizePresetId
      : (promptType === "thumbnail" ? "instagram_story" : "instagram_portrait");

    if (!postId) {
      res.status(400).json({ error: "postId is required" });
      return;
    }

    try {
      const [post] = await db.select().from(postsTable).where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId))).limit(1);
      if (!post) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      const schema = asRecord(post.contentSchema);
      const sourcePrompt = promptType === "thumbnail"
        ? firstString(schema.thumbnailPrompt, asRecord(schema.reelStoryboard).thumbnailPrompt, schema.imagePrompt, post.imagePrompt)
        : firstString(schema.coverPrompt, asRecord(schema.carousel).coverPrompt, schema.imagePrompt, post.imagePrompt);
      if (!sourcePrompt) {
        res.status(400).json({ error: `No ${promptType} prompt found on this draft. Generate the carousel/reel first or pass a prompt explicitly.` });
        return;
      }

      const preset = SIZE_PRESETS[sizePresetId];
      const [packet, logoUrl] = await Promise.all([buildClientMemoryPacket(clientId), findLogoUrl(clientId)]);
      const shouldUseLogo = req.body?.useLogo === true && !!logoUrl;

      const fullPrompt = `${sourcePrompt}

Platform size: ${preset.label} ${preset.width}x${preset.height}.
${promptType === "thumbnail" ? "This is a vertical reel thumbnail. Keep text short and high-contrast." : "This is a carousel cover. Keep the hero subject and hook headline legible."}
Logo placement guidance: ${promptType === "thumbnail" ? "small bottom corner" : "bottom-right"}.

${formatClientMemoryPacket(packet)}`;

      const generated = await generateImageWithProvider({
        prompt: fullPrompt,
        userId: req.userId,
        provider: "auto",
        aspectRatio: preset.aspectRatio,
        size: preset.providerSize,
      });
      const persisted = await persistRemoteImageUrl(generated.providerUrl, clientId, `creative-${promptType}-${sizePresetId}`);
      const finalUrl = shouldUseLogo
        ? await compositeLogo(persisted.durableUrl, logoUrl!, clientId, promptType === "thumbnail" ? "bottom-center" : "bottom-right")
        : persisted.durableUrl;

      await db.insert(imagesTable).values({
        clientId,
        postId,
        url: finalUrl,
        originalImageUrl: persisted.durableUrl,
        brandedImageUrl: shouldUseLogo ? finalUrl : null,
        provider: generated.provider,
        status: "selected",
        type: "generated",
        prompt: fullPrompt,
        notes: `Phase 45 ${promptType} image (${preset.label})`,
      });

      const nextSchema = {
        ...schema,
        ...(promptType === "thumbnail"
          ? { thumbnailUrl: finalUrl, finalArtworkUrl: schema.finalArtworkUrl || finalUrl }
          : { coverArtworkUrl: finalUrl, finalArtworkUrl: schema.finalArtworkUrl || finalUrl }),
      };

      const [updatedPost] = await db
        .update(postsTable)
        .set({
          selectedImageUrl: post.selectedImageUrl ?? finalUrl,
          originalImageUrl: post.originalImageUrl ?? persisted.durableUrl,
          contentSchema: nextSchema,
          contentSchemaVersion: 1,
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .returning();

      res.json({ post: updatedPost, imageUrl: finalUrl, provider: generated.provider, sizePresetId });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Image generation failed. Add an image provider key in Settings (OpenAI, Replicate, or Ideogram).");
      logger.error({ clientId, error: safeErrorMessage(err) }, "Phase 45 cover/thumbnail image error");
      res.status(status).json({ error: message });
    }
  }
);

export default router;
