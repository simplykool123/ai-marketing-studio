// Phase 50 — Omnichannel Format Matrix.
// Single source of truth for every content format the app supports.
// Imported by Creative Studio, AI Brain, AI Visibility, Campaign Pack, Trend
// Radar, Festival Engine, Review/Drafts, Calendar, Queue, and the omnichannel
// builder route. Frontend has a mirror at marketing-studio/src/lib/format-matrix.ts.

export type PlatformId =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "twitter"
  | "youtube"
  | "blog"
  | "newsletter"
  | "whatsapp"
  | "google_business"
  | "website"
  | "ad";

export type ChannelGroup =
  | "social"
  | "blog"
  | "newsletter"
  | "local"
  | "messaging"
  | "website"
  | "ad";

export type MediaKind = "image" | "video" | "carousel" | "text" | "none";

export type PublishMode =
  // Has a backend publish endpoint that may invoke a real platform API when
  // the social account / connection is configured for this client.
  | "api_when_connected"
  // Only ever supports export/copy/download. The status flow stops at
  // exported / ready_for_whatsapp / posted_manually.
  | "export_only";

export type SchedulingBehavior =
  // Can be scheduled via the auto-scheduler (regular cadence channel).
  | "scheduled_capable"
  // Tied to an explicit calendar date (festival/event). User picks the day.
  | "event_pinned"
  // Has no native concept of "scheduled" — user owns the calendar (manual export).
  | "manual_only";

export type FormatDef = {
  contentType: string;             // posts.contentType / posts.postType. Stable key, snake_case.
  label: string;                   // human label
  platform: PlatformId;
  channelGroup: ChannelGroup;
  mediaKind: MediaKind;
  aspect?: string;                 // e.g. "1:1", "9:16"
  recommendedSize?: string;        // e.g. "1080x1080", "1080x1920"
  durationSec?: { min: number; max: number };

  // Caption + CTA + hashtag rules — used by skill prompts and by the FE
  // when rendering helper text in the editor.
  captionRules: string;
  ctaRules: string;
  hashtagBehavior: "many" | "few" | "minimal" | "none";

  // Image / video needs for the renderer.
  needsImage: boolean;
  needsVideo: boolean;

  // Which Review renderer to use (component slug — see marketing-studio side).
  reviewRenderer:
    | "social_post"
    | "image_post"
    | "carousel"
    | "reel_storyboard"
    | "story_creative"
    | "whatsapp_status"
    | "gbp_post"
    | "blog_article"
    | "faq_pack"
    | "newsletter_snippet"
    | "website_banner"
    | "local_seo"
    | "review_request"
    | "campaign_pack_group"
    | "thumbnail"
    | "ad_creative";

  scheduling: SchedulingBehavior;
  publish: PublishMode;

  // Free-form notes the prompt can include.
  notes?: string;
};

