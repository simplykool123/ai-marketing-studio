import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { brandAssetsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { EDIT_CONTENT_ROLES, requireClientRole } from "../middleware/auth.js";
import { uploadToSupabase } from "./upload.js";

const router = Router();
const MAX_REMOTE_ASSET_BYTES = 10 * 1024 * 1024;
const IMAGE_FETCH_HEADERS = {
  "user-agent": "AI Marketing Studio Brand Importer/2.0",
  "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};
const ASSET_TYPES = new Set(["logo", "reference_image", "product_image", "hero_image"]);

function isSafePublicUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return ["http:", "https:"].includes(url.protocol) && !(
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function parseSafePublicUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw Object.assign(new Error("url is required"), { statusCode: 400 });
  const url = new URL(raw);
  if (!isSafePublicUrl(url)) throw Object.assign(new Error("Only public http and https image URLs are supported."), { statusCode: 400 });
  return url;
}

function extensionFor(contentType: string, sourceUrl: URL): string {
  if (contentType.includes("svg")) return "svg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  const ext = sourceUrl.pathname.split(".").pop()?.toLowerCase();
  return ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg";
}

async function downloadRemoteImage(rawUrl: unknown): Promise<{ buffer: Buffer; contentType: string; sourceUrl: URL }> {
  const sourceUrl = parseSafePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    signal: controller.signal,
    headers: IMAGE_FETCH_HEADERS,
  }).finally(() => clearTimeout(timeout));
  const finalUrl = new URL(response.url || sourceUrl.toString());
  if (!isSafePublicUrl(finalUrl)) {
    throw Object.assign(new Error("Image redirected to a private or local URL."), { statusCode: 400 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Image could not be downloaded (HTTP ${response.status}).`), { statusCode: 502 });
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    throw Object.assign(new Error("URL did not return an image."), { statusCode: 415 });
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REMOTE_ASSET_BYTES) {
    throw Object.assign(new Error("Image is too large to import. Maximum size is 10 MB."), { statusCode: 413 });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_ASSET_BYTES) {
    throw Object.assign(new Error("Image is too large to import. Maximum size is 10 MB."), { statusCode: 413 });
  }
  return { buffer, contentType, sourceUrl: finalUrl };
}

router.get("/clients/:clientId/brand-assets", async (req, res): Promise<void> => {
  try {
    const assets = await db
      .select()
      .from(brandAssetsTable)
      .where(eq(brandAssetsTable.clientId, req.params.clientId))
      .orderBy(brandAssetsTable.createdAt);
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: "Failed to list brand assets" });
  }
});

router.post("/clients/:clientId/brand-assets/import-url", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const body = req.body as {
      url?: string;
      assetType?: string;
      notes?: string;
      source?: string;
    };
    const assetType = ASSET_TYPES.has(body.assetType ?? "") ? body.assetType! : "reference_image";
    const downloaded = await downloadRemoteImage(body.url);
    const ext = extensionFor(downloaded.contentType, downloaded.sourceUrl);
    const path = `assets/${req.params.clientId}/${assetType}-${Date.now()}-${randomUUID()}.${ext}`;
    const fileUrl = await uploadToSupabase(downloaded.buffer, path, downloaded.contentType);
    const notes = [
      body.notes?.trim(),
      body.source === "brand_importer" ? `Imported from Brand Importer: ${downloaded.sourceUrl.toString()}` : `Imported from URL: ${downloaded.sourceUrl.toString()}`,
    ].filter(Boolean).join("\n").slice(0, 1800);

    const [asset] = await db
      .insert(brandAssetsTable)
      .values({
        clientId: req.params.clientId,
        assetType,
        fileUrl,
        notes,
      })
      .returning();

    res.status(201).json(asset);
  } catch (err) {
    const statusCode = typeof (err as { statusCode?: unknown }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 500;
    const message = err instanceof Error ? err.message : "Failed to import brand asset";
    res.status(statusCode).json({ error: message });
  }
});

router.delete("/clients/:clientId/brand-assets/:assetId", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    await db
      .delete(brandAssetsTable)
      .where(
        and(
          eq(brandAssetsTable.id, req.params.assetId),
          eq(brandAssetsTable.clientId, req.params.clientId)
        )
      );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete brand asset" });
  }
});

export default router;
