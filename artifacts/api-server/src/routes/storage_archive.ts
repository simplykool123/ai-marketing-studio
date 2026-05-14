import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { postsTable } from "@workspace/db/schema";
import { APPROVE_CONTENT_ROLES, requireClientRole } from "../middleware/auth.js";
import { createClientNotification } from "../lib/notifications.js";

const router = Router();

const ARCHIVE_PROVIDER = "google_drive" as const;
const MINIMUM_ARCHIVE_AGE_DAYS = 7;

type ArchiveMetadata = {
  archiveStatus: "active" | "archived" | "archive_failed";
  archiveProvider: typeof ARCHIVE_PROVIDER;
  archiveFileId?: string;
  archiveUrl?: string;
  archivedAt?: string;
  originalSupabaseUrl?: string;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function googleDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function mediaUrlForPost(post: typeof postsTable.$inferSelect): string | undefined {
  const schema = asRecord(post.contentSchema);
  return firstString(
    schema.videoUrl,
    schema.finalVideoUrl,
    schema.durableVideoUrl,
    schema.finalArtworkUrl,
    post.selectedImageUrl,
    post.brandedImageUrl,
    post.originalImageUrl,
    schema.imageUrl,
    schema.artworkUrl,
    schema.generatedImageUrl,
    schema.backgroundImageUrl
  );
}

function activeArchiveMetadata(originalSupabaseUrl: string): ArchiveMetadata {
  return {
    archiveStatus: "active",
    archiveProvider: ARCHIVE_PROVIDER,
    originalSupabaseUrl,
  };
}

router.get("/clients/:clientId/storage/archive/status", (_req, res) => {
  const configured = googleDriveConfigured();

  res.json({
    provider: ARCHIVE_PROVIDER,
    configured,
    connected: false,
    enabled: false,
    minimumPublishedAgeDays: MINIMUM_ARCHIVE_AGE_DAYS,
    deletesSupabaseFiles: false,
    reason: configured
      ? "Google Drive credentials are present, but OAuth token storage/upload is not implemented in V1."
      : "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to prepare Google Drive archiving.",
  });
});

router.post(
  "/clients/:clientId/posts/:postId/archive/google-drive",
  requireClientRole(APPROVE_CONTENT_ROLES),
  async (req, res): Promise<void> => {
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

      if (!["posted", "published"].includes(post.status) || !post.publishedAt) {
        res.status(400).json({ error: "Only published posts with a publishedAt timestamp can be archived." });
        return;
      }

      const publishedAgeDays = daysSince(post.publishedAt);
      if (publishedAgeDays < MINIMUM_ARCHIVE_AGE_DAYS) {
        res.status(400).json({
          error: `Only published media older than ${MINIMUM_ARCHIVE_AGE_DAYS} days can be archived.`,
          publishedAgeDays,
          minimumPublishedAgeDays: MINIMUM_ARCHIVE_AGE_DAYS,
        });
        return;
      }

      const originalSupabaseUrl = mediaUrlForPost(post);
      if (!originalSupabaseUrl) {
        res.status(400).json({ error: "No archived-eligible media URL was found for this post." });
        return;
      }

      if (!googleDriveConfigured()) {
        await createClientNotification({
          clientId,
          type: "archive_failed",
          title: "Archive to Google Drive failed",
          message: "Google Drive archiving is not configured.",
          severity: "warning",
          metadata: { postId, provider: ARCHIVE_PROVIDER },
        });
        res.status(503).json({
          error: "Google Drive archiving is not configured.",
          archive: activeArchiveMetadata(originalSupabaseUrl),
        });
        return;
      }

      await createClientNotification({
        clientId,
        type: "archive_failed",
        title: "Archive to Google Drive unavailable",
        message: "Google Drive archive upload is scaffolded but not implemented in V1.",
        severity: "warning",
        metadata: { postId, provider: ARCHIVE_PROVIDER },
      });
      res.status(501).json({
        error: "Google Drive archive upload is scaffolded but not implemented in V1. No Supabase files were deleted.",
        archive: activeArchiveMetadata(originalSupabaseUrl),
      });
    } catch (err) {
      await createClientNotification({
        clientId: req.params.clientId,
        type: "archive_failed",
        title: "Archive action failed",
        message: "Failed to prepare archive action.",
        severity: "error",
        metadata: { postId: req.params.postId, provider: ARCHIVE_PROVIDER },
      });
      res.status(500).json({ error: "Failed to prepare archive action" });
    }
  }
);

export default router;