export const FORMAT_MATRIX: readonly FormatDef[] = [
  // ── Instagram ────────────────────────────────────────────────────────────
  {
    contentType: "instagram_post",
    label: "Instagram post",
    platform: "instagram",
    channelGroup: "social",
    mediaKind: "image",
    aspect: "1:1",
    recommendedSize: "1080x1080",
    captionRules: "Strong hook in first line, value body, conversational, line breaks between thoughts. 150–220 words max.",
    ctaRules: "One CTA: comment / DM / save / link in bio. Avoid two CTAs.",
    hashtagBehavior: "many",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "image_post",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },
  {
    contentType: "instagram_carousel",
    label: "Instagram carousel",
    platform: "instagram",
    channelGroup: "social",
    mediaKind: "carousel",
    aspect: "1:1",
    recommendedSize: "1080x1080",
    captionRules: "Hook caption that promises payoff inside the slides. Slide 1 = hook, slides 2–7 = build, last slide = CTA.",
    ctaRules: "Final-slide CTA + a soft CTA in caption (save / share).",
    hashtagBehavior: "many",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "carousel",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
    notes: "5–10 slides typical. Each slide: headline + body copy.",
  },
  {
    contentType: "instagram_reel",
    label: "Instagram Reel",
    platform: "instagram",
    channelGroup: "social",
    mediaKind: "video",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    durationSec: { min: 7, max: 60 },
    captionRules: "Short, punchy. Hook lives in the video — caption supports.",
    ctaRules: "On-screen CTA in last scene + soft CTA in caption.",
    hashtagBehavior: "few",
    needsImage: false,
    needsVideo: true,
    reviewRenderer: "reel_storyboard",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
    notes: "Storyboard scenes with hookFirstTwoSeconds, scenes[], cta.",
  },
  {
    contentType: "instagram_story",
    label: "Instagram Story",
    platform: "instagram",
    channelGroup: "social",
    mediaKind: "image",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    captionRules: "Text overlay on creative. Caption field unused.",
    ctaRules: "Tap / swipe / link sticker CTA. One per story.",
    hashtagBehavior: "minimal",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "story_creative",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },

  // ── Facebook ────────────────────────────────────────────────────────────
  {
    contentType: "facebook_post",
    label: "Facebook post",
    platform: "facebook",
    channelGroup: "social",
    mediaKind: "image",
    aspect: "1.91:1",
    recommendedSize: "1200x630",
    captionRules: "Friendly tone, can be longer than IG. Link previews work well.",
    ctaRules: "Link CTA / WhatsApp / Call.",
    hashtagBehavior: "minimal",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "image_post",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },
  {
    contentType: "facebook_reel",
    label: "Facebook Reel",
    platform: "facebook",
    channelGroup: "social",
    mediaKind: "video",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    durationSec: { min: 7, max: 90 },
    captionRules: "Short caption, hook in video.",
    ctaRules: "On-screen CTA.",
    hashtagBehavior: "few",
    needsImage: false,
    needsVideo: true,
    reviewRenderer: "reel_storyboard",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },

  // ── LinkedIn ────────────────────────────────────────────────────────────
  {
    contentType: "linkedin_post",
    label: "LinkedIn post",
    platform: "linkedin",
    channelGroup: "social",
    mediaKind: "image",
    aspect: "1.91:1",
    recommendedSize: "1200x627",
    captionRules: "Professional hook, useful insight, ~150–300 words. Line breaks for scannability.",
    ctaRules: "Soft CTA: comment / DM / link in profile / book a call.",
    hashtagBehavior: "few",
    needsImage: false,
    needsVideo: false,
    reviewRenderer: "social_post",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },
  {
    contentType: "linkedin_carousel",
    label: "LinkedIn document carousel",
    platform: "linkedin",
    channelGroup: "social",
    mediaKind: "carousel",
    aspect: "1:1",
    recommendedSize: "1080x1080",
    captionRules: "Caption frames the document. Slides = PDF pages with a clear narrative arc.",
    ctaRules: "Last-slide CTA + DM/comment ask in caption.",
    hashtagBehavior: "few",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "carousel",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
    notes: "Posted as a PDF document on LinkedIn; we export images per slide.",
  },

  // ── YouTube ─────────────────────────────────────────────────────────────
  {
    contentType: "youtube_short",
    label: "YouTube Short",
    platform: "youtube",
    channelGroup: "social",
    mediaKind: "video",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    durationSec: { min: 15, max: 60 },
    captionRules: "Title + short description. Title is the hook.",
    ctaRules: "On-screen CTA + subscribe ask in description.",
    hashtagBehavior: "few",
    needsImage: false,
    needsVideo: true,
    reviewRenderer: "reel_storyboard",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },
  {
    contentType: "youtube_thumbnail",
    label: "YouTube thumbnail",
    platform: "youtube",
    channelGroup: "social",
    mediaKind: "image",
    aspect: "16:9",
    recommendedSize: "1280x720",
    captionRules: "Big-text thumbnail. Description unused at this layer.",
    ctaRules: "Visual CTA only.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "thumbnail",
    scheduling: "manual_only",
    publish: "export_only",
  },

  // ── Blog / Newsletter / Website ─────────────────────────────────────────
  {
    contentType: "blog_article",
    label: "Blog / article",
    platform: "blog",
    channelGroup: "blog",
    mediaKind: "text",
    captionRules: "SEO title + meta description + body sections + FAQ. Optimized for Google + AI Overviews.",
    ctaRules: "In-body CTAs + closing CTA. One primary action.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "blog_article",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
    notes: "Publishes via blog_site_connections webhook to WordPress / Ghost / custom.",
  },
  {
    contentType: "newsletter_snippet",
    label: "Newsletter / email snippet",
    platform: "newsletter",
    channelGroup: "newsletter",
    mediaKind: "text",
    captionRules: "Subject line + preheader + body. Short, scannable.",
    ctaRules: "Primary CTA button copy + link.",
    hashtagBehavior: "none",
    needsImage: false,
    needsVideo: false,
    reviewRenderer: "newsletter_snippet",
    scheduling: "manual_only",
    publish: "export_only",
    notes: "Export to clipboard / Mailchimp / Beehiiv / etc. No direct API in Phase 50.",
  },
  {
    contentType: "website_banner",
    label: "Website banner / hero",
    platform: "website",
    channelGroup: "website",
    mediaKind: "image",
    aspect: "16:9",
    recommendedSize: "1920x800",
    captionRules: "Hero headline + sub-headline + CTA button copy.",
    ctaRules: "One primary CTA button.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "website_banner",
    scheduling: "manual_only",
    publish: "export_only",
  },

  // ── Google Business Profile ─────────────────────────────────────────────
  {
    contentType: "gbp_post",
    label: "Google Business Profile post",
    platform: "google_business",
    channelGroup: "local",
    mediaKind: "image",
    aspect: "1:1",
    recommendedSize: "1200x1200",
    captionRules: "1500-char limit. Front-load value. Local keywords if relevant.",
    ctaRules: "GBP action: Book / Order / Learn more / Sign up / Call.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "gbp_post",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
    notes: "GBP OAuth not wired in Phase 50; export/manual until connected.",
  },
  {
    contentType: "gbp_offer",
    label: "Google Business Profile offer / event post",
    platform: "google_business",
    channelGroup: "local",
    mediaKind: "image",
    aspect: "1:1",
    recommendedSize: "1200x1200",
    captionRules: "Offer title + terms + valid-from / valid-to dates.",
    ctaRules: "Redeem / Get offer / Book.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "gbp_post",
    scheduling: "event_pinned",
    publish: "api_when_connected",
  },

  // ── WhatsApp ────────────────────────────────────────────────────────────
  {
    contentType: "whatsapp_status_image",
    label: "WhatsApp Status (image)",
    platform: "whatsapp",
    channelGroup: "messaging",
    mediaKind: "image",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    captionRules: "Short overlay text on image. Caption field used as fallback share text.",
    ctaRules: "Tap / WhatsApp Click-to-Chat link as on-image CTA.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "whatsapp_status",
    scheduling: "manual_only",
    publish: "export_only",
    notes: "WhatsApp does not offer a public Status posting API. Always export / manual.",
  },
  {
    contentType: "whatsapp_status_video",
    label: "WhatsApp Status (video)",
    platform: "whatsapp",
    channelGroup: "messaging",
    mediaKind: "video",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    durationSec: { min: 5, max: 30 },
    captionRules: "Short, 5–30s. Hook in first 2s.",
    ctaRules: "On-screen CTA + share text.",
    hashtagBehavior: "none",
    needsImage: false,
    needsVideo: true,
    reviewRenderer: "whatsapp_status",
    scheduling: "manual_only",
    publish: "export_only",
  },
  {
    contentType: "whatsapp_broadcast",
    label: "WhatsApp broadcast / message",
    platform: "whatsapp",
    channelGroup: "messaging",
    mediaKind: "text",
    captionRules: "Short message copy for broadcast / DM. Personable, no hard sell.",
    ctaRules: "Single CTA: visit / book / reply.",
    hashtagBehavior: "none",
    needsImage: false,
    needsVideo: false,
    reviewRenderer: "review_request",
    scheduling: "manual_only",
    publish: "export_only",
  },

  // ── Ad creative ─────────────────────────────────────────────────────────
  {
    contentType: "ad_creative",
    label: "Ad creative",
    platform: "ad",
    channelGroup: "ad",
    mediaKind: "image",
    aspect: "1:1",
    recommendedSize: "1080x1080",
    captionRules: "Headline + primary text + description. Sharp, benefit-led.",
    ctaRules: "Single platform CTA (Shop now / Learn more / Sign up).",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "ad_creative",
    scheduling: "manual_only",
    publish: "export_only",
    notes: "Ad-platform delivery is out of scope; we produce ready-to-paste creatives.",
  },

  // ── Festival variants ───────────────────────────────────────────────────
  {
    contentType: "festival_post",
    label: "Festival post",
    platform: "instagram",
    channelGroup: "social",
    mediaKind: "image",
    aspect: "1:1",
    recommendedSize: "1080x1080",
    captionRules: "Festival-respectful tone, brand voice, short and warm.",
    ctaRules: "Soft CTA at most. Sometimes none.",
    hashtagBehavior: "few",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "image_post",
    scheduling: "event_pinned",
    publish: "api_when_connected",
  },
  {
    contentType: "festival_reel",
    label: "Festival Reel",
    platform: "instagram",
    channelGroup: "social",
    mediaKind: "video",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    durationSec: { min: 7, max: 30 },
    captionRules: "Short, warm, on-festival.",
    ctaRules: "On-screen CTA optional.",
    hashtagBehavior: "few",
    needsImage: false,
    needsVideo: true,
    reviewRenderer: "reel_storyboard",
    scheduling: "event_pinned",
    publish: "api_when_connected",
  },
  {
    contentType: "festival_status",
    label: "Festival WhatsApp Status / Story",
    platform: "whatsapp",
    channelGroup: "messaging",
    mediaKind: "image",
    aspect: "9:16",
    recommendedSize: "1080x1920",
    captionRules: "Greeting + brand mark, no hard CTA.",
    ctaRules: "Soft CTA only.",
    hashtagBehavior: "none",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "whatsapp_status",
    scheduling: "event_pinned",
    publish: "export_only",
  },

  // ── Local SEO + AI search ───────────────────────────────────────────────
  {
    contentType: "local_seo_content",
    label: "Local service / near-me content",
    platform: "website",
    channelGroup: "local",
    mediaKind: "text",
    captionRules: "City + service-area keywords + near-me questions answered.",
    ctaRules: "Call / WhatsApp / Get directions / Book.",
    hashtagBehavior: "none",
    needsImage: false,
    needsVideo: false,
    reviewRenderer: "local_seo",
    scheduling: "manual_only",
    publish: "export_only",
  },
  {
    contentType: "review_request",
    label: "Review request message",
    platform: "whatsapp",
    channelGroup: "messaging",
    mediaKind: "text",
    captionRules: "Short, polite, thanks + ask. Include the review link placeholder.",
    ctaRules: "One CTA: leave a review.",
    hashtagBehavior: "none",
    needsImage: false,
    needsVideo: false,
    reviewRenderer: "review_request",
    scheduling: "manual_only",
    publish: "export_only",
  },
  {
    contentType: "case_study_post",
    label: "Case study / portfolio post",
    platform: "linkedin",
    channelGroup: "social",
    mediaKind: "carousel",
    aspect: "1:1",
    recommendedSize: "1080x1080",
    captionRules: "Problem → approach → outcome arc. Concrete numbers if available.",
    ctaRules: "CTA: DM for similar work / link in profile.",
    hashtagBehavior: "few",
    needsImage: true,
    needsVideo: false,
    reviewRenderer: "carousel",
    scheduling: "scheduled_capable",
    publish: "api_when_connected",
  },
] as const;

