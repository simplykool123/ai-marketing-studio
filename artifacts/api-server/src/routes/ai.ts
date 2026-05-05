import { Router } from "express";
import OpenAI from "openai";
import { buildClientContext, buildImagePrompt } from "../lib/context-engine.js";
import { GenerateCaptionsBody, GenerateImagesBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { imagesTable, postsTable, userSettingsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
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

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X/Twitter",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  blog: "Blog",
  newsletter: "Newsletter",
};

const PLATFORM_RATIOS: Record<string, string> = {
  instagram: "1:1 square, crop-safe for optional 4:5 portrait",
  facebook: "1.91:1 feed",
  linkedin: "1.91:1 feed",
  twitter: "16:9 wide",
  youtube: "16:9 thumbnail",
  blog: "wide blog header",
  newsletter: "wide newsletter banner",
};

type BrandControls = {
  useBrandDna?: boolean;
  useBrandColors?: boolean;
  includeLogo?: boolean;
  useBrandAssets?: boolean;
  brandName?: string;
  logoUrl?: string;
  assetUrls?: string[];
  assetNotes?: string;
  captionContext?: string;
  imageContext?: string;
};

function buildBrandControlInstructions(controls?: BrandControls, mode: "caption" | "image" = "caption"): string {
  if (!controls) return "";
  const enabled = [
    controls.useBrandDna ? "brand voice and Brand DNA" : null,
    controls.useBrandColors ? "brand colors" : null,
    controls.includeLogo ? "logo or brand mark" : null,
    controls.useBrandAssets ? "uploaded brand assets as visual references" : null,
  ].filter(Boolean);
  const disabled = [
    controls.useBrandDna === false ? "Do not use Brand DNA beyond the topic." : null,
    controls.useBrandColors === false ? "Do not force brand colors." : null,
    controls.includeLogo === false ? "Do not include or imply a logo/brand mark." : null,
    controls.useBrandAssets === false ? "Do not reference uploaded brand assets." : null,
  ].filter(Boolean);
  const assetRefs = controls.useBrandAssets && controls.assetUrls?.length
    ? `Reference asset URLs: ${controls.assetUrls.slice(0, 6).join(", ")}`
    : null;
  const assetNotes = controls.useBrandAssets && controls.assetNotes
    ? `Reference asset notes:\n${controls.assetNotes}`
    : null;
  const logoInstruction = controls.includeLogo
    ? `Logo guidance: Use the uploaded logo/brand mark as a separate brand element or placement cue when appropriate. Do not redraw the exact logo from memory.${controls.logoUrl ? ` Logo URL: ${controls.logoUrl}` : ""}`
    : null;

  return [
    enabled.length ? `Use: ${enabled.join(", ")}.` : null,
    disabled.length ? disabled.join(" ") : null,
    controls.brandName ? `Client/brand name: ${controls.brandName}.` : null,
    mode === "caption" && controls.captionContext ? `Caption brand inputs:\n${controls.captionContext}` : null,
    mode === "image" && controls.imageContext ? `Image brand inputs:\n${controls.imageContext}` : null,
    logoInstruction,
    assetRefs,
    assetNotes,
  ].filter(Boolean).join("\n");
}

router.post("/ai/generate-captions", async (req: AuthRequest, res) => {
  try {
    const rawBody = req.body as {
      platforms?: string[];
      brandControls?: BrandControls;
    };
    const body = GenerateCaptionsBody.parse(req.body);
    const hasAccess = await userHasClientRole(req.userId!, body.clientId, EDIT_CONTENT_ROLES);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }

    const requestedPlatforms = Array.isArray(rawBody.platforms) && rawBody.platforms.length > 0
      ? rawBody.platforms.filter((platform) => PLATFORM_LABELS[platform])
      : [];
    const context = rawBody.brandControls?.useBrandDna === false
      ? "## Brand Identity\nBrand DNA disabled for this generation."
      : await buildClientContext(body.clientId);
    const brandControlInstructions = buildBrandControlInstructions(rawBody.brandControls, "caption");
    const settings = await getUserSettings(req.userId);
    const { provider, model } = await resolveProviderAndModel(settings, req.userId);

    const platformInstructions = requestedPlatforms.length > 0
      ? `Generate one adapted output for each selected platform: ${requestedPlatforms.map((p) => PLATFORM_LABELS[p]).join(", ")}.
For each platform, adapt length, CTA, hashtag density, and format to the channel. YouTube should be thumbnail/title-oriented; Blog and Newsletter should use fewer or no hashtags where appropriate.`
      : "Generate exactly 3 distinct caption options.";
    const responseShape = requestedPlatforms.length > 0
      ? `{
  "platforms": [
    { "platform": "instagram", "caption": "...", "hashtags": "#tag1 #tag2", "imagePrompt": "..." }
  ]
}`
      : `{
  "options": [
    { "id": 1, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" },
    { "id": 2, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" },
    { "id": 3, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" }
  ]
}`;

    const prompt = `You are a professional multi-channel content strategist. Using the selected brand context below, generate platform-specific content for the given topic.

${context}

${brandControlInstructions ? `## Brand Controls\n${brandControlInstructions}\n` : ""}

## Post Topic
${body.topic}

## Instructions
- ${platformInstructions}
- When Brand DNA is enabled, use brand tone, target audience, USP or differentiator, content pillars, brand values, current storyline if available, and recent post history if available.
- Include relevant hashtags only where they fit the platform
- Keep each caption engaging and platform-appropriate
- Include an image prompt per platform when the response shape asks for it
- Do NOT number the captions in the text itself

Respond with ONLY valid JSON in this exact format:
${responseShape}`;

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
  let parsedPostId: string | undefined;
  let parsedClientId: string | undefined;
  try {
    const rawBody = req.body as {
      platform?: string;
      desiredRatio?: string;
      brandControls?: BrandControls;
    };
    const body = GenerateImagesBody.parse(req.body);
    parsedPostId = body.postId;
    parsedClientId = body.clientId;
    const hasAccess = await userHasClientRole(req.userId!, body.clientId, EDIT_CONTENT_ROLES);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }

    if (body.postId) {
      await db
        .update(postsTable)
        .set({ generationStatus: "generating", updatedAt: new Date() })
        .where(and(eq(postsTable.id, body.postId), eq(postsTable.clientId, body.clientId)));
    }

    const platform = rawBody.platform ?? "instagram";
    const desiredRatio = rawBody.desiredRatio ?? PLATFORM_RATIOS[platform] ?? "platform feed";
    const brandControls = buildBrandControlInstructions(rawBody.brandControls, "image");
    const visualStyle = [
      body.visualStyle,
      `Platform: ${PLATFORM_LABELS[platform] ?? platform}. Desired platform ratio: ${desiredRatio}. Keep key subjects and text crop-safe for this ratio.`,
      brandControls,
    ].filter(Boolean).join("\n");

    const basePrompt = await buildImagePrompt(body.clientId, body.caption, visualStyle, {
      useBrandDna: rawBody.brandControls?.useBrandDna,
      useBrandColors: rawBody.brandControls?.useBrandColors,
    });
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

    if (body.postId) {
      const successfulImages = images.filter((image) => image.url);
      const selectedImageUrl = successfulImages[0]?.url ?? "";

      if (successfulImages.length > 0) {
        await db
          .update(postsTable)
          .set({
            selectedImageUrl,
            generationStatus: "ready",
            imagePrompt: basePrompt,
            updatedAt: new Date(),
          })
          .where(and(eq(postsTable.id, body.postId), eq(postsTable.clientId, body.clientId)));

        await db.insert(imagesTable).values(
          successfulImages.map((image, index) => ({
            clientId: body.clientId,
            postId: body.postId!,
            url: image.url,
            provider: image.provider,
            status: index === 0 ? "selected" : "rejected",
            prompt: image.prompt,
          }))
        );
      } else {
        await db
          .update(postsTable)
          .set({ generationStatus: "failed", imagePrompt: basePrompt, updatedAt: new Date() })
          .where(and(eq(postsTable.id, body.postId), eq(postsTable.clientId, body.clientId)));
      }
    }

    res.json({ images });
  } catch (err) {
    if (parsedPostId && parsedClientId) {
      await db
        .update(postsTable)
        .set({ generationStatus: "failed", updatedAt: new Date() })
        .where(and(eq(postsTable.id, parsedPostId), eq(postsTable.clientId, parsedClientId)))
        .catch(() => {});
    }
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
