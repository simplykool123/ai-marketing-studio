import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable, postsTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
import { buildClientMemoryPacket } from "../lib/client-memory-packet.js";
import { safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";
import { SkillEngineError } from "../lib/skill-engine.js";
import { logger } from "../lib/logger.js";
import { executeSkillToReviewDraft } from "./skills.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function cleanPlatforms(value: unknown): string[] {
  let result: string[];
  if (Array.isArray(value)) {
    result = value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6);
  } else if (typeof value === "string") {
    result = value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6);
  } else {
    result = ["instagram", "facebook", "linkedin"];
  }
  return result.length ? result : ["instagram", "facebook", "linkedin"];
}

function startDateFrom(value: unknown): Date {
  const parsed = typeof value === "string" && value.trim() ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const now = new Date();
  if (date < now && date.toDateString() !== now.toDateString()) date.setDate(now.getDate());
  date.setHours(9, 0, 0, 0);
  return date;
}

function suggestedDate(startDate: Date, index: number): Date {
  const offsets = [0, 1, 2, 4, 5, 6];
  const date = new Date(startDate);
  date.setDate(startDate.getDate() + (offsets[index] ?? index));
  date.setHours(9, 0, 0, 0);
  return date;
}

function clampPostCount(value: unknown): number {
  const count = Number(value ?? 3);
  if (!Number.isFinite(count)) return 3;
  return Math.min(5, Math.max(1, Math.round(count)));
}

function itemInput({
  topic,
  goal,
  platform,
  itemLabel,
  sequence,
}: {
  topic: string;
  goal: string;
  platform: string;
  itemLabel: string;
  sequence: number;
}) {
  return {
    topic,
    goal,
    platform,
    source: "mini_campaign",
    notes: `${itemLabel}. Campaign sequence item ${sequence}. Make this distinct from other campaign drafts while staying on the same campaign angle.`,
  };
}

function userFacingSkillError(err: unknown): string {
  if (err instanceof SkillEngineError) return err.message;
  if (err instanceof Error && (err.message.includes("No AI provider API keys configured") || err.message.includes("No API key configured"))) {
    return "No AI provider key configured. Add one in Settings → AI Keys.";
  }
  return toAiErrorResponse(err, "Could not generate this campaign item.").message;
}

type MiniCampaignItem = {
  label: string;
  skillId: string;
  input: Record<string, unknown>;
  scheduledAt: Date;
};

type MiniCampaignDraftSummary = {
  id: string;
  label: string;
  skillId: string;
  topic: string;
  platform: string | null;
  contentType: string;
  scheduledAt: string | null;
  qualityBadge?: string;
};

function buildMiniCampaignItems({
  topic,
  goal,
  platforms,
  startDate,
  postCount,
}: {
  topic: string;
  goal: string;
  platforms: string[];
  startDate: Date;
  postCount: number;
}): MiniCampaignItem[] {
  const items: MiniCampaignItem[] = [];
  for (let index = 0; index < postCount; index++) {
    const platform = platforms[index % platforms.length] ?? "instagram";
    items.push({
      label: `Social Post ${index + 1}`,
      skillId: "social_post_creator",
      input: itemInput({ topic, goal, platform, itemLabel: `Social Post ${index + 1}`, sequence: index + 1 }),
      scheduledAt: suggestedDate(startDate, index),
    });
  }

  items.push(
    {
      label: "Carousel",
      skillId: "instagram_carousel_builder",
      input: itemInput({ topic, goal, platform: "instagram", itemLabel: "Instagram Carousel", sequence: postCount + 1 }),
      scheduledAt: suggestedDate(startDate, postCount),
    },
    {
      label: "Reel Script",
      skillId: "short_video_reel_script",
      input: itemInput({ topic, goal, platform: "instagram_reels", itemLabel: "Reel Script", sequence: postCount + 2 }),
      scheduledAt: suggestedDate(startDate, postCount + 1),
    },
    {
      label: "Blog Draft",
      skillId: "seo_blog_writer",
      input: itemInput({ topic, goal, platform: "blog", itemLabel: "Blog Draft", sequence: postCount + 3 }),
      scheduledAt: suggestedDate(startDate, postCount + 2),
    },
  );

  return items;
}

