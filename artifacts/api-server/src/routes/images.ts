import { Router } from "express";
import { db } from "@workspace/db";
import { imagesTable, postsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { SaveImageBody } from "@workspace/api-zod";

const router = Router();

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

router.post("/clients/:clientId/posts/:postId/images", async (req, res): Promise<void> => {
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

router.patch("/clients/:clientId/images/:imageId", async (req, res): Promise<void> => {
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

router.delete("/clients/:clientId/images/:imageId", async (req, res): Promise<void> => {
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
