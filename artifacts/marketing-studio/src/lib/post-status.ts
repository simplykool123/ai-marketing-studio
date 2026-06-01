// Phase 46: canonical post status vocabulary on the frontend.
// Mirrors api-server/src/lib/post-status.ts. Readers accept both old and new values.

export const APPROVED_FAMILY = [
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
] as const;

export const QUEUE_FAMILY = [
  "approved",
  "scheduled",
  "ready_to_post",
  "ready_for_whatsapp",
  "exported",
  "failed",
  // legacy
  "export_ready",
] as const;

export const POSTED_FAMILY = [
  "posted_manually",
  "published_via_api",
  // legacy
  "posted",
  "published",
] as const;

export const READY_TO_POST_FAMILY = ["ready_to_post", "export_ready", "approved"] as const;

export function isApprovedFamily(status: string | null | undefined): boolean {
  return !!status && (APPROVED_FAMILY as readonly string[]).includes(status);
}

export function isQueueFamily(status: string | null | undefined): boolean {
  return !!status && (QUEUE_FAMILY as readonly string[]).includes(status);
}

export function isPostedFamily(status: string | null | undefined): boolean {
  return !!status && (POSTED_FAMILY as readonly string[]).includes(status);
}

export function isReadyToPostFamily(status: string | null | undefined): boolean {
  return !!status && (READY_TO_POST_FAMILY as readonly string[]).includes(status);
}

// Truthful, user-facing label. Never says "Published" unless the post really
// reached a publish endpoint and was confirmed.
export function postStatusLabel(
  status: string | null | undefined,
  opts: { publishedAt?: string | Date | null; manual?: boolean } = {},
): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in_review":
      return "In review";
    case "approved":
      return "Approved";
    case "ready_to_post":
    case "export_ready":
      return "Ready to post";
    case "ready_for_whatsapp":
      return "Ready for WhatsApp";
    case "exported":
      return "Exported";
    case "scheduled":
      return opts.publishedAt ? "Published via API" : "Scheduled";
    case "posted_manually":
    case "posted":
      return opts.publishedAt ? "Posted manually" : "Posted manually (no timestamp)";
    case "published_via_api":
    case "published":
      return opts.publishedAt ? "Published via API" : "Published via API (no timestamp)";
    case "failed":
      return "Failed";
    case "rejected":
      return "Rejected";
    default:
      return "Draft";
  }
}

// Used in export payloads and read-only audit labels.
export function exportableStatusOf(status: string | null | undefined, publishedAt?: string | Date | null): string {
  if (publishedAt) {
    if (status === "posted" || status === "posted_manually") return "posted_manually";
    if (status === "published" || status === "published_via_api") return "published_via_api";
    if (status === "scheduled") return "published_via_api";
  }
  return status ?? "draft";
}