async function runMiniCampaignItems({
  clientId,
  userId,
  campaign,
  items,
  skipExistingLabels = false,
}: {
  clientId: string;
  userId?: string;
  campaign: { id: string; name: string };
  items: MiniCampaignItem[];
  skipExistingLabels?: boolean;
}): Promise<{
  createdDrafts: MiniCampaignDraftSummary[];
  failures: Array<{ label: string; skillId: string; error: string }>;
  skipped: string[];
}> {
  const createdDrafts: MiniCampaignDraftSummary[] = [];
  const failures: Array<{ label: string; skillId: string; error: string }> = [];
  const skipped: string[] = [];
  let existingLabels = new Set<string>();

  if (skipExistingLabels) {
    const existing = await db
      .select({ contentSchema: postsTable.contentSchema })
      .from(postsTable)
      .where(and(eq(postsTable.clientId, clientId), eq(postsTable.campaignId, campaign.id)));
    existingLabels = new Set(existing
      .map((post) => {
        const schema = post.contentSchema as Record<string, unknown> | null;
        const miniCampaign = schema?.miniCampaign as Record<string, unknown> | undefined;
        return typeof miniCampaign?.label === "string" ? miniCampaign.label : null;
      })
      .filter((label): label is string => Boolean(label)));
  }

  for (const [index, item] of items.entries()) {
    if (existingLabels.has(item.label)) {
      skipped.push(item.label);
      continue;
    }

    try {
      logger.info({ clientId, campaignId: campaign.id, skillId: item.skillId, label: item.label }, "Mini campaign item generation started");
      const result = await executeSkillToReviewDraft({
        clientId,
        skillId: item.skillId,
        input: item.input,
        userId,
        campaignId: campaign.id,
        scheduledAt: item.scheduledAt,
        generationRoute: "mini_campaign.auto_pilot_lite",
        extraContentSchema: {
          miniCampaign: {
            campaignId: campaign.id,
            campaignName: campaign.name,
            label: item.label,
            sequence: index + 1,
            suggestedScheduleAt: item.scheduledAt.toISOString(),
          },
        },
      });
      createdDrafts.push({
        id: result.post.id,
        label: item.label,
        skillId: item.skillId,
        topic: result.post.topic,
        platform: result.post.platform,
        contentType: result.post.contentType,
        scheduledAt: result.post.scheduledAt?.toISOString() ?? item.scheduledAt.toISOString(),
        qualityBadge: typeof result.metadata.qualityBadge === "string" ? result.metadata.qualityBadge : undefined,
      });
    } catch (err) {
      failures.push({
        label: item.label,
        skillId: item.skillId,
        error: userFacingSkillError(err),
      });
      logger.warn({ error: safeErrorMessage(err), clientId, campaignId: campaign.id, skillId: item.skillId, label: item.label }, "Mini campaign item failed");
    }
  }

  return { createdDrafts, failures, skipped };
}

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
router.post("/clients/:clientId/campaigns", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
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

// POST /clients/:clientId/campaigns/mini-generate
router.post("/clients/:clientId/campaigns/mini-generate", requireClientRole(EDIT_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  const { clientId } = req.params;
  const { topic, goal, platforms, startDate, postCount } = req.body as {
    topic?: string;
    goal?: string;
    platforms?: string[] | string;
    startDate?: string;
    postCount?: number;
  };

  const cleanTopic = typeof topic === "string" ? topic.trim() : "";
  if (!cleanTopic) {
    res.status(400).json({ error: "topic is required" });
    return;
  }

  const cleanGoal = typeof goal === "string" && goal.trim() ? goal.trim() : "awareness";
  const selectedPlatforms = cleanPlatforms(platforms);
  const campaignStart = startDateFrom(startDate);
  const socialCount = clampPostCount(postCount);

  try {
    await buildClientMemoryPacket(clientId);
    const campaignEnd = suggestedDate(campaignStart, socialCount + 2);
    const [campaign] = await db
      .insert(campaignsTable)
      .values({
        clientId,
        name: `Mini Campaign: ${cleanTopic}`,
        goal: cleanGoal,
        description: `Auto-Pilot Lite campaign generated from Creative Studio for "${cleanTopic}".`,
        startDate: campaignStart,
        endDate: campaignEnd,
        platforms: selectedPlatforms.join(","),
        status: "draft",
      })
      .returning();

    const items = buildMiniCampaignItems({
      topic: cleanTopic,
      goal: cleanGoal,
      platforms: selectedPlatforms,
      startDate: campaignStart,
      postCount: socialCount,
    });
    const { createdDrafts, failures } = await runMiniCampaignItems({
      clientId,
      userId: req.userId,
      campaign: campaign!,
      items,
    });

    if (failures.length) {
      await db
        .update(campaignsTable)
        .set({
          description: `${campaign!.description ?? ""}\nFailed items: ${failures.map((failure) => `${failure.label} (${failure.error})`).join("; ")}`,
          updatedAt: new Date(),
        })
        .where(eq(campaignsTable.id, campaign!.id));
    }

    res.status(createdDrafts.length ? 201 : 503).json({
      campaign,
      summary: {
        topic: cleanTopic,
        goal: cleanGoal,
        platforms: selectedPlatforms,
        requestedItems: items.length,
        createdCount: createdDrafts.length,
        failedCount: failures.length,
        partialSuccess: createdDrafts.length > 0 && failures.length > 0,
      },
      createdDrafts,
      failures,
    });
  } catch (err) {
    const { status, message } = toAiErrorResponse(err, "Failed to generate mini campaign.");
    logger.error({ error: safeErrorMessage(err), clientId }, "Mini campaign generation failed");
    res.status(status).json({ error: message });
  }
});

// POST /clients/:clientId/campaigns/:campaignId/mini-retry
router.post("/clients/:clientId/campaigns/:campaignId/mini-retry", requireClientRole(EDIT_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  const { clientId, campaignId } = req.params;
  const { failures, startDate } = req.body as {
    failures?: Array<{ label?: string; skillId?: string }>;
    startDate?: string;
  };

  try {
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.clientId, clientId)))
      .limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const topic = (campaign.name ?? "Mini Campaign").replace(/^Mini Campaign:\s*/i, "").trim() || campaign.name || "Mini Campaign";
    const goal = campaign.goal ?? "awareness";
    const platforms = cleanPlatforms(campaign.platforms ?? undefined);
    const retryStart = startDateFrom(startDate ?? campaign.startDate?.toISOString());
    const requestedLabels = new Set((failures ?? [])
      .map((failure) => typeof failure.label === "string" ? failure.label.trim() : "")
      .filter(Boolean));
    const allItems = buildMiniCampaignItems({
      topic,
      goal,
      platforms,
      startDate: retryStart,
      postCount: 3,
    });
    const items = requestedLabels.size
      ? allItems.filter((item) => requestedLabels.has(item.label))
      : allItems;

    if (!items.length) {
      res.status(400).json({ error: "No failed campaign items were selected for retry." });
      return;
    }

    const { createdDrafts, failures: retryFailures, skipped } = await runMiniCampaignItems({
      clientId,
      userId: req.userId,
      campaign: { id: campaign.id, name: campaign.name },
      items,
      skipExistingLabels: true,
    });

    res.status(createdDrafts.length ? 201 : 503).json({
      campaign,
      summary: {
        topic,
        goal,
        requestedItems: items.length,
        createdCount: createdDrafts.length,
        failedCount: retryFailures.length,
        skippedCount: skipped.length,
        partialSuccess: createdDrafts.length > 0 && retryFailures.length > 0,
      },
      createdDrafts,
      failures: retryFailures,
      skipped,
    });
  } catch (err) {
    const { status, message } = toAiErrorResponse(err, "Failed to retry campaign items.");
    logger.error({ error: safeErrorMessage(err), clientId, campaignId }, "Mini campaign retry failed");
    res.status(status).json({ error: message });
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
      .where(
        and(
          eq(postsTable.campaignId, req.params.campaignId),
          eq(postsTable.clientId, req.params.clientId),
        )
      );

    res.json({ ...campaign, posts });
  } catch {
    res.status(500).json({ error: "Failed to get campaign" });
  }
});

// PATCH /clients/:clientId/campaigns/:campaignId
router.patch("/clients/:clientId/campaigns/:campaignId", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
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
router.delete("/clients/:clientId/campaigns/:campaignId", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
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
