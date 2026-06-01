// Phase 50 — Frontend mirror of the omnichannel format matrix.
// Keep in sync with artifacts/api-server/src/lib/format-matrix.ts. The server
// is the source of truth; this file exists so the FE can render Review,
// Calendar, Queue, helper text, and the per-channel publish/export hints
// without an extra round trip.

export type PlatformId =
  | "instagram" | "facebook" | "linkedin" | "twitter" | "youtube"
  | "blog" | "newsletter" | "whatsapp" | "google_business" | "website" | "ad";

export type PublishMode = "api_when_connected" | "export_only";

export type FormatDef = {
  contentType: string;
  label: string;
  platform: PlatformId;
  channelGroup: "social" | "blog" | "newsletter" | "local" | "messaging" | "website" | "ad";
  mediaKind: "image" | "video" | "carousel" | "text" | "none";
  aspect?: string;
  recommendedSize?: string;
  hashtagBehavior: "many" | "few" | "minimal" | "none";
  needsImage: boolean;
  needsVideo: boolean;
  reviewRenderer:
    | "social_post" | "image_post" | "carousel" | "reel_storyboard" | "story_creative"
    | "whatsapp_status" | "gbp_post" | "blog_article" | "faq_pack" | "newsletter_snippet"
    | "website_banner" | "local_seo" | "review_request" | "campaign_pack_group"
    | "thumbnail" | "ad_creative";
  scheduling: "scheduled_capable" | "event_pinned" | "manual_only";
  publish: PublishMode;
};

