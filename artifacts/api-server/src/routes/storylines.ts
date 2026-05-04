import { Router } from "express";
import { db } from "@workspace/db";
import { storylinesTable } from "@workspace/db/schema";
import { eq, and, ne } from "drizzle-orm";
import {
  CreateStorylineBody,
  UpdateStorylineBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/clients/:clientId/storylines", async (req, res) => {
  try {
    const storylines = await db
      .select()
      .from(storylinesTable)
      .where(eq(storylinesTable.clientId, req.params.clientId))
      .orderBy(storylinesTable.createdAt);
    res.json(storylines);
  } catch (err) {
    res.status(500).json({ error: "Failed to list storylines" });
  }
});

router.post("/clients/:clientId/storylines", async (req, res) => {
  try {
    const body = CreateStorylineBody.parse(req.body);

    // If new storyline is active, deactivate all existing storylines for this client
    if (body.isActive) {
      await db
        .update(storylinesTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(storylinesTable.clientId, req.params.clientId));
    }

    const [storyline] = await db
      .insert(storylinesTable)
      .values({ clientId: req.params.clientId, ...body })
      .returning();
    res.status(201).json(storyline);
  } catch (err) {
    res.status(400).json({ error: "Failed to create storyline" });
  }
});

router.patch("/clients/:clientId/storylines/:storylineId", async (req, res) => {
  try {
    const body = UpdateStorylineBody.parse(req.body);

    // If activating this storyline, deactivate all OTHER storylines for this client
    if (body.isActive) {
      await db
        .update(storylinesTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(storylinesTable.clientId, req.params.clientId),
            ne(storylinesTable.id, req.params.storylineId)
          )
        );
    }

    const [storyline] = await db
      .update(storylinesTable)
      .set({ ...body, updatedAt: new Date() })
      .where(
        and(
          eq(storylinesTable.id, req.params.storylineId),
          eq(storylinesTable.clientId, req.params.clientId)
        )
      )
      .returning();
    res.json(storyline);
  } catch (err) {
    res.status(400).json({ error: "Failed to update storyline" });
  }
});

router.delete("/clients/:clientId/storylines/:storylineId", async (req, res) => {
  try {
    await db
      .delete(storylinesTable)
      .where(
        and(
          eq(storylinesTable.id, req.params.storylineId),
          eq(storylinesTable.clientId, req.params.clientId)
        )
      );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete storyline" });
  }
});

export default router;
