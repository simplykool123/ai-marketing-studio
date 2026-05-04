import { Router } from "express";
import { db } from "@workspace/db";
import { brandDnaTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { UpsertBrandDnaBody } from "@workspace/api-zod";

const router = Router();

router.get("/clients/:clientId/brand-dna", async (req, res): Promise<void> => {
  try {
    const [dna] = await db
      .select()
      .from(brandDnaTable)
      .where(eq(brandDnaTable.clientId, req.params.clientId))
      .limit(1);
    if (!dna) { res.json(null); return; }
    res.json(dna);
  } catch (err) {
    res.status(500).json({ error: "Failed to get brand DNA" });
  }
});

router.put("/clients/:clientId/brand-dna", async (req, res): Promise<void> => {
  try {
    const body = UpsertBrandDnaBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(brandDnaTable)
      .where(eq(brandDnaTable.clientId, req.params.clientId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(brandDnaTable)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(brandDnaTable.clientId, req.params.clientId))
        .returning();
      res.json(updated); return;
    }

    const [created] = await db
      .insert(brandDnaTable)
      .values({ clientId: req.params.clientId, ...body })
      .returning();
    res.status(200).json(created);
  } catch (err) {
    res.status(400).json({ error: "Failed to upsert brand DNA" });
  }
});

export default router;
