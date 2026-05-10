import { Router } from "express";
import sharp from "sharp";
import { db } from "@workspace/db";
import { clientsTable, imagesTable, postsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { SaveImageBody } from "@workspace/api-zod";
import { supabase } from "../lib/supabase.js";
import { EDIT_CONTENT_ROLES, requireClientRole } from "../middleware/auth.js";
import { ensureStorageBucket } from "./upload.js";

const router = Router();
const BUCKET = "post-images";

type LogoPlacement = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
type LogoSize = "small" | "medium" | "large" | "custom";
type LogoBackground = "none" | "white-pill" | "dark-pill" | "transparent";

const LOGO_SIZE_PERCENT: Record<Exclude<LogoSize, "custom">, number> = {
  small: 14,
  medium: 22,
  large: 32,
};

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch image: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseBrandImageBody(body: unknown): {
  imageUrl: string;
  includeLogo: boolean;
  placement: LogoPlacement;
  size: LogoSize;
  customSizePercent?: number;
  marginPercent: number;
  background: LogoBackground;
} {
  const raw = (body ?? {}) as Record<string, unknown>;
  const imageUrl = typeof raw.imageUrl === "string" ? raw.imageUrl.trim() : "";
  if (!imageUrl) throw new Error("imageUrl is required");

  const placementValues: LogoPlacement[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
  const sizeValues: LogoSize[] = ["small", "medium", "large", "custom"];
  const backgroundValues: LogoBackground[] = ["none", "white-pill", "dark-pill", "transparent"];
  const placement = placementValues.includes(raw.placement as LogoPlacement) ? raw.placement as LogoPlacement : "bottom-right";
  const size = sizeValues.includes(raw.size as LogoSize) ? raw.size as LogoSize : "medium";
  const background = backgroundValues.includes(raw.background as LogoBackground) ? raw.background as LogoBackground : "none";
  const customSizePercent = typeof raw.customSizePercent === "number" ? clamp(raw.customSizePercent, 5, 45) : undefined;
  const marginPercent = typeof raw.marginPercent === "number" ? clamp(raw.marginPercent, 0, 20) : 4;

  return {
    imageUrl,
    includeLogo: raw.includeLogo !== false,
    placement,
    size,
    customSizePercent,
    marginPercent,
    background,
  };
}

function getLogoPosition(
  placement: LogoPlacement,
  baseWidth: number,
  baseHeight: number,
  overlayWidth: number,
  overlayHeight: number,
  margin: number,
): { left: number; top: number } {
  switch (placement) {
    case "top-left":
      return { left: margin, top: margin };
    case "top-right":
      return { left: baseWidth - overlayWidth - margin, top: margin };
    case "bottom-left":
      return { left: margin, top: baseHeight - overlayHeight - margin };
    case "center":
      return { left: Math.round((baseWidth - overlayWidth) / 2), top: Math.round((baseHeight - overlayHeight) / 2) };
    case "bottom-right":
    default:
      return { left: baseWidth - overlayWidth - margin, top: baseHeight - overlayHeight - margin };
  }
}

async function buildLogoOverlay(
  logoBuffer: Buffer,
  targetWidth: number,
  background: LogoBackground,
): Promise<{ input: Buffer; width: number; height: number }> {
  const resizedLogo = await sharp(logoBuffer)
    .rotate()
    .resize({ width: targetWidth, withoutEnlargement: true })
    .png()
    .toBuffer();
  const logoMeta = await sharp(resizedLogo).metadata();
  const logoWidth = logoMeta.width ?? targetWidth;
  const logoHeight = logoMeta.height ?? targetWidth;

  if (background === "none") {
    return { input: resizedLogo, width: logoWidth, height: logoHeight };
  }

  const padding = background === "transparent" ? Math.round(targetWidth * 0.12) : Math.round(targetWidth * 0.16);
  const width = logoWidth + padding * 2;
  const height = logoHeight + padding * 2;
  const fill = background === "dark-pill" ? "rgba(17, 24, 39, 0.88)" : background === "white-pill" ? "rgba(255, 255, 255, 0.92)" : "rgba(255, 255, 255, 0)";
  const radius = Math.round(height / 2);
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/></svg>`,
  );
  const input = await sharp(svg)
    .composite([{ input: resizedLogo, left: padding, top: padding }])
    .png()
    .toBuffer();

  return { input, width, height };
}

async function uploadBrandedImage(buffer: Buffer, clientId: string): Promise<string> {
  await ensureStorageBucket();
  const path = `branded/${clientId}/${Date.now()}.png`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "image/png", upsert: true });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

router.get("/clients/:clientId/posts/:postId/images", async (req, res) => {
  try {
    const images = await db
      .select()
      .from(imagesTable)
      .where(
        and(
          eq(imagesTable.clientId, req.params.clientId),
          eq(imagesTable.postId, req.params.postId)
        )
      )
      .orderBy(imagesTable.createdAt);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: "Failed to list images" });
  }
});

router.post("/clients/:clientId/posts/:postId/images", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const body = SaveImageBody.parse(req.body);

    const [post] = await db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }

    const [image] = await db
      .insert(imagesTable)
      .values({
        clientId: req.params.clientId,
        postId: req.params.postId,
        ...body,
      })
      .returning();
    res.status(201).json(image);
  } catch (err) {
    res.status(400).json({ error: "Failed to save image" });
  }
});

router.get("/clients/:clientId/images", async (req, res) => {
  try {
    const images = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.clientId, req.params.clientId))
      .orderBy(imagesTable.createdAt);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: "Failed to list client images" });
  }
});

router.post("/clients/:clientId/images/brand", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const body = parseBrandImageBody(req.body);
    const [client] = await db
      .select({ logoUrl: clientsTable.logoUrl })
      .from(clientsTable)
      .where(eq(clientsTable.id, req.params.clientId))
      .limit(1);

    if (body.includeLogo && !client?.logoUrl) {
      res.status(400).json({ error: "Upload logo in Brand Setup" });
      return;
    }

    if (!body.includeLogo) {
      res.json({
        selectedImageUrl: body.imageUrl,
        originalImageUrl: body.imageUrl,
        brandedImageUrl: null,
      });
      return;
    }

    const [baseBuffer, logoBuffer] = await Promise.all([
      fetchImageBuffer(body.imageUrl),
      fetchImageBuffer(client.logoUrl!),
    ]);
    const normalizedBase = await sharp(baseBuffer).rotate().png().toBuffer();
    const metadata = await sharp(normalizedBase).metadata();
    const baseWidth = metadata.width ?? 1024;
    const baseHeight = metadata.height ?? 1024;
    const sizePercent = body.size === "custom" ? body.customSizePercent ?? LOGO_SIZE_PERCENT.medium : LOGO_SIZE_PERCENT[body.size];
    const logoTargetWidth = Math.round(baseWidth * (sizePercent / 100));
    const margin = Math.round(Math.min(baseWidth, baseHeight) * (body.marginPercent / 100));
    const overlay = await buildLogoOverlay(logoBuffer, logoTargetWidth, body.background);
    const position = getLogoPosition(body.placement, baseWidth, baseHeight, overlay.width, overlay.height, margin);

    const brandedBuffer = await sharp(normalizedBase)
      .composite([{ input: overlay.input, left: position.left, top: position.top }])
      .png()
      .toBuffer();
    const brandedImageUrl = await uploadBrandedImage(brandedBuffer, req.params.clientId);

    res.json({
      selectedImageUrl: brandedImageUrl,
      originalImageUrl: body.imageUrl,
      brandedImageUrl,
    });
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "Failed to create branded image";
    res.status(400).json({ error: message });
  }
});

router.patch("/clients/:clientId/images/:imageId", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { status, prompt, type, notes } = req.body as {
      status?: string;
      prompt?: string;
      type?: string;
      notes?: string;
    };
    const validStatuses = ["selected", "rejected", "pending"];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status" }); return;
    }
    const validTypes = ["generated", "uploaded", "logo", "thumbnail", "blog"];
    if (type && !validTypes.includes(type)) {
      res.status(400).json({ error: "Invalid type" }); return;
    }
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (prompt !== undefined) updates.prompt = prompt;
    if (type) updates.type = type;
    if (notes !== undefined) updates.notes = notes;
    const [image] = await db
      .update(imagesTable)
      .set(updates)
      .where(
        and(
          eq(imagesTable.id, req.params.imageId),
          eq(imagesTable.clientId, req.params.clientId)
        )
      )
      .returning();
    if (!image) { res.status(404).json({ error: "Not found" }); return; }
    res.json(image);
  } catch (err) {
    res.status(400).json({ error: "Failed to update image" });
  }
});

router.delete("/clients/:clientId/images/:imageId", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    await db
      .delete(imagesTable)
      .where(
        and(
          eq(imagesTable.id, req.params.imageId),
          eq(imagesTable.clientId, req.params.clientId)
        )
      );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete image" });
  }
});

export default router;
