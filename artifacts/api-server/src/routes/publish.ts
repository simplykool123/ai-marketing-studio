import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, socialAccountsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { resolveAccessToken, runScheduledPublish } from "../lib/scheduler.js";
import { publishToPlatform } from "../lib/publishers/index.js";
import { APPROVE_CONTENT_ROLES, requireClientRole } from "../middleware/auth.js";
import { writeClientMemory } from "../lib/client-memory-packet.js";
import { markFailed } from "../lib/publishing-destinations.js";

const router = Router();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function publishImageUrl(post: typeof postsTable.$inferSelect): string | null {
  const schema = asRecord(post.contentSchema);
  return String(schema.finalArtworkUrl ?? post.selectedImageUrl ?? post.brandedImageUrl ?? schema.imageUrl ?? "") || null;
}

function publishMetadata(post: typeof postsTable.$inferSelect, result: {
  platformPostId: string;
  provider: string;
  publishedUrl: string;
  rawPublishResponse?: unknown;
}) {
  return {
    ...asRecord(post.contentSchema),
    publish: {
      ...asRecord(asRecord(post.contentSchema).publish),
      platformPostId: result.platformPostId,
      provider: result.provider,
      publishedUrl: result.publishedUrl,
      rawPublishResponse: result.rawPublishResponse,
    },
  };
}

function canDirectPublishPost(post: typeof postsTable.$inferSelect, platform: string): string | null {
  if (post.publishedAt) return "This post is already published.";
  if (!["approved", "export_ready", "ready_to_post", "scheduled", "failed"].includes(post.status)) {
    return `Cannot publish a post with status '${post.status}'. Approve it first.`;
  }
  if (!["instagram", "facebook", "linkedin", "twitter"].includes(platform)) {
    return `${platform} direct publishing is not implemented yet.`;
  }
  if ((post.contentType ?? "").toLowerCase().includes("video")) {
    return "Video direct publishing is not supported yet.";
  }
  if (platform === "instagram" && !publishImageUrl(post)) {
    return "Instagram publishing requires final artwork or an image URL.";
  }
  return null;
}

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

    const platform = post.platform ?? "instagram";
    const safetyError = canDirectPublishPost(post, platform);
    if (safetyError) {
      res.status(400).json({
        error: safetyError,
      });
      return;
    }

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
      await markFailed(postId, clientId, `No active ${platform} account connected. Connect one in Social Accounts.`);

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
      imageUrl: publishImageUrl(post),
      accountId: account.accountId ?? account.id,
      accessToken,
      platform,
    });

    const [updated] = await db
      .update(postsTable)
      .set({
        status: "published_via_api",
        publishedAt: result.publishedAt,
        publishedUrl: result.publishedUrl,
        contentSchema: publishMetadata(post, result),
        publishError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .returning();

    await writeClientMemory(clientId, "Performance Memory / Published post", `User published ${platform} post "${post.topic}". Treat this as an accepted final content direction.`);

    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    await markFailed(req.params.postId, req.params.clientId, message).catch(() => {});

    res.status(500).json({ error: message });
  }
});

// POST /clients/:clientId/publishing/run-due-check
// Manual reliability hook for admin/dev operations. It uses the same scheduler
// safety checks as the interval runner and respects ENABLE_AUTO_PUBLISH=false.
router.post("/clients/:clientId/publishing/run-due-check", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const result = await runScheduledPublish({ reason: "manual", clientId: req.params.clientId });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to run due publish check";
    res.status(500).json({ error: message });
  }
});

export default router;
