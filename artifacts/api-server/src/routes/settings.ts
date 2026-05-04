import { Router } from "express";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

// GET /settings
router.get("/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const [existing] = await db
      .select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);

    if (existing) { res.json(existing); return; }

    const [created] = await db
      .insert(userSettingsTable)
      .values({ userId })
      .returning();
    res.json(created);
  } catch {
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// PUT /settings
router.put("/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const { aiProvider, aiModel, imageProvider, imageModel } = req.body as {
      aiProvider?: string;
      aiModel?: string;
      imageProvider?: string;
      imageModel?: string;
    };

    const [existing] = await db
      .select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(userSettingsTable)
        .set({ aiProvider, aiModel, imageProvider, imageModel, updatedAt: new Date() })
        .where(eq(userSettingsTable.userId, userId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(userSettingsTable)
        .values({ userId, aiProvider: aiProvider ?? "anthropic", aiModel: aiModel ?? "claude-opus-4-5", imageProvider: imageProvider ?? "openai", imageModel: imageModel ?? "dall-e-3" })
        .returning();
      res.json(created);
    }
  } catch {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
