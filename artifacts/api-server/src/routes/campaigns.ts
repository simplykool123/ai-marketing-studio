import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable, postsTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";

const router = Router();

// GET /clients/:clientId/campaigns
router.get("/clients/:clientId/campaigns", async (req, res): Promise<void> => {
  try {
    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.clientId, req.params.clientId))
      .orderBy(campaignsTable.createdAt);
    res.json(campaigns);
  } catch {
    res.status(500).json({ error: "Failed to list campaigns" });
  }
});

// POST /clients/:clientId/campaigns
router.post("/clients/:clientId/campaigns", async (req, res): Promise<void> => {
  try {
    const { name, goal, description, startDate, endDate, platforms, status } = req.body as {
      name: string;
      goal?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      platforms?: string;
      status?: string;
    };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [campaign] = await db
      .insert(campaignsTable)
      .values({
        clientId: req.params.clientId,
        name,
        goal,
        description,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        platforms,
        status: status ?? "draft",
      })
      .returning();
    res.status(201).json(campaign);
  } catch {
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// GET /clients/:clientId/campaigns/:campaignId
router.get("/clients/:clientId/campaigns/:campaignId", async (req, res): Promise<void> => {
  try {
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(and(
        eq(campaignsTable.id, req.params.campaignId),
        eq(campaignsTable.clientId, req.params.clientId)
      ))
      .limit(1);
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const posts = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.campaignId, req.params.campaignId));

    res.json({ ...campaign, posts });
  } catch {
    res.status(500).json({ error: "Failed to get campaign" });
  }
});

// PATCH /clients/:clientId/campaigns/:campaignId
router.patch("/clients/:clientId/campaigns/:campaignId", async (req, res): Promise<void> => {
  try {
    const { name, goal, description, startDate, endDate, platforms, status } = req.body as {
      name?: string;
      goal?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      platforms?: string;
      status?: string;
    };
    const [updated] = await db
      .update(campaignsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(goal !== undefined && { goal }),
        ...(description !== undefined && { description }),
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: new Date(endDate) }),
        ...(platforms !== undefined && { platforms }),
        ...(status !== undefined && { status }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(campaignsTable.id, req.params.campaignId),
        eq(campaignsTable.clientId, req.params.clientId)
      ))
      .returning();
    if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

// DELETE /clients/:clientId/campaigns/:campaignId
router.delete("/clients/:clientId/campaigns/:campaignId", async (req, res): Promise<void> => {
  try {
    await db
      .delete(campaignsTable)
      .where(and(
        eq(campaignsTable.id, req.params.campaignId),
        eq(campaignsTable.clientId, req.params.clientId)
      ));
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

export default router;
