import { Router } from "express";
import { db } from "@workspace/db";
import {
  postsTable,
  brandDnaTable,
  brandAssetsTable,
  imagesTable,
  storylinesTable,
  socialAccountsTable,
  userSettingsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, asc, inArray, isNotNull } from "drizzle-orm";
import { ensureStorageBucket } from "./upload.js";
import { getProviderKeyStatus } from "../lib/ai-provider.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();

async function getStorageReadiness(): Promise<{
  storageReady: boolean;
  storageStatusMessage: string;
}> {
  try {
    await ensureStorageBucket();
    return { storageReady: true, storageStatusMessage: "Uploads working" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown storage error";
    return {
      storageReady: false,
      storageStatusMessage: `Supabase Storage bucket is not ready. Developer/admin action required: ${detail}`,
    };
  }
}

router.get("/clients/:clientId/dashboard", async (req: AuthRequest, res) => {
  try {
    const clientId = req.params.clientId;
    const userId = req.userId;
    const now = new Date();

    const [allPosts, brandDna, assetRows, imageRows, activeStoryline, recentPosts, connectedAccounts, upcomingPosts, recentlyPublished, storage, userSettings, providerStatus] =
      await Promise.all([
        db.select().from(postsTable).where(eq(postsTable.clientId, clientId)),
        db
          .select()
          .from(brandDnaTable)
          .where(eq(brandDnaTable.clientId, clientId))
          .limit(1),
        db
          .select({ id: brandAssetsTable.id })
          .from(brandAssetsTable)
          .where(eq(brandAssetsTable.clientId, clientId)),
        db
          .select({ id: imagesTable.id })
          .from(imagesTable)
          .where(eq(imagesTable.clientId, clientId)),
        db
          .select()
          .from(storylinesTable)
          .where(
            and(
              eq(storylinesTable.clientId, clientId),
              eq(storylinesTable.isActive, true)
            )
          )
          .limit(1),
        db
          .select()
          .from(postsTable)
          .where(eq(postsTable.clientId, clientId))
          .orderBy(desc(postsTable.createdAt))
          .limit(5),
        db
          .select({
            id: socialAccountsTable.id,
            clientId: socialAccountsTable.clientId,
            platform: socialAccountsTable.platform,
            accountName: socialAccountsTable.accountName,
            accountHandle: socialAccountsTable.accountHandle,
            accountId: socialAccountsTable.accountId,
            avatarUrl: socialAccountsTable.avatarUrl,
            followerCount: socialAccountsTable.followerCount,
            isActive: socialAccountsTable.isActive,
            createdAt: socialAccountsTable.createdAt,
            updatedAt: socialAccountsTable.updatedAt,
          })
          .from(socialAccountsTable)
          .where(
            and(
              eq(socialAccountsTable.clientId, clientId),
              eq(socialAccountsTable.isActive, true)
            )
          )
          .orderBy(socialAccountsTable.platform),
        db
          .select()
          .from(postsTable)
          .where(
            and(
              eq(postsTable.clientId, clientId),
              inArray(postsTable.status, ["approved", "export_ready", "ready_to_post", "scheduled", "exported"]),
              gte(postsTable.scheduledAt, now)
            )
          )
          .orderBy(asc(postsTable.scheduledAt))
          .limit(10),
        db
          .select()
          .from(postsTable)
          .where(
            and(
              eq(postsTable.clientId, clientId),
              inArray(postsTable.status, ["posted", "posted_manually", "published", "published_via_api"]),
              isNotNull(postsTable.publishedAt)
            )
          )
          .orderBy(desc(postsTable.publishedAt))
          .limit(10),
        getStorageReadiness(),
        userId
          ? db
              .select()
              .from(userSettingsTable)
              .where(eq(userSettingsTable.userId, userId))
              .limit(1)
          : Promise.resolve([]),
        getProviderKeyStatus(userId),
      ]);

    const statusCounts = allPosts.reduce(
      (acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todaysPosts = allPosts.filter(p => {
      if (!p.scheduledAt) return false;
      const d = new Date(p.scheduledAt);
      return d >= todayStart && d <= todayEnd;
    });

    const pendingApprovals = allPosts.filter(p => p.status === "in_review");
    const needsAttentionCount = allPosts.filter(p => p.status === "failed").length;
    const publishedPosts = allPosts.filter(p => ["posted", "posted_manually", "published", "published_via_api"].includes(p.status) && p.publishedAt);
    const campaignDraftCount = allPosts.filter(p => p.status === "draft" && p.campaignId).length;
    const artworkReadyCount = allPosts.filter((post) => {
      const schema = post.contentSchema && typeof post.contentSchema === "object" && !Array.isArray(post.contentSchema)
        ? post.contentSchema as Record<string, unknown>
        : {};
      return Boolean(schema.finalArtworkUrl || post.selectedImageUrl || post.brandedImageUrl || schema.imageUrl);
    }).length;
    const settings = userSettings[0] ?? null;
    const selectedProvider = settings?.aiProvider ?? "anthropic";
    const selectedStatus = providerStatus[selectedProvider];
    const configuredDatabaseProvider = selectedStatus?.source === "database"
      ? selectedProvider
      : Object.entries(providerStatus).find(([, status]) => status.source === "database")?.[0] ?? null;
    const aiProviderConfigured = !!configuredDatabaseProvider;

    res.json({
      totalPosts: allPosts.length,
      draftCount: statusCounts["draft"] ?? 0,
      approvedCount: (statusCounts["approved"] ?? 0) + (statusCounts["export_ready"] ?? 0) + (statusCounts["ready_to_post"] ?? 0) + (statusCounts["exported"] ?? 0),
      scheduledCount: statusCounts["scheduled"] ?? 0,
      publishedCount: publishedPosts.length,
      campaignDraftCount,
      brandAssetCount: assetRows.length,
      imageAssetCount: imageRows.length,
      artworkReadyCount,
      hasStoryline: activeStoryline.length > 0,
      activeStoryline: activeStoryline[0] ?? null,
      hasBrandDna: brandDna.length > 0,
      storageReady: storage.storageReady,
      storageStatusMessage: storage.storageStatusMessage,
      aiProviderConfigured,
      aiProvider: configuredDatabaseProvider ?? selectedProvider,
      aiModel: settings?.aiModel ?? null,
      aiKeySource: configuredDatabaseProvider ? "database" : selectedStatus?.source ?? "none",
      recentPosts,
      upcomingPosts,
      connectedAccounts,
      recentlyPublished,
      todaysPosts,
      pendingApprovals: pendingApprovals.length,
      needsAttentionCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get dashboard" });
  }
});

export default router;
