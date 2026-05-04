import { Router } from "express";
import { db } from "@workspace/db";
import {
  postsTable,
  brandDnaTable,
  storylinesTable,
  socialAccountsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, asc } from "drizzle-orm";

const router = Router();

router.get("/clients/:clientId/dashboard", async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const now = new Date();

    const [allPosts, brandDna, activeStoryline, recentPosts, connectedAccounts, upcomingPosts, recentlyPublished] =
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
              eq(postsTable.status, "scheduled"),
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
              eq(postsTable.status, "published")
            )
          )
          .orderBy(desc(postsTable.publishedAt))
          .limit(10),
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

    const pendingApprovals = allPosts.filter(p => p.status === "draft");

    res.json({
      totalPosts: allPosts.length,
      draftCount: statusCounts["draft"] ?? 0,
      approvedCount: statusCounts["approved"] ?? 0,
      scheduledCount: statusCounts["scheduled"] ?? 0,
      publishedCount: statusCounts["published"] ?? 0,
      hasStoryline: activeStoryline.length > 0,
      activeStoryline: activeStoryline[0] ?? null,
      hasBrandDna: brandDna.length > 0,
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
