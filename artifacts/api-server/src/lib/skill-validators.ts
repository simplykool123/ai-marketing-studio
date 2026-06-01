// Phase 51 — Per-skill output validators.
// Each validator returns null when the object is acceptable, or a short string
// describing the problem. The skill engine surfaces the validation failure
// via SkillEngineError(422) after one repair attempt, so the user gets a
// clean retryable error instead of saving broken drafts.

export type Validator = (obj: Record<string, unknown>) => string | null;

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
function isObject(v: unknown): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isArray(v: unknown, min = 0): boolean {
  return Array.isArray(v) && v.length >= min;
}

const VALIDATORS: Record<string, Validator> = {
  omnichannel_campaign_builder: (o) => {
    if (!isObject(o.campaign)) return "campaign object missing";
    if (!isNonEmptyString((o.campaign as Record<string, unknown>).title)) return "campaign.title missing";
    if (!isArray(o.items, 1)) return "items[] must contain at least one entry";
    for (const item of o.items as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(item.contentType)) return "items[].contentType missing";
      if (!isNonEmptyString(item.caption) && !isNonEmptyString(item.topic)) return "items[] needs caption or topic";
    }
    return null;
  },
  festival_campaign_builder: (o) => {
    if (!isArray(o.items, 1)) return "items[] must contain at least one entry";
    for (const item of o.items as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(item.contentType)) return "items[].contentType missing";
      if (!isNonEmptyString(item.caption)) return "items[].caption missing";
    }
    return null;
  },
  trend_radar_researcher: (o) => {
    if (!isArray(o.trends, 1)) return "trends[] must contain at least one entry";
    for (const t of o.trends as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(t.title)) return "trends[].title missing";
      if (!isNonEmptyString(t.whyItMatters)) return "trends[].whyItMatters missing";
    }
    return null;
  },
  local_growth_booster: (o) => {
    if (!isArray(o.items, 1)) return "items[] must contain at least one entry";
    for (const item of o.items as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(item.contentType)) return "items[].contentType missing";
      if (!isNonEmptyString(item.title) && !isNonEmptyString(item.body)) return "items[] needs title or body";
    }
    return null;
  },
  google_business_profile_post_builder: (o) => {
    if (!isNonEmptyString(o.caption)) return "caption missing";
    if (!isNonEmptyString(o.actionButton)) return "actionButton missing";
    if ((o.caption as string).length > 1500) return "caption exceeds 1500 char GBP limit";
    return null;
  },
  whatsapp_status_export_builder: (o) => {
    if (!isNonEmptyString(o.onImageText)) return "onImageText missing";
    if (!isNonEmptyString(o.shareCaption)) return "shareCaption missing";
    if (!isNonEmptyString(o.imagePrompt)) return "imagePrompt missing";
    return null;
  },
  carousel_builder: (o) => {
    if (!isArray(o.slides, 3)) return "slides[] must contain at least 3 slides";
    for (const s of o.slides as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(s.headline) && !isNonEmptyString(s.bodyCopy)) return "slides[] needs headline or bodyCopy";
    }
    return null;
  },
  reel_storyboard_builder: (o) => {
    if (!isNonEmptyString(o.hookFirstTwoSeconds)) return "hookFirstTwoSeconds missing";
    if (!isArray(o.scenes, 2)) return "scenes[] must contain at least 2 scenes";
    for (const s of o.scenes as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(s.onScreenText)) return "scenes[].onScreenText missing";
    }
    if (!isNonEmptyString(o.cta)) return "cta missing";
    return null;
  },
  blog_answer_engine_writer: (o) => {
    if (!isNonEmptyString(o.seoTitle)) return "seoTitle missing";
    if (!isNonEmptyString(o.metaDescription)) return "metaDescription missing";
    if (!isNonEmptyString(o.slug)) return "slug missing";
    if (!isArray(o.sections, 2)) return "sections[] needs at least 2 entries";
    if (!isArray(o.faq, 2)) return "faq[] needs at least 2 entries";
    if (!isNonEmptyString(o.fullDraft)) return "fullDraft missing";
    return null;
  },
  content_repurposer: (o) => {
    if (!isArray(o.items, 1)) return "items[] must contain at least one entry";
    return null;
  },
  creative_quality_reviewer: (o) => {
    if (!isNonEmptyString(o.overall)) return "overall missing";
    if (!isNonEmptyString(o.verdict)) return "verdict missing";
    if (!isArray(o.checks, 1)) return "checks[] must contain at least one entry";
    return null;
  },
  social_caption_optimizer: (o) => {
    if (!isNonEmptyString(o.caption)) return "caption missing";
    if (!isArray(o.changesMade)) return "changesMade[] missing";
    return null;
  },
  // Phase 51A — strict-JSON migrations of the four remaining text-mode routes.
  creative_prompt_prep: (o) => {
    if (!isNonEmptyString(o.improvedPrompt)) return "improvedPrompt missing";
    return null;
  },
  creative_concepts: (o) => {
    if (!isArray(o.concepts, 1)) return "concepts[] must contain at least one concept";
    for (const c of o.concepts as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(c.imagePrompt)) return "concepts[].imagePrompt missing";
    }
    return null;
  },
  campaign_pack_builder: (o) => {
    if (!isNonEmptyString(o.campaignName)) return "campaignName missing";
    if (!isObject(o.instagramCarousel)) return "instagramCarousel missing";
    if (!isObject(o.reelStoryboard)) return "reelStoryboard missing";
    return null;
  },
  growth_boost: (o) => {
    if (!isNonEmptyString(o.summary)) return "summary missing";
    if (!isArray(o.growthOpportunities, 1)) return "growthOpportunities[] must contain at least one entry";
    if (!isObject(o.recommendedNextCampaign)) return "recommendedNextCampaign missing";
    return null;
  },
  suggest_brand_fields: (o) => {
    // Allow empty strings (model is told to return empty when context insufficient),
    // but enforce that the four expected keys exist as strings.
    for (const key of ["seoKeywords", "preferredHashtags", "defaultCta", "localKeywords"]) {
      if (typeof o[key] !== "string") return `${key} must be a string`;
    }
    return null;
  },
  video_script: (o) => {
    if (!isNonEmptyString(o.hook)) return "hook missing";
    if (!isArray(o.scenes, 2)) return "scenes[] must contain at least 2 scenes";
    if (!isNonEmptyString(o.cta)) return "cta missing";
    for (const s of o.scenes as Array<Record<string, unknown>>) {
      if (!isNonEmptyString(s.visual) && !isNonEmptyString(s.text) && !isNonEmptyString(s.voiceover)) {
        return "scenes[] needs visual, text, or voiceover";
      }
    }
    return null;
  },
  ai_visibility_analysis: (o) => {
    if (!isArray(o.customerQuestions, 1)) return "customerQuestions[] must contain at least one entry";
    if (!isArray(o.faqIdeas, 1)) return "faqIdeas[] must contain at least one entry";
    return null;
  },
  ai_visibility_campaign: (o) => {
    if (!isNonEmptyString(o.campaignName)) return "campaignName missing";
    // The campaign builder produces multiple deliverables. Require at least one
    // of the core asset categories to be present and non-empty.
    const hasBlog = isObject(o.blogOutline);
    const hasCarousel = isObject(o.carousel);
    const hasReel = isObject(o.reel);
    const hasLinkedIn = isArray(o.linkedInPosts, 1);
    const hasInstagram = isArray(o.instagramPosts, 1);
    if (!hasBlog && !hasCarousel && !hasReel && !hasLinkedIn && !hasInstagram) {
      return "campaign needs at least one of blogOutline, carousel, reel, linkedInPosts, or instagramPosts";
    }
    return null;
  },
  // Legacy / earlier-phase skills — keep light validators so they still benefit
  // from the repair retry without rejecting their existing outputs.
  platform_rewrite: (o) => (isNonEmptyString(o.caption) ? null : "caption missing"),
  occasion_artwork: (o) => (isNonEmptyString(o.caption) || isNonEmptyString(o.imagePrompt) ? null : "caption or imagePrompt missing"),
  quality_review: (o) => (isNonEmptyString((o as Record<string, unknown>).verdict) ? null : "verdict missing"),
  content_quality_reviewer: (o) => (isNonEmptyString((o as Record<string, unknown>).verdict) ? null : "verdict missing"),
  social_post_creator: (o) => (isNonEmptyString(o.caption) ? null : "caption missing"),
  instagram_carousel_builder: (o) => (isArray(o.slides, 3) ? null : "slides[] needs 3+ entries"),
  seo_blog_writer: (o) => (isNonEmptyString(o.fullDraft) ? null : "fullDraft missing"),
  short_video_reel_script: (o) => (isArray(o.scenes, 2) ? null : "scenes[] needs 2+ entries"),
};

export function validatorForSkill(skillId: string): Validator | undefined {
  return VALIDATORS[skillId];
}
