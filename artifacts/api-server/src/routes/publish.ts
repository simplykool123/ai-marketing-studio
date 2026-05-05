import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, socialAccountsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { resolveAccessToken } from "../lib/scheduler.js";
import { publishToPlatform } from "../lib/publishers/index.js";
import { APPROVE_CONTENT_ROLES, requireClientRole } from "../middleware/auth.js";

const router = Router();

// POST /clients/:clientId/posts/:postId/publish
router.post("/clients/:clientId/posts/:postId/publish", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res) => {
  if (!isEncryptionConfigured()) {
    res.status(503).json({
      error: "Token encryption is not configured. Set TOKEN_ENCRYPTION_KEY in environment secrets.",
    });
    return;
  }

  try {
    const { clientId, postId } = req.params;

    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    if (!["approved", "export_ready", "scheduled", "failed"].includes(post.status)) {
      res.status(400).json({
        error: `Cannot publish a post with status '${post.status}'. Approve it first.`,
      });
      return;
    }

    const platform = post.platform ?? "instagram";

    const [account] = await db
      .select()
      .from(socialAccountsTable)
      .where(
        and(
          eq(socialAccountsTable.clientId, clientId),
          eq(socialAccountsTable.platform, platform),
          eq(socialAccountsTable.isActive, true)
        )
      )
      .limit(1);

    if (!account?.accessToken) {
      await db
        .update(postsTable)
        .set({
          status: "failed",
          publishError: `No active ${platform} account connected. Connect one in Social Accounts.`,
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)));

      res.status(422).json({
        error: `No active ${platform} account connected`,
      });
      return;
    }

    await db
      .update(postsTable)
      .set({ publishError: null, updatedAt: new Date() })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)));

    const accessToken = await resolveAccessToken(account);

    const result = await publishToPlatform({
      caption: post.caption,
      hashtags: post.hashtags,
      imageUrl: post.selectedImageUrl,
      accountId: account.accountId ?? account.id,
      accessToken,
      platform,
    });

    const [updated] = await db
      .update(postsTable)
      .set({
        status: "posted",
        publishedAt: result.publishedAt,
        publishedUrl: result.publishedUrl,
        publishError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .returning();

    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    await db
      .update(postsTable)
      .set({
        status: "failed",
        publishError: message,
        updatedAt: new Date(),
      })
      .where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId)))
      .catch(() => {});

    res.status(500).json({ error: message });
  }
});

export default router;
