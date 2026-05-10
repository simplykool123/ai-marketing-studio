import { Router } from "express";
import { db } from "@workspace/db";
import { imagesTable, postsTable, userSettingsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import { findOccasion, listOccasionsForYear, occasionDate, type MarketingOccasion } from "../lib/marketing-occasions.js";
import {
  generateTextWithProvider,
  resolveApiKey,
  resolveProviderAndModel,
  safeErrorMessage,
  toAiErrorResponse,
} from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { persistRemoteImageUrl } from "../lib/durable-image-storage.js";
import { uploadToSupabase } from "./upload.js";
import OpenAI from "openai";
import sharp from "sharp";

const router = Router();

type OccasionDraft = {
  contentType?: string;
  platform?: string;
  topic?: string;
  caption?: string;
  imagePrompt?: string;
  creativeDirection?: string;
  artworkDirection?: string;
  festiveAngle?: string;
  headline?: string;
  subline?: string;
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

const PLATFORM_MAP: Record<string, string> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  twitter: "twitter",
  x: "twitter",
  blog: "blog",
  newsletter: "newsletter",
};

const CONTENT_TYPE_MAP: Record<string, string> = {
  social_post: "social_post",
  social: "social_post",
  carousel: "carousel",
  carousel_outline: "carousel",
  blog_intro: "blog",
  blog: "blog",
  video_hook: "video_script",
  video_script: "video_script",
  image_artwork: "image_prompt",
  image_prompt: "image_prompt",
};

function normalizeList(values: unknown, fallback: string[], map: Record<string, string>) {
  const raw = Array.isArray(values) ? values : fallback;
  const normalized = raw
    .map((value) => map[String(value).trim().toLowerCase()] ?? String(value).trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 6);
}

function buildDraftPlan(platforms: string[], contentTypes: string[], count: number) {
  const plan: Array<{ platform: string; contentType: string }> = [];
  for (let i = 0; plan.length < count; i += 1) {
    const platform = platforms[i % platforms.length] ?? "instagram";
    const contentType = contentTypes[i % contentTypes.length] ?? "social_post";
    plan.push({
      platform,
      contentType,
    });
  }
  return plan;
}

function buildOccasionPrompt(
  context: string,
  occasion: MarketingOccasion,
  date: string,
  plan: Array<{ platform: string; contentType: string }>,
  brandDnaUsed: boolean,
) {
  const planText = plan
    .map((item, index) => `${index + 1}. platform=${item.platform}, contentType=${item.contentType}`)
    .join("\n");

  return `You are a senior Indian digital marketing strategist. Generate exactly ${plan.length} brand-fit draft${plan.length === 1 ? "" : "s"} for this marketing calendar occasion.

${context}

## Occasion
Title: ${occasion.title}
Date: ${date}
Category: ${occasion.category}
Observance type: ${occasion.observanceType}
Country: ${occasion.country ?? "GLOBAL"}
Region/state: ${occasion.region ?? "Not applicable"}
Yearly update note: ${occasion.requiresYearlyUpdate ? occasion.notes ?? "Verify date yearly." : "Fixed date."}
Brand DNA available: ${brandDnaUsed ? "yes" : "no"}

## Draft Plan
${planText}

## Rules
- Generate exactly one draft per Draft Plan item, no more.
- Match each draft's platform and contentType exactly.
- Keep it respectful, useful, and brand-safe.
- Include a caption, hashtags, imagePrompt, creativeDirection, and festiveAngle for every draft.
- Include a headline and subline for image/artwork drafts.
- Image prompts must describe a background only: no text, no logo, no typography.
- Do not schedule or publish anything.
- Do not claim this calendar is exhaustive.
- Use Brand DNA and AI Memory when available.

Respond with ONLY valid JSON:
{
  "drafts": [
    {
      "contentType": "social_post",
      "platform": "instagram",
      "topic": "specific topic",
      "caption": "ready-to-review caption",
      "imagePrompt": "detailed branded image prompt",
      "creativeDirection": "short visual direction",
      "festiveAngle": "specific occasion-led angle",
      "headline": "Happy Occasion",
      "subline": "short brand-relevant line",
      "hashtags": "#optional #hashtags"
    }
  ]
}`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readableColor(value: unknown, fallback: string) {
  const color = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
  return color;
}

async function dataUriFromUrl(url?: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function defaultOccasionCopy(title: string) {
  const sublines: Record<string, string> = {
    "Mother's Day": "Comfort is a mother's embrace.",
    Diwali: "Bright spaces, brighter celebrations.",
    Holi: "Add colour, comfort, and joy to every corner.",
  };
  return {
    headline: title.toLowerCase().startsWith("happy ") ? title : `Happy ${title}`,
    subline: sublines[title] ?? "Wishing you comfort, joy, and beautiful moments.",
  };
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

async function composeOccasionArtwork(params: {
  clientId: string;
  backgroundUrl: string;
  logoUrl?: string | null;
  brandName?: string | null;
  headline: string;
  subline: string;
  colors: string[];
}) {
  const backgroundDataUri = await dataUriFromUrl(params.backgroundUrl);
  if (!backgroundDataUri) throw new Error("Could not load background image for composition");
  const logoDataUri = await dataUriFromUrl(params.logoUrl);
  const primary = readableColor(params.colors[0], "#111827");
  const secondary = readableColor(params.colors[1], "#ffffff");
  const accent = readableColor(params.colors[2], "#f59e0b");
  const logoBlock = logoDataUri
    ? `<image href="${logoDataUri}" x="76" y="76" width="140" height="80" preserveAspectRatio="xMidYMid meet" />`
    : `<text x="76" y="122" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="${escapeXml(secondary)}">${escapeXml(params.brandName ?? "")}</text>`;
  const headlineLines = wrapText(params.headline, 22, 2);
  const sublineLines = wrapText(params.subline, 42, 3);
  const headlineSvg = headlineLines
    .map((line, index) => `<text x="120" y="${740 + index * 82}" font-family="Inter, Arial, sans-serif" font-size="76" font-weight="800" fill="${escapeXml(secondary)}">${escapeXml(line)}</text>`)
    .join("");
  const sublineStart = 780 + Math.max(0, headlineLines.length - 1) * 82;
  const sublineSvg = sublineLines
    .map((line, index) => `<text x="120" y="${sublineStart + index * 42}" font-family="Inter, Arial, sans-serif" font-size="34" fill="${escapeXml(secondary)}">${escapeXml(line)}</text>`)
    .join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <image href="${backgroundDataUri}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
  <rect width="1080" height="1080" fill="#000000" opacity="0.18"/>
  <rect x="42" y="42" width="996" height="996" rx="34" fill="none" stroke="${escapeXml(accent)}" stroke-width="12"/>
  <rect x="76" y="644" width="928" height="326" rx="30" fill="${escapeXml(primary)}" opacity="0.92"/>
  ${logoBlock}
  ${headlineSvg}
  ${sublineSvg}
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return uploadToSupabase(png, `generated/${params.clientId}/occasion-artwork-${Date.now()}.png`, "image/png");
}

async function generateAndAttachImages(params: {
  clientId: string;
  userId?: string;
  posts: Array<typeof postsTable.$inferSelect>;
  occasion: MarketingOccasion;
  packet: Awaited<ReturnType<typeof buildClientMemoryPacket>>;
}) {
  const warnings: string[] = [];
  let key: string;
  try {
    ({ key } = await resolveApiKey("openai", params.userId));
  } catch (err) {
    return { warnings: [`Image generation skipped: ${safeErrorMessage(err)}`] };
  }

  const openai = new OpenAI({ apiKey: key });
  const queue = params.posts.filter((post) => !!post.imagePrompt && (post.contentType === "image_prompt" || (post.generationMetadata as Record<string, unknown> | null)?.generateImagesNow === true));

  for (let i = 0; i < queue.length; i += 2) {
    const batch = queue.slice(i, i + 2);
    await Promise.all(batch.map(async (post) => {
      try {
        const schema = (post.contentSchema as Record<string, unknown>) ?? {};
        const backgroundPrompt = `${post.imagePrompt!}\n\nCreate a polished festive background image only. Do not include text, letters, words, logo, watermark, or typography. Leave comfortable empty space for app-rendered greeting text.`;
        const imgRes = await openai.images.generate({
          model: "dall-e-3",
          prompt: backgroundPrompt,
          n: 1,
          size: "1024x1024",
        });
        const providerUrl = imgRes.data?.[0]?.url;
        if (!providerUrl) throw new Error("DALL-E returned no image URL");
        const persisted = await persistRemoteImageUrl(providerUrl, params.clientId, "occasion-calendar");
        const defaults = defaultOccasionCopy(params.occasion.title);
        const headline = typeof schema.headline === "string" && schema.headline.trim() ? schema.headline.trim() : defaults.headline;
        const subline = typeof schema.subline === "string" && schema.subline.trim() ? schema.subline.trim() : defaults.subline;
        const colors = (params.packet.brandDna?.visualColors ?? []).filter((color): color is string => typeof color === "string" && color.length > 0);
        const finalArtworkUrl = await composeOccasionArtwork({
          clientId: params.clientId,
          backgroundUrl: persisted.durableUrl,
          logoUrl: params.packet.client?.logoUrl ?? null,
          brandName: params.packet.brandDna?.brandName ?? params.packet.client?.name ?? null,
          headline,
          subline,
          colors,
        });
        await db
          .update(postsTable)
          .set({
            selectedImageUrl: finalArtworkUrl,
            originalImageUrl: persisted.durableUrl,
            contentSchema: {
              ...(post.contentSchema as Record<string, unknown>),
              backgroundImageUrl: persisted.durableUrl,
              finalArtworkUrl,
              imageUrl: finalArtworkUrl,
              providerImageUrl: providerUrl,
              headline,
              subline,
              logoUsed: !!params.packet.client?.logoUrl,
              brandColorsUsed: colors,
              artworkStyle: "branded_occasion_square",
            },
            updatedAt: new Date(),
          })
          .where(eq(postsTable.id, post.id));
        await db.insert(imagesTable).values({
          clientId: params.clientId,
          postId: post.id,
          url: finalArtworkUrl,
          originalImageUrl: persisted.durableUrl,
          provider: "openai",
          status: "selected",
          type: "generated",
          prompt: post.imagePrompt,
          notes: "Branded Marketing Calendar occasion artwork",
        });
      } catch (err) {
        warnings.push(`Image failed for "${post.topic}": ${safeErrorMessage(err)}`);
      }
    }));
  }

  return { warnings };
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

    const count = Math.max(1, Math.min(Number(req.body?.count ?? 2), 5));
    const platforms = normalizeList(req.body?.platforms, ["instagram", "linkedin"], PLATFORM_MAP);
    const contentTypes = normalizeList(req.body?.contentTypes, ["social_post", "image_prompt"], CONTENT_TYPE_MAP);
    const generateImagesNow = req.body?.generateImagesNow === true;
    const campaignId = typeof req.body?.campaignId === "string" ? req.body.campaignId : null;
    const storylineId = typeof req.body?.storylineId === "string" ? req.body.storylineId : null;
    const year = Number(req.body?.year) || new Date().getFullYear();
    const date = occasionDate(occasion, year);
    const plan = buildDraftPlan(platforms, contentTypes, count);

    try {
      const packet = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const settings = await getUserSettings(req.userId);
      const { provider, model } = await resolveProviderAndModel(settings, req.userId);
      const prompt = buildOccasionPrompt(context, occasion, date, plan, !!packet.brandDna);
      const raw = await generateTextWithProvider(provider, model, prompt, 3200, req.userId);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI returned no JSON");

      const parsed = JSON.parse(jsonMatch[0]) as OccasionDraftResponse;
      const drafts = (Array.isArray(parsed.drafts) ? parsed.drafts : []).slice(0, plan.length);
      if (!drafts.length) throw new Error("AI returned no drafts");

      const generationMetadata = {
        route: "occasion_calendar.generate",
        provider,
        model,
        occasionId: occasion.id,
        occasionTitle: occasion.title,
        occasionDate: date,
        platforms,
        contentTypes,
        generateImagesNow,
      };

      const inserts = drafts.map((draft, index) => {
        const planned = plan[index] ?? plan[0];
        const contentType = CONTENT_TYPE_MAP[String(draft.contentType ?? "").toLowerCase()] ?? planned.contentType;
        const platform = PLATFORM_MAP[String(draft.platform ?? "").toLowerCase()] ?? planned.platform;
        const creativeDirection = draft.creativeDirection ?? draft.artworkDirection ?? draft.imagePrompt ?? "";
        const defaults = defaultOccasionCopy(occasion.title);
        return ({
        clientId,
        campaignId,
        storylineId,
        contentType,
        contentSchema: {
          occasionId: occasion.id,
          occasionTitle: occasion.title,
          occasionDate: date,
          observanceType: occasion.observanceType,
          platform,
          caption: draft.caption ?? "",
          hashtags: draft.hashtags ?? "",
          imagePrompt: draft.imagePrompt ?? creativeDirection,
          creativeDirection,
          festiveAngle: draft.festiveAngle ?? `${occasion.title} brand moment`,
          headline: draft.headline ?? defaults.headline,
          subline: draft.subline ?? defaults.subline,
          brandDnaUsed: !!packet.brandDna,
          logoUsed: false,
          brandColorsUsed: packet.brandDna?.visualColors ?? [],
          artworkStyle: contentType === "image_prompt" ? "branded_occasion_square" : "draft_prompt",
        },
        contentSchemaVersion: 1,
        topic: draft.topic || `${occasion.title} content idea`,
        caption: draft.caption ?? "",
        hashtags: draft.hashtags ?? "",
        platform,
        postType: contentType === "blog" ? "blog" as const : "social" as const,
        status: "draft" as const,
        generationStatus: "ready" as const,
        imagePrompt: (draft.imagePrompt ?? creativeDirection) || null,
        generationMetadata,
        });
      });

      const createdDrafts = await db.insert(postsTable).values(inserts).returning();
      const needsArtwork = generateImagesNow || contentTypes.includes("image_prompt");
      const imageResult = needsArtwork
        ? await generateAndAttachImages({ clientId, userId: req.userId, posts: createdDrafts, occasion, packet })
        : { warnings: [] };
      logger.info({ clientId, occasionId, count: createdDrafts.length }, "Occasion Calendar: drafts created");

      const responseDrafts = await db
        .select()
        .from(postsTable)
        .where(inArray(postsTable.id, createdDrafts.map((post) => post.id)));

      res.json({
        occasion: { ...occasion, date },
        createdDrafts: responseDrafts,
        warnings: imageResult.warnings,
      });
    } catch (err) {
      logger.error({ err: safeErrorMessage(err), clientId, occasionId }, "Occasion Calendar generation failed");
      const aiError = toAiErrorResponse(err, "Failed to generate occasion drafts");
      res.status(aiError.status).json({ error: aiError.message });
    }
  }
);

export default router;
