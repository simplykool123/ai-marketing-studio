import { Router } from "express";
import { db } from "@workspace/db";
import {
  postsTable,
  brandDnaTable,
  storylinesTable,
  socialAccountsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, asc, inArray } from "drizzle-orm";
import { ensureStorageBucket } from "./upload.js";

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

router.get("/clients/:clientId/dashboard", async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const now = new Date();

    const [allPosts, brandDna, activeStoryline, recentPosts, connectedAccounts, upcomingPosts, recentlyPublished, storage] =
      await Promise.all([
        db.select().from(postsTable).where(eq(postsTable.clientId, clientId)),
        db
          .select()
          .from(brandDnaTable)
          .where(eq(brandDnaTable.clientId, clientId))
          .limit(1),
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
              inArray(postsTable.status, ["approved", "export_ready", "scheduled"]),
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
              inArray(postsTable.status, ["posted", "published"])
            )
          )
          .orderBy(desc(postsTable.publishedAt))
          .limit(10),
        getStorageReadiness(),
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

    res.json({
      totalPosts: allPosts.length,
      draftCount: statusCounts["draft"] ?? 0,
      approvedCount: (statusCounts["approved"] ?? 0) + (statusCounts["export_ready"] ?? 0),
      scheduledCount: statusCounts["scheduled"] ?? 0,
      publishedCount: (statusCounts["posted"] ?? 0) + (statusCounts["published"] ?? 0),
      hasStoryline: activeStoryline.length > 0,
      activeStoryline: activeStoryline[0] ?? null,
      hasBrandDna: brandDna.length > 0,
      storageReady: storage.storageReady,
      storageStatusMessage: storage.storageStatusMessage,
      recentPosts,
      upcomingPosts,
      connectedAccounts,
      recentlyPublished,
      todaysPosts,
      pendingApprovals: pendingApprovals.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get dashboard" });
  }
});

export default router;
