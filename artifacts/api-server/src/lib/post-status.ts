// Canonical post status vocabulary (Phase 46).
// New writers MUST use the canonical names below.
// Reader helpers accept legacy values so older rows continue to work
// without a data migration.

export const POST_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "ready_to_post",
  "ready_for_whatsapp",
  "exported",
  "posted_manually",
  "published_via_api",
  "failed",
  "rejected",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

// Legacy values that still exist on rows in the DB.
const LEGACY_STATUSES = ["export_ready", "posted", "published"] as const;
type LegacyStatus = (typeof LEGACY_STATUSES)[number];

export type AnyPostStatus = PostStatus | LegacyStatus | string;

// Map any legacy value to its canonical replacement so the UI can render
// the truthful label even when the DB still holds the old string.
export function canonicalStatus(status: string | null | undefined): PostStatus {
  switch (status) {
    case "export_ready":
      return "ready_to_post";
    case "posted":
      return "posted_manually";
    case "published":
      return "published_via_api";
    default:
      return (POST_STATUSES.includes(status as PostStatus) ? status : "draft") as PostStatus;
  }
}

// All status values that should still be considered "approved by user"
// (i.e. a human has accepted the draft, regardless of publish outcome).
export const APPROVED_FAMILY: readonly AnyPostStatus[] = [
  "approved",
  "scheduled",
  "ready_to_post",
  "ready_for_whatsapp",
  "exported",
  "posted_manually",
  "published_via_api",
  // legacy
  "export_ready",
  "posted",
  "published",
];

// Statuses that mean the post is queued for publishing (manually or via API).
export const QUEUE_FAMILY: readonly AnyPostStatus[] = [
  "approved",
  "scheduled",
  "ready_to_post",
  "ready_for_whatsapp",
  "exported",
  "failed",
  // legacy
  "export_ready",
];

// Statuses that mean the post is live somewhere.
export const POSTED_FAMILY: readonly AnyPostStatus[] = [
  "posted_manually",
  "published_via_api",
  // legacy
  "posted",
  "published",
];

export function isApprovedFamily(status: string | null | undefined): boolean {
  return !!status && APPROVED_FAMILY.includes(status);
}

export function isPostedFamily(status: string | null | undefined): boolean {
  return !!status && POSTED_FAMILY.includes(status);
}

export function isReadyToPostFamily(status: string | null | undefined): boolean {
  return status === "ready_to_post" || status === "export_ready" || status === "approved";
}

// Human-readable label for a status (truthful — never says "Published" unless
// the row really came from a successful publish path).
export function statusLabel(
  status: string | null | undefined,
  opts: { publishedAt?: Date | string | null } = {},
): string {
  const canonical = canonicalStatus(status);
  switch (canonical) {
    case "draft":
      return "Draft";
    case "in_review":
      return "In review";
    case "approved":
      return "Approved";
    case "scheduled":
      return opts.publishedAt ? "Published (via API)" : "Scheduled";
    case "ready_to_post":
      return "Ready to post";
    case "ready_for_whatsapp":
      return "Ready for WhatsApp";
    case "exported":
      return "Exported";
    case "posted_manually":
      return "Posted manually";
    case "published_via_api":
      return "Published via API";
    case "failed":
      return "Failed";
    case "rejected":
      return "Rejected";
    default:
      return "Draft";
  }
}
