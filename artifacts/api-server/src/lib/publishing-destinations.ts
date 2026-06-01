import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientsTable, postingLogsTable, postsTable, socialAccountsTable } from "@workspace/db/schema";
import type { Post } from "@workspace/db/schema";
import { isEncryptionConfigured } from "./crypto.js";
import { canonicalStatus, isPostedFamily } from "./post-status.js";

export type PublishingDestinationType =
  | "manual"
  | "workflow"
  | "native_meta_placeholder"
  | "postiz_placeholder"
  | "ayrshare_placeholder";

export type PublishingDestination = {
  type: PublishingDestinationType;
  label: string;
  status: "available" | "configured" | "not_configured" | "coming_next";
  description: string;
  actionLabel: string;
  enabled: boolean;
};

const DIRECT_PUBLISH_PLATFORMS = ["instagram", "facebook", "linkedin", "twitter"];

export type PublishPackagePost = {
  clientName: string;
  postId: string;
  platform: string;
  caption: string;
  hashtags: string;
  finalArtworkUrl: string;
  selectedImageUrl: string;
  scheduledAt: string;
  status: string;
  contentType: string;
  createdAt: string;
  publishedAt?: string;
};

export type PublishPackage = {
  clientName: string;
  exportedAt: string;
  totalItems: number;
  posts: PublishPackagePost[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finalArtworkUrlFor(post: Post): string {
  const schema = asRecord(post.contentSchema);
  return String(schema.finalArtworkUrl ?? post.selectedImageUrl ?? post.brandedImageUrl ?? schema.imageUrl ?? "");
}

export function exportableStatus(post: Post): string {
  if (post.publishedAt && isPostedFamily(post.status)) return canonicalStatus(post.status);
  return canonicalStatus(post.status);
}

export function buildPublishPayloadPost(clientName: string, post: Post): PublishPackagePost {
  const payload: PublishPackagePost = {
    clientName,
    postId: post.id,
    platform: post.platform ?? "instagram",
    caption: post.caption,
    hashtags: post.hashtags ?? "",
    finalArtworkUrl: finalArtworkUrlFor(post),
    selectedImageUrl: post.selectedImageUrl ?? "",
    scheduledAt: post.scheduledAt?.toISOString() ?? "",
    status: exportableStatus(post),
    contentType: post.contentType ?? post.postType ?? "social_post",
    createdAt: post.createdAt.toISOString(),
  };
  if (post.publishedAt) payload.publishedAt = post.publishedAt.toISOString();
  return payload;
}

export function buildPublishPackage(clientName: string, posts: Post[]): PublishPackage {
  return {
    clientName,
    exportedAt: new Date().toISOString(),
    totalItems: posts.length,
    posts: posts.map((post) => buildPublishPayloadPost(clientName, post)),
  };
}

export async function getPublishingDestinations(clientId: string): Promise<PublishingDestination[]> {
  const [client] = await db
    .select({ webhookUrl: clientsTable.webhookUrl })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .limit(1);

  const hasWorkflow = !!client?.webhookUrl;
  const metaAccounts = await db
    .select({
      platform: socialAccountsTable.platform,
      accessToken: socialAccountsTable.accessToken,
      tokenExpiresAt: socialAccountsTable.tokenExpiresAt,
    })
    .from(socialAccountsTable)
    .where(
      and(
        eq(socialAccountsTable.clientId, clientId),
        eq(socialAccountsTable.isActive, true),
        inArray(socialAccountsTable.platform, ["facebook", "instagram"])
      )
    );
  const tokenStorageSafe = isEncryptionConfigured();
  const hasReadyMetaAccount = metaAccounts.some((account) => {
    const expired = !!account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now();
    return !!account.accessToken && !expired;
  });
  const metaConnected = tokenStorageSafe && hasReadyMetaAccount;

  return [
    {
      type: "manual",
      label: "Manual posting",
      status: "available",
      description: "Export packages, copy captions, and mark posts as posted after publishing manually.",
      actionLabel: "Export manually",
      enabled: true,
    },
    {
      type: "workflow",
      label: "Workflow / Make / Zapier",
      status: hasWorkflow ? "configured" : "not_configured",
      description: hasWorkflow ? "Workflow URL is configured for this client." : "Add a workflow URL before sending posts to automation.",
      actionLabel: "Setup workflow",
      enabled: hasWorkflow,
    },
    {
      type: "native_meta_placeholder",
      label: "Native Meta",
      status: metaConnected ? "configured" : "not_configured",
      description: metaConnected
        ? "Facebook Page or Instagram Business account is connected with encrypted token storage."
        : "Connect a Facebook Page and linked Instagram Business account when Meta app credentials are ready.",
      actionLabel: metaConnected ? "Meta connected" : "Connect Meta",
      enabled: metaConnected,
    },
    {
      type: "postiz_placeholder",
      label: "Postiz",
      status: "coming_next",
      description: "Optional external scheduler connector for a later sprint.",
      actionLabel: "Coming next",
      enabled: false,
    },
    {
      type: "ayrshare_placeholder",
      label: "Ayrshare",
      status: "coming_next",
      description: "Optional external publishing connector for a later sprint.",
      actionLabel: "Coming next",
      enabled: false,
    },
  ];
}

export async function getPublishingReadiness(clientId: string) {
  const destinations = await getPublishingDestinations(clientId);
  const activeAccounts = await db
    .select({
      platform: socialAccountsTable.platform,
      isActive: socialAccountsTable.isActive,
      accessToken: socialAccountsTable.accessToken,
      tokenExpiresAt: socialAccountsTable.tokenExpiresAt,
    })
    .from(socialAccountsTable)
    .where(and(eq(socialAccountsTable.clientId, clientId), eq(socialAccountsTable.isActive, true)));

  const hasWorkflow = destinations.some((destination) => destination.type === "workflow" && destination.enabled);
  const hasManual = destinations.some((destination) => destination.type === "manual" && destination.enabled);
  const tokenStorageSafe = isEncryptionConfigured();
  const directConnectedPlatforms = activeAccounts
    .filter((account) => DIRECT_PUBLISH_PLATFORMS.includes(account.platform))
    .filter((account) => {
      const expired = !!account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now();
      return !!account.accessToken && tokenStorageSafe && !expired;
    })
    .map((account) => account.platform);
  const hasNativeReadyAccount = activeAccounts.some((account) => {
    const isMetaPlatform = account.platform === "facebook" || account.platform === "instagram";
    const expired = !!account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now();
    return isMetaPlatform && !!account.accessToken && tokenStorageSafe && !expired;
  });

  return {
    destinations,
    manualAvailable: hasManual,
    workflowConfigured: hasWorkflow,
    nativeMetaConnected: hasNativeReadyAccount,
    externalConnectorConnected: false,
    activeSocialAccountCount: activeAccounts.length,
    directConnectedPlatforms: Array.from(new Set(directConnectedPlatforms)),
    canSendWorkflow: hasWorkflow,
    canExportManual: hasManual,
    canPublishNatively: directConnectedPlatforms.length > 0,
    blockedReason: hasWorkflow || hasManual
      ? null
      : "No manual or workflow destination is available.",
  };
}

export async function buildPublishPayload(postId: string): Promise<PublishPackagePost | null> {
  const [post] = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.id, postId))
    .limit(1);

  if (!post) return null;

  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, post.clientId))
    .limit(1);

  return buildPublishPayloadPost(client?.name ?? "Unknown", post);
}