export const FORMAT_MATRIX: readonly FormatDef[] = [
  { contentType: "instagram_post", label: "Instagram post", platform: "instagram", channelGroup: "social", mediaKind: "image", aspect: "1:1", recommendedSize: "1080x1080", hashtagBehavior: "many", needsImage: true, needsVideo: false, reviewRenderer: "image_post", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "instagram_carousel", label: "Instagram carousel", platform: "instagram", channelGroup: "social", mediaKind: "carousel", aspect: "1:1", recommendedSize: "1080x1080", hashtagBehavior: "many", needsImage: true, needsVideo: false, reviewRenderer: "carousel", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "instagram_reel", label: "Instagram Reel", platform: "instagram", channelGroup: "social", mediaKind: "video", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "few", needsImage: false, needsVideo: true, reviewRenderer: "reel_storyboard", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "instagram_story", label: "Instagram Story", platform: "instagram", channelGroup: "social", mediaKind: "image", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "minimal", needsImage: true, needsVideo: false, reviewRenderer: "story_creative", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "facebook_post", label: "Facebook post", platform: "facebook", channelGroup: "social", mediaKind: "image", aspect: "1.91:1", recommendedSize: "1200x630", hashtagBehavior: "minimal", needsImage: true, needsVideo: false, reviewRenderer: "image_post", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "facebook_reel", label: "Facebook Reel", platform: "facebook", channelGroup: "social", mediaKind: "video", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "few", needsImage: false, needsVideo: true, reviewRenderer: "reel_storyboard", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "linkedin_post", label: "LinkedIn post", platform: "linkedin", channelGroup: "social", mediaKind: "image", aspect: "1.91:1", recommendedSize: "1200x627", hashtagBehavior: "few", needsImage: false, needsVideo: false, reviewRenderer: "social_post", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "linkedin_carousel", label: "LinkedIn document carousel", platform: "linkedin", channelGroup: "social", mediaKind: "carousel", aspect: "1:1", recommendedSize: "1080x1080", hashtagBehavior: "few", needsImage: true, needsVideo: false, reviewRenderer: "carousel", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "youtube_short", label: "YouTube Short", platform: "youtube", channelGroup: "social", mediaKind: "video", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "few", needsImage: false, needsVideo: true, reviewRenderer: "reel_storyboard", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "youtube_thumbnail", label: "YouTube thumbnail", platform: "youtube", channelGroup: "social", mediaKind: "image", aspect: "16:9", recommendedSize: "1280x720", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "thumbnail", scheduling: "manual_only", publish: "export_only" },
  { contentType: "blog_article", label: "Blog / article", platform: "blog", channelGroup: "blog", mediaKind: "text", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "blog_article", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "newsletter_snippet", label: "Newsletter snippet", platform: "newsletter", channelGroup: "newsletter", mediaKind: "text", hashtagBehavior: "none", needsImage: false, needsVideo: false, reviewRenderer: "newsletter_snippet", scheduling: "manual_only", publish: "export_only" },
  { contentType: "website_banner", label: "Website banner / hero", platform: "website", channelGroup: "website", mediaKind: "image", aspect: "16:9", recommendedSize: "1920x800", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "website_banner", scheduling: "manual_only", publish: "export_only" },
  { contentType: "gbp_post", label: "Google Business Profile post", platform: "google_business", channelGroup: "local", mediaKind: "image", aspect: "1:1", recommendedSize: "1200x1200", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "gbp_post", scheduling: "scheduled_capable", publish: "api_when_connected" },
  { contentType: "gbp_offer", label: "GBP offer / event", platform: "google_business", channelGroup: "local", mediaKind: "image", aspect: "1:1", recommendedSize: "1200x1200", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "gbp_post", scheduling: "event_pinned", publish: "api_when_connected" },
  { contentType: "whatsapp_status_image", label: "WhatsApp Status (image)", platform: "whatsapp", channelGroup: "messaging", mediaKind: "image", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "whatsapp_status", scheduling: "manual_only", publish: "export_only" },
  { contentType: "whatsapp_status_video", label: "WhatsApp Status (video)", platform: "whatsapp", channelGroup: "messaging", mediaKind: "video", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "none", needsImage: false, needsVideo: true, reviewRenderer: "whatsapp_status", scheduling: "manual_only", publish: "export_only" },
  { contentType: "whatsapp_broadcast", label: "WhatsApp broadcast / message", platform: "whatsapp", channelGroup: "messaging", mediaKind: "text", hashtagBehavior: "none", needsImage: false, needsVideo: false, reviewRenderer: "review_request", scheduling: "manual_only", publish: "export_only" },
  { contentType: "ad_creative", label: "Ad creative", platform: "ad", channelGroup: "ad", mediaKind: "image", aspect: "1:1", recommendedSize: "1080x1080", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "ad_creative", scheduling: "manual_only", publish: "export_only" },
  { contentType: "festival_post", label: "Festival post", platform: "instagram", channelGroup: "social", mediaKind: "image", aspect: "1:1", recommendedSize: "1080x1080", hashtagBehavior: "few", needsImage: true, needsVideo: false, reviewRenderer: "image_post", scheduling: "event_pinned", publish: "api_when_connected" },
  { contentType: "festival_reel", label: "Festival Reel", platform: "instagram", channelGroup: "social", mediaKind: "video", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "few", needsImage: false, needsVideo: true, reviewRenderer: "reel_storyboard", scheduling: "event_pinned", publish: "api_when_connected" },
  { contentType: "festival_status", label: "Festival WhatsApp Status", platform: "whatsapp", channelGroup: "messaging", mediaKind: "image", aspect: "9:16", recommendedSize: "1080x1920", hashtagBehavior: "none", needsImage: true, needsVideo: false, reviewRenderer: "whatsapp_status", scheduling: "event_pinned", publish: "export_only" },
  { contentType: "local_seo_content", label: "Local service / near-me content", platform: "website", channelGroup: "local", mediaKind: "text", hashtagBehavior: "none", needsImage: false, needsVideo: false, reviewRenderer: "local_seo", scheduling: "manual_only", publish: "export_only" },
  { contentType: "review_request", label: "Review request message", platform: "whatsapp", channelGroup: "messaging", mediaKind: "text", hashtagBehavior: "none", needsImage: false, needsVideo: false, reviewRenderer: "review_request", scheduling: "manual_only", publish: "export_only" },
  { contentType: "case_study_post", label: "Case study / portfolio post", platform: "linkedin", channelGroup: "social", mediaKind: "carousel", aspect: "1:1", recommendedSize: "1080x1080", hashtagBehavior: "few", needsImage: true, needsVideo: false, reviewRenderer: "carousel", scheduling: "scheduled_capable", publish: "api_when_connected" },
];

const BY_TYPE = new Map<string, FormatDef>(FORMAT_MATRIX.map((f) => [f.contentType, f]));

export function getFormat(contentType: string | null | undefined): FormatDef | null {
  if (!contentType) return null;
  return BY_TYPE.get(contentType) ?? null;
}

export function isExportOnly(contentType: string | null | undefined): boolean {
  return getFormat(contentType)?.publish === "export_only";
}

export function publishLabel(contentType: string | null | undefined): "API publish" | "Export / manual" | "Unknown" {
  const f = getFormat(contentType);
  if (!f) return "Unknown";
  return f.publish === "api_when_connected" ? "API publish" : "Export / manual";
}

export function reviewRendererFor(contentType: string | null | undefined): FormatDef["reviewRenderer"] {
  return getFormat(contentType)?.reviewRenderer ?? "social_post";
}

export function formatsByChannel(): Record<string, FormatDef[]> {
  const out: Record<string, FormatDef[]> = {};
  for (const f of FORMAT_MATRIX) {
    (out[f.channelGroup] ??= []).push(f);
  }
  return out;
}
