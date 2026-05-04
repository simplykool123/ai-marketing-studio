import { Router } from "express";
import { db } from "@workspace/db";
import { contentMemoryTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AddMemoryBody } from "@workspace/api-zod";

const router = Router();

router.get("/clients/:clientId/memory", async (req, res) => {
  try {
    const entries = await db
      .select()
      .from(contentMemoryTable)
      .where(eq(contentMemoryTable.clientId, req.params.clientId))
      .orderBy(contentMemoryTable.createdAt);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: "Failed to list memory" });
  }
});

router.post("/clients/:clientId/memory", async (req, res) => {
  try {
    const body = AddMemoryBody.parse(req.body);
    const [entry] = await db
      .insert(contentMemoryTable)
      .values({ clientId: req.params.clientId, ...body })
      .returning();
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: "Failed to add memory" });
  }
});

router.delete("/clients/:clientId/memory/:memoryId", async (req, res) => {
  try {
    await db
      .delete(contentMemoryTable)
      .where(
        and(
          eq(contentMemoryTable.id, req.params.memoryId),
          eq(contentMemoryTable.clientId, req.params.clientId)
        )
      );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete memory entry" });
  }
});

export default router;
