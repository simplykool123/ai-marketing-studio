import { Router, type Request } from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { db } from "@workspace/db";
import { clientsTable, brandAssetsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  EDIT_CONTENT_ROLES,
  MANAGE_CLIENT_ROLES,
  requireClientRole,
} from "../middleware/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BUCKET = "post-images";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

class SafeUploadError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = "UPLOAD_FAILED",
  ) {
    super(message);
  }
}

let bucketReadyPromise: Promise<void> | null = null;

export async function ensureStorageBucket(): Promise<void> {
  bucketReadyPromise ??= ensureStorageBucketOnce().catch((err) => {
    bucketReadyPromise = null;
    throw err;
  });
  return bucketReadyPromise;
}

async function ensureStorageBucketOnce(): Promise<void> {
  const { data: bucket, error: getError } = await supabase.storage.getBucket(BUCKET);

  if (getError) {
    const isMissing = getError.message.toLowerCase().includes("not found");
    if (!isMissing) {
      throw new SafeUploadError(`Storage bucket check failed: ${getError.message}`, 500, "STORAGE_BUCKET_CHECK_FAILED");
    }

    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE_BYTES,
      allowedMimeTypes: ["image/*", "application/pdf"],
    });

    if (createError) {
      throw new SafeUploadError(
        `Storage bucket "${BUCKET}" is missing and could not be created: ${createError.message}`,
        500,
        "STORAGE_BUCKET_CREATE_FAILED",
      );
    }
    return;
  }

  if (!bucket.public) {
    const { error: updateError } = await supabase.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: bucket.file_size_limit ?? MAX_FILE_SIZE_BYTES,
      allowedMimeTypes: bucket.allowed_mime_types ?? ["image/*", "application/pdf"],
    });

    if (updateError) {
      throw new SafeUploadError(
        `Storage bucket "${BUCKET}" exists but could not be made public: ${updateError.message}`,
        500,
        "STORAGE_BUCKET_UPDATE_FAILED",
      );
    }
  }
}

export async function uploadToSupabase(
  buffer: Buffer,
  path: string,
  contentType: string
): Promise<string> {
  await ensureStorageBucket();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (error) throw new SafeUploadError(`Supabase upload failed: ${error.message}`, 500, "SUPABASE_UPLOAD_FAILED");

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function toSafeUploadError(err: unknown, fallback: string): { statusCode: number; code: string; message: string } {
  if (err instanceof SafeUploadError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message };
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large. Maximum upload size is 10 MB." : err.message;
    return { statusCode: 400, code: err.code, message };
  }
  if (err instanceof Error && err.message) {
    return { statusCode: 500, code: "UPLOAD_FAILED", message: err.message };
  }
  return { statusCode: 500, code: "UPLOAD_FAILED", message: fallback };
}

// POST /clients/:clientId/upload/logo
router.post(
  "/clients/:clientId/upload/logo",
  requireClientRole(MANAGE_CLIENT_ROLES),
  upload.single("file"),
  async (req: Request<{ clientId: string }>, res): Promise<void> => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

      const ext = req.file.originalname.split(".").pop() ?? "png";
      const path = `logos/${req.params.clientId}-${Date.now()}.${ext}`;
      const url = await uploadToSupabase(req.file.buffer, path, req.file.mimetype);

      await db
        .update(clientsTable)
        .set({ logoUrl: url, updatedAt: new Date() })
        .where(eq(clientsTable.id, req.params.clientId as string));

      res.json({ url });
    } catch (err) {
      const safeError = toSafeUploadError(err, "Failed to upload logo");
      console.error("Logo upload error:", safeError, err);
      res.status(safeError.statusCode).json({ error: safeError.message, code: safeError.code });
    }
  }
);

// POST /clients/:clientId/upload/asset
router.post(
  "/clients/:clientId/upload/asset",
  requireClientRole(EDIT_CONTENT_ROLES),
  upload.single("file"),
  async (req: Request<{ clientId: string }>, res): Promise<void> => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

      const assetType = (req.body.assetType as string) || "reference_image";
      const notes = (req.body.notes as string) || null;

      const ext = req.file.originalname.split(".").pop() ?? "png";
      const path = `assets/${req.params.clientId}/${assetType}-${Date.now()}.${ext}`;
      const url = await uploadToSupabase(req.file.buffer, path, req.file.mimetype);

      const [asset] = await db
        .insert(brandAssetsTable)
        .values({
          clientId: req.params.clientId as string,
          assetType,
          fileUrl: url,
          notes,
        })
        .returning();

      res.status(201).json(asset);
    } catch (err) {
      const safeError = toSafeUploadError(err, "Failed to upload asset");
      console.error("Asset upload error:", safeError, err);
      res.status(safeError.statusCode).json({ error: safeError.message, code: safeError.code });
    }
  }
);

// POST /clients/:clientId/posts/upload-image
router.post(
  "/clients/:clientId/posts/upload-image",
  requireClientRole(EDIT_CONTENT_ROLES),
  upload.single("file"),
  async (req: Request<{ clientId: string }>, res): Promise<void> => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

      const ext = req.file.originalname.split(".").pop() ?? "jpg";
      const path = `post-uploads/${req.params.clientId}/${Date.now()}.${ext}`;
      const url = await uploadToSupabase(req.file.buffer, path, req.file.mimetype);

      res.json({ url });
    } catch (err) {
      const safeError = toSafeUploadError(err, "Failed to upload post image");
      console.error("Post image upload error:", safeError, err);
      res.status(safeError.statusCode).json({ error: safeError.message, code: safeError.code });
    }
  }
);

export default router;