// Convenience indexes.
const BY_TYPE = new Map<string, FormatDef>(FORMAT_MATRIX.map((f) => [f.contentType, f]));

export function getFormat(contentType: string | null | undefined): FormatDef | null {
  if (!contentType) return null;
  return BY_TYPE.get(contentType) ?? null;
}

export function isExportOnly(contentType: string | null | undefined): boolean {
  const f = getFormat(contentType);
  return f ? f.publish === "export_only" : false;
}

export function reviewRendererFor(contentType: string | null | undefined, fallback: FormatDef["reviewRenderer"] = "social_post"): FormatDef["reviewRenderer"] {
  return getFormat(contentType)?.reviewRenderer ?? fallback;
}

export function formatsForPlatform(platform: PlatformId): readonly FormatDef[] {
  return FORMAT_MATRIX.filter((f) => f.platform === platform);
}

// Set of formats that the one-click omnichannel pack always generates.
export const DEFAULT_OMNICHANNEL_PACK: readonly string[] = [
  "instagram_post",
  "instagram_carousel",
  "instagram_reel",
  "instagram_story",
  "facebook_post",
  "linkedin_post",
  "youtube_short",
  "youtube_thumbnail",
  "blog_article",
  "gbp_post",
  "whatsapp_status_image",
  "newsletter_snippet",
  "website_banner",
];
