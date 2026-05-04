import { Router } from "express";
import { db } from "@workspace/db";
import { brandAssetsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

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

router.delete("/clients/:clientId/brand-assets/:assetId", async (req, res): Promise<void> => {
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
