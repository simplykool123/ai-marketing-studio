import { Router, type Request } from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { db } from "@workspace/db";
import { clientsTable, brandAssetsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BUCKET = "post-images";

async function uploadToSupabase(
  buffer: Buffer,
  path: string,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// POST /clients/:clientId/upload/logo
router.post(
  "/clients/:clientId/upload/logo",
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
      console.error("Logo upload error:", err);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  }
);

// POST /clients/:clientId/upload/asset
router.post(
  "/clients/:clientId/upload/asset",
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
      console.error("Asset upload error:", err);
      res.status(500).json({ error: "Failed to upload asset" });
    }
  }
);

// POST /clients/:clientId/posts/upload-image
router.post(
  "/clients/:clientId/posts/upload-image",
  upload.single("file"),
  async (req: Request<{ clientId: string }>, res): Promise<void> => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

      const ext = req.file.originalname.split(".").pop() ?? "jpg";
      const path = `post-uploads/${req.params.clientId}/${Date.now()}.${ext}`;
      const url = await uploadToSupabase(req.file.buffer, path, req.file.mimetype);

      res.json({ url });
    } catch (err) {
      console.error("Post image upload error:", err);
      res.status(500).json({ error: "Failed to upload post image" });
    }
  }
);

export default router;