export async function markPublished(postId: string, clientId: string, publishedAt = new Date()) {
  const [updated] = await db
    .update(postsTable)
    .set({ status: "posted_manually", publishedAt, publishError: null, updatedAt: publishedAt })
    .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
    .returning();

  if (updated) {
    await db.insert(postingLogsTable).values({
      clientId,
      postId,
      action: "mark_published",
      status: "success",
      provider: "manual",
    });
  }

  return updated ?? null;
}

export async function markFailed(postId: string, clientId: string, reason: string) {
  const [updated] = await db
    .update(postsTable)
    .set({ status: "failed", publishError: reason, updatedAt: new Date() })
    .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
    .returning();

  if (updated) {
    await db.insert(postingLogsTable).values({
      clientId,
      postId,
      action: "publish_failed",
      status: "failed",
      provider: "internal",
      responseBody: reason,
    });
  }

  return updated ?? null;
}

export async function schedulePost(postId: string, clientId: string, scheduledAt: Date) {
  const [updated] = await db
    .update(postsTable)
    .set({ status: "scheduled", scheduledAt, updatedAt: new Date() })
    .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
    .returning();
  return updated ?? null;
}

// Future connector contracts:
// - Meta connector should consume PublishPackagePost and write platform post IDs when schema support exists.
// - Postiz connector should consume PublishPackagePost without becoming the source of truth.
// - Ayrshare connector should consume PublishPackagePost without bypassing post status transitions.
