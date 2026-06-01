// Phase 50 — 12 omnichannel skill configs.
// These are registered alongside the existing INITIAL_GLOBAL_SKILLS in
// routes/skills.ts. Each follows the same shape so the skill engine and
// quality gate can run them unchanged.

type SkillConfig = {
  skillId: string;
  version: string;
  displayName: string;
  category: string;
  config: Record<string, unknown>;
  isGlobal: true;
  isActive: true;
};

const OMNICHANNEL_CAMPAIGN_BUILDER: SkillConfig = {
  skillId: "omnichannel_campaign_builder",
  version: "1.0.0",
  displayName: "Omnichannel Campaign Builder",
  category: "campaign",
  config: {
    skill_id: "omnichannel_campaign_builder",
    version: "1.0.0",
    display_name: "Omnichannel Campaign Builder",
    category: "campaign",
    description: "From one topic, plan a full campaign pack: IG/FB/LinkedIn/YouTube/blog/GBP/WhatsApp/newsletter/website banner. Returns one container + per-format items.",
    required_memory: ["brand_dna", "content_rules", "recent_posts"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "trend_memory", "local_growth_memory"],
    input_schema: {
      type: "object",
      required: ["topic", "goal", "platforms", "formats"],
      properties: {
        topic: { type: "string" },
        goal: { type: "string", enum: ["awareness", "lead", "sale", "education", "launch", "festival", "engagement"] },
        audience: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        formats: { type: "array", items: { type: "string" } },
        cta: { type: "string" },
        suggestedSchedule: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["campaign", "items"],
      properties: {
        campaign: {
          type: "object",
          required: ["title", "goal", "channelMix", "suggestedSchedule"],
          properties: {
            title: { type: "string" },
            goal: { type: "string" },
            audience: { type: "string" },
            channelMix: { type: "array", items: { type: "string" } },
            suggestedSchedule: { type: "string" },
            aiVisibilityValue: { type: "string" },
            localValue: { type: "string" },
          },
        },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["contentType", "platform", "topic", "caption"],
            properties: {
              contentType: { type: "string" },
              platform: { type: "string" },
              topic: { type: "string" },
              caption: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
              cta: { type: "string" },
              imagePrompt: { type: "string" },
              thumbnailPrompt: { type: "string" },
              scenes: { type: "array" },
              slides: { type: "array" },
              suggestedAt: { type: "string" },
              notes: { type: "string" },
            },
          },
        },
      },
    },
    prompt_template:
      "You are planning a complete omnichannel campaign for the client below.\n\nTopic: {{topic}}\nGoal: {{goal}}\nAudience: {{audience}}\nPlatforms: {{platforms}}\nFormats to include: {{formats}}\nCTA preference: {{cta}}\nSuggested schedule: {{suggestedSchedule}}\n\nUse Brand DNA, AI Memory, Content Growth Rules, the active Storyline (if any), recent approved/rejected posts, trend memory, and local/AI-visibility memory. For each format produce ONE item that uses the right voice and length for that surface. Carousel items must include slides (headline + body). Reel/Short items must include scenes (hookFirstTwoSeconds, scenes[]). Blog items go to a blog_article item with seoTitle/metaDescription/sections/faq. Google Business Profile items must respect the 1500-char limit. WhatsApp Status items must use 9:16 visual design.\n\nNever invent contact details, prices, or commitments not present in Brand DNA. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.7,
      checks: ["brand_voice_match", "platform_fit", "channel_coverage", "no_repetition_across_items"],
    },
    provider_routing: {
      default_quality_mode: "deep",
      allow_fallback: true,
      max_tokens: 6400,
    },
    save_destination: { table: "campaigns", status: "draft" },
    memory_writeback: {
      on_approved: "Record approved campaign mix, hooks, and CTAs that work for this brand.",
      on_rejected: "Record rejected campaign angle so we avoid the pattern.",
    },
  },
  isGlobal: true,
  isActive: true,
};

const FESTIVAL_CAMPAIGN_BUILDER: SkillConfig = {
  skillId: "festival_campaign_builder",
  version: "1.0.0",
  displayName: "Festival Campaign Builder",
  category: "campaign",
  config: {
    skill_id: "festival_campaign_builder",
    version: "1.0.0",
    display_name: "Festival Campaign Builder",
    category: "campaign",
    description: "Builds a festival-respectful multi-format pack for a specific occasion: social post, carousel, reel, WhatsApp Status, optional GBP offer/event.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["story_memory", "image_style_memory", "local_growth_memory"],
    input_schema: {
      type: "object",
      required: ["occasion", "date", "platforms"],
      properties: {
        occasion: { type: "string" },
        date: { type: "string" },
        country: { type: "string" },
        city: { type: "string" },
        industry: { type: "string" },
        products: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        offer: { type: "string" },
        imagePreference: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["items"],
      properties: {
        suggestedAt: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["contentType", "platform", "caption"],
            properties: {
              contentType: { type: "string" },
              platform: { type: "string" },
              caption: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
              cta: { type: "string" },
              imagePrompt: { type: "string" },
              scenes: { type: "array" },
              slides: { type: "array" },
            },
          },
        },
      },
    },
    prompt_template:
      "Plan a festival-respectful content pack for {{occasion}} on {{date}}.\n\nClient: {{country}} / {{city}} — {{industry}}\nProducts/services: {{products}}\nPlatforms: {{platforms}}\nOffer (if any): {{offer}}\nImage preference: {{imagePreference}}\n\nRules:\n- Be culturally respectful. Greet, do not hard-sell.\n- Offers are optional. If absent, do not invent one.\n- Each item must match the format's voice (IG post, carousel, reel, WhatsApp Status, optional GBP offer/event).\n- Image prompts must describe background-only artwork without typography, watermark, or logo.\nReturn only JSON matching the output schema.",
    quality_gate: { min_score: 0.7, checks: ["brand_voice_match", "festival_respectful", "platform_fit"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 4000 },
    save_destination: { table: "campaigns", status: "draft" },
    memory_writeback: { on_approved: "Note which festival angle landed for this brand." },
  },
  isGlobal: true,
  isActive: true,
};

const TREND_RADAR_RESEARCHER: SkillConfig = {
  skillId: "trend_radar_researcher",
  version: "1.0.0",
  displayName: "Trend Radar Researcher",
  category: "research",
  config: {
    skill_id: "trend_radar_researcher",
    version: "1.0.0",
    display_name: "Trend Radar Researcher",
    category: "research",
    description: "Returns ranked trend cards: industry topics, local trends, festival/seasonal trends, news, content gaps, competitor-style angles, format-specific hooks.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["trend_memory", "performance_memory", "local_growth_memory"],
    input_schema: {
      type: "object",
      required: ["industry", "platforms"],
      properties: {
        industry: { type: "string" },
        country: { type: "string" },
        city: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        topicHint: { type: "string" },
        newsContext: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["trends"],
      properties: {
        trends: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "whyItMatters", "urgency", "platformFit", "contentAngle", "suggestedAction"],
            properties: {
              title: { type: "string" },
              whyItMatters: { type: "string" },
              urgency: { type: "string", enum: ["low", "medium", "high"] },
              platformFit: { type: "array", items: { type: "string" } },
              contentAngle: { type: "string" },
              reelHook: { type: "string" },
              carouselAngle: { type: "string" },
              blogAngle: { type: "string" },
              imageDirection: { type: "string" },
              audioMood: { type: "string" },
              aiVisibilityValue: { type: "string" },
              localValue: { type: "string" },
              suggestedAction: { type: "string", enum: ["post", "carousel", "reel", "blog", "campaign", "ignore"] },
            },
          },
        },
      },
    },
    prompt_template:
      "Generate a ranked trend radar for the client below.\n\nIndustry: {{industry}}\nCountry/City: {{country}} / {{city}}\nPlatforms in scope: {{platforms}}\nTopic hint (optional): {{topicHint}}\nFresh news context: {{newsContext}}\n\nReturn 6–10 trend cards covering: industry topics, local city trends, seasonal/festival trends, news, content gaps, competitor-style ideas, YouTube Shorts topics, Instagram/Reel hooks, LinkedIn authority topics, blog/AI-answer topics, hashtag ideas, audio mood suggestions.\n\nAudio mood is advisory only. NEVER claim a specific song is trending unless explicitly given in newsContext. Use Brand DNA + memory to pick angles that fit the brand. Return only JSON matching the output schema.",
    quality_gate: { min_score: 0.7, checks: ["brand_fit", "platform_fit", "freshness"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 3200 },
    save_destination: { table: "content_memory", key_prefix: "Trend Memory" },
    memory_writeback: { on_approved: "Save the trend angle that the user picked into trend memory." },
  },
  isGlobal: true,
  isActive: true,
};

const LOCAL_GROWTH_BOOSTER: SkillConfig = {
  skillId: "local_growth_booster",
  version: "1.0.0",
  displayName: "Local Growth Booster",
  category: "growth",
  config: {
    skill_id: "local_growth_booster",
    version: "1.0.0",
    display_name: "Local Growth Booster",
    category: "growth",
    description: "Produces local-SEO + AI-search outputs: service pages, FAQ, GBP posts, review request, city/service-area content, near-me Q&A, case studies, internal links, banners, competitor gap.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["local_growth_memory", "performance_memory"],
    input_schema: {
      type: "object",
      required: ["industry"],
      properties: {
        industry: { type: "string" },
        city: { type: "string" },
        serviceAreas: { type: "string" },
        services: { type: "string" },
        topQuestions: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["contentType", "title", "body"],
            properties: {
              contentType: { type: "string" },
              title: { type: "string" },
              body: { type: "string" },
              cta: { type: "string" },
              localKeywords: { type: "array", items: { type: "string" } },
              aiAnswerSummary: { type: "string" },
            },
          },
        },
      },
    },
    prompt_template:
      "Produce a local-growth + AI-search content pack for the client.\n\nIndustry: {{industry}}\nCity: {{city}}\nService areas: {{serviceAreas}}\nServices: {{services}}\nTop questions customers ask: {{topQuestions}}\n\nReturn items covering: local service pages, blog/FAQ, GBP posts, review request message, city/service-area pages, near-me Q&A, case study post, internal link suggestions, website banner ideas, AI-answer-ready summaries, competitor/content-gap ideas. Use contentTypes from the format matrix (local_seo_content, blog_article, gbp_post, review_request, website_banner, case_study_post). Never invent prices, certifications, or contact details. Return only JSON matching the output schema.",
    quality_gate: { min_score: 0.7, checks: ["brand_fit", "local_relevance", "no_invented_facts"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 4000 },
    save_destination: { table: "posts", content_type: "local_seo_content", status: "draft" },
    memory_writeback: { on_approved: "Capture which local angle the user kept." },
  },
  isGlobal: true,
  isActive: true,
};

const GBP_POST_BUILDER: SkillConfig = {
  skillId: "google_business_profile_post_builder",
  version: "1.0.0",
  displayName: "Google Business Profile Post Builder",
  category: "local",
  config: {
    skill_id: "google_business_profile_post_builder",
    version: "1.0.0",
    display_name: "Google Business Profile Post Builder",
    category: "local",
    description: "Builds a GBP update/news/offer/event post within the 1500-char limit. Picks the right action button copy.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["local_growth_memory"],
    input_schema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string" },
        postKind: { type: "string", enum: ["update", "offer", "event"] },
        offerTerms: { type: "string" },
        eventStart: { type: "string" },
        eventEnd: { type: "string" },
        targetCity: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["caption", "actionButton"],
      properties: {
        caption: { type: "string" },
        actionButton: { type: "string", enum: ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"] },
        actionUrl: { type: "string" },
        imagePrompt: { type: "string" },
        offerTitle: { type: "string" },
        eventTitle: { type: "string" },
        eventStart: { type: "string" },
        eventEnd: { type: "string" },
      },
    },
    prompt_template:
      "Write a Google Business Profile post.\n\nTopic: {{topic}}\nKind: {{postKind}}\nOffer terms (if offer): {{offerTerms}}\nEvent dates (if event): {{eventStart}} - {{eventEnd}}\nTarget city: {{targetCity}}\n\nRules:\n- Caption max 1500 chars. Front-load value.\n- Pick ONE action button from BOOK/ORDER/SHOP/LEARN_MORE/SIGN_UP/CALL.\n- Use Brand DNA and local keywords from Content Growth Rules. Never invent prices, hours, or contact details.\n- Image prompt must be background-only artwork without typography or logo.\nReturn only JSON matching the output schema.",
    quality_gate: { min_score: 0.72, checks: ["brand_voice_match", "gbp_length_limit", "no_invented_facts"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 1400 },
    save_destination: { table: "posts", content_type: "gbp_post", platform: "google_business", status: "draft" },
    memory_writeback: { on_approved: "Note which GBP action button + angle works for this brand." },
  },
  isGlobal: true,
  isActive: true,
};

const WHATSAPP_STATUS_EXPORT_BUILDER: SkillConfig = {
  skillId: "whatsapp_status_export_builder",
  version: "1.0.0",
  displayName: "WhatsApp Status Export Builder",
  category: "messaging",
  config: {
    skill_id: "whatsapp_status_export_builder",
    version: "1.0.0",
    display_name: "WhatsApp Status Export Builder",
    category: "messaging",
    description: "Builds a 9:16 WhatsApp Status creative + share caption + broadcast copy. Export only — WhatsApp has no public Status API.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["image_style_memory", "performance_memory"],
    input_schema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string" },
        offer: { type: "string" },
        targetAudience: { type: "string" },
        format: { type: "string", enum: ["image", "video"] },
      },
    },
    output_schema: {
      type: "object",
      required: ["onImageText", "shareCaption", "imagePrompt"],
      properties: {
        onImageText: { type: "string" },
        shareCaption: { type: "string" },
        broadcastCopy: { type: "string" },
        imagePrompt: { type: "string" },
        videoScenes: { type: "array" },
        clickToChatLinkHint: { type: "string" },
      },
    },
    prompt_template:
      "Build a WhatsApp Status export pack for {{topic}}.\n\nFormat: {{format}}\nOffer (optional): {{offer}}\nTarget audience: {{targetAudience}}\n\nRules:\n- 9:16 visual.\n- On-image text must be short (under 80 chars), high contrast, big.\n- Share caption is the message someone would forward.\n- Broadcast copy is a short DM/broadcast version with a single CTA.\n- Image prompt must be background-only, no typography overlay (we render the text).\nReturn only JSON matching the output schema.",
    quality_gate: { min_score: 0.7, checks: ["brand_voice_match", "concise_overlay_text"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 1200 },
    save_destination: { table: "posts", content_type: "whatsapp_status_image", platform: "whatsapp", status: "draft" },
    memory_writeback: { on_approved: "Record WhatsApp Status angle the user shipped." },
  },
  isGlobal: true,
  isActive: true,
};

const CAROUSEL_BUILDER: SkillConfig = {
  skillId: "carousel_builder",
  version: "1.0.0",
  displayName: "Carousel Builder",
  category: "carousel",
  config: {
    skill_id: "carousel_builder",
    version: "1.0.0",
    display_name: "Carousel Builder",
    category: "carousel",
    description: "Builds 5–10 carousel slides with hook → build → CTA arc. Works for IG carousel, LinkedIn document, case study.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["story_memory", "performance_memory"],
    input_schema: {
      type: "object",
      required: ["topic", "platform"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string", enum: ["instagram", "linkedin"] },
        slideCount: { type: "number" },
        angle: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["caption", "slides"],
      properties: {
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        cta: { type: "string" },
        slides: {
          type: "array",
          items: {
            type: "object",
            required: ["headline", "bodyCopy"],
            properties: {
              headline: { type: "string" },
              bodyCopy: { type: "string" },
              role: { type: "string", enum: ["hook", "build", "proof", "cta"] },
              imagePrompt: { type: "string" },
            },
          },
        },
      },
    },
    prompt_template:
      "Build a {{slideCount}}-slide carousel for {{platform}}.\n\nTopic: {{topic}}\nAngle: {{angle}}\n\nSlide arc: 1 = hook, 2..N-1 = build/proof, last = CTA. LinkedIn carousels are denser; Instagram more visual. Use Brand DNA + Content Growth Rules. Return only JSON matching the output schema.",
    quality_gate: { min_score: 0.72, checks: ["brand_voice_match", "platform_fit", "carousel_arc"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 3200 },
    save_destination: { table: "posts", content_type: "instagram_carousel", status: "draft" },
    memory_writeback: { on_approved: "Save the hook + carousel structure that worked." },
  },
  isGlobal: true,
  isActive: true,
};

const REEL_STORYBOARD_BUILDER: SkillConfig = {
  skillId: "reel_storyboard_builder",
  version: "1.0.0",
  displayName: "Reel Storyboard Builder",
  category: "reel",
  config: {
    skill_id: "reel_storyboard_builder",
    version: "1.0.0",
    display_name: "Reel Storyboard Builder",
    category: "reel",
    description: "Builds a Reel/Short storyboard: hookFirstTwoSeconds, scenes, on-screen text, voiceover, b-roll suggestions, CTA, audio mood.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["story_memory", "performance_memory"],
    input_schema: {
      type: "object",
      required: ["topic", "platform"],
      properties: {
        topic: { type: "string" },
        platform: { type: "string", enum: ["instagram", "facebook", "youtube"] },
        durationSec: { type: "number" },
        angle: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["caption", "hookFirstTwoSeconds", "scenes", "cta"],
      properties: {
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        hookFirstTwoSeconds: { type: "string" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            required: ["onScreenText"],
            properties: {
              onScreenText: { type: "string" },
              voiceover: { type: "string" },
              broll: { type: "string" },
              durationSec: { type: "number" },
            },
          },
        },
        cta: { type: "string" },
        audioMood: { type: "string" },
        thumbnailPrompt: { type: "string" },
      },
    },
    prompt_template:
      "Build a Reel/Short storyboard for {{platform}}.\n\nTopic: {{topic}}\nDuration target: {{durationSec}}s\nAngle: {{angle}}\n\nRules:\n- hookFirstTwoSeconds must shock or promise payoff in <2 seconds.\n- 4–8 scenes. Each scene has onScreenText (short) + optional voiceover/broll/durationSec.\n- audioMood is advisory only. NEVER name a specific trending song unless given in input.\n- Thumbnail prompt for YouTube is background-only.\nReturn only JSON matching the output schema.",
    quality_gate: { min_score: 0.72, checks: ["hook_strength", "brand_voice_match", "scene_pacing"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 2800 },
    save_destination: { table: "posts", content_type: "instagram_reel", status: "draft" },
    memory_writeback: { on_approved: "Save the hook style + scene arc that worked." },
  },
  isGlobal: true,
  isActive: true,
};

const BLOG_ANSWER_ENGINE_WRITER: SkillConfig = {
  skillId: "blog_answer_engine_writer",
  version: "1.0.0",
  displayName: "Blog / Answer-Engine Writer",
  category: "blog",
  config: {
    skill_id: "blog_answer_engine_writer",
    version: "1.0.0",
    display_name: "Blog / Answer-Engine Writer",
    category: "blog",
    description: "Writes a blog optimized for Google + AI Overviews + AI search: clear question-answer structure, schema markup, FAQ.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["local_growth_memory", "trend_memory"],
    input_schema: {
      type: "object",
      required: ["keyword"],
      properties: {
        keyword: { type: "string" },
        tone: { type: "string" },
        wordCount: { type: "number" },
        targetCity: { type: "string" },
        topQuestions: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["seoTitle", "metaDescription", "slug", "sections", "faq", "fullDraft"],
      properties: {
        seoTitle: { type: "string" },
        metaDescription: { type: "string" },
        slug: { type: "string" },
        excerpt: { type: "string" },
        sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, content: { type: "string" } } } },
        faq: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } } } },
        fullDraft: { type: "string" },
        schemaMarkup: { type: "object" },
        targetKeywords: { type: "array", items: { type: "string" } },
        cta: { type: "string" },
        canonicalUrl: { type: "string" },
        heroImageUrl: { type: "string" },
        estimatedReadTime: { type: "string" },
      },
    },
    prompt_template:
      "Write a blog post optimized for both human readers and AI answer engines (Google AI Overviews, ChatGPT, Perplexity, Gemini).\n\nKeyword/topic: {{keyword}}\nTone: {{tone}}\nWord count target: {{wordCount}}\nTarget city: {{targetCity}}\nTop questions: {{topQuestions}}\n\nRules:\n- Each section should answer one specific question.\n- FAQ array: 5–8 Q/A pairs with concise, citable answers.\n- schemaMarkup: JSON-LD object suitable for paste into <script type=\\\"application/ld+json\\\">.\n- Use Brand DNA + Content Growth Rules. Never invent stats or facts.\nReturn only JSON matching the output schema.",
    quality_gate: { min_score: 0.74, checks: ["brand_voice_match", "answer_engine_readiness", "no_invented_facts"] },
    provider_routing: { default_quality_mode: "deep", allow_fallback: true, max_tokens: 6400 },
    save_destination: { table: "posts", content_type: "blog_article", platform: "blog", post_type: "blog", status: "draft" },
    memory_writeback: { on_approved: "Save the angle and FAQ patterns that worked." },
  },
  isGlobal: true,
  isActive: true,
};

const CONTENT_REPURPOSER: SkillConfig = {
  skillId: "content_repurposer",
  version: "1.0.0",
  displayName: "Content Repurposer",
  category: "repurpose",
  config: {
    skill_id: "content_repurposer",
    version: "1.0.0",
    display_name: "Content Repurposer",
    category: "repurpose",
    description: "Repurposes one approved item into N other formats (e.g. blog → reel + carousel + LinkedIn + IG).",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["story_memory", "performance_memory"],
    input_schema: {
      type: "object",
      required: ["sourcePostId", "targetFormats"],
      properties: {
        sourcePostId: { type: "string" },
        targetFormats: { type: "array", items: { type: "string" } },
      },
    },
    output_schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["contentType", "platform", "topic", "caption"],
            properties: {
              contentType: { type: "string" },
              platform: { type: "string" },
              topic: { type: "string" },
              caption: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
              cta: { type: "string" },
              scenes: { type: "array" },
              slides: { type: "array" },
              imagePrompt: { type: "string" },
            },
          },
        },
      },
    },
    prompt_template:
      "Repurpose the source draft into the target formats.\n\nSource post ID: {{sourcePostId}}\nTarget formats: {{targetFormats}}\n\nKeep the strategic message. Reshape voice, length, and CTA per format using the omnichannel format matrix rules. Reels/Shorts must have hookFirstTwoSeconds; carousels must have slide arcs; blogs must have FAQ. Return only JSON matching the output schema.",
    quality_gate: { min_score: 0.7, checks: ["brand_voice_match", "platform_fit", "no_verbatim_copy_across_formats"] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 4800 },
    save_destination: { table: "posts", status: "draft" },
    memory_writeback: { on_approved: "Note which repurposed formats survive Review." },
  },
  isGlobal: true,
  isActive: true,
};

const CREATIVE_QUALITY_REVIEWER: SkillConfig = {
  skillId: "creative_quality_reviewer",
  version: "1.0.0",
  displayName: "Creative Quality Reviewer",
  category: "quality",
  config: {
    skill_id: "creative_quality_reviewer",
    version: "1.0.0",
    display_name: "Creative Quality Reviewer",
    category: "quality",
    description: "Reviews any Review item across brand match, CTA strength, platform fit, caption quality, hashtags, grammar, AI Visibility value, local/Maps value, reel hook strength, carousel slide flow, blog answer-engine readiness, image/video prompt quality, WhatsApp suitability.",
    required_memory: ["brand_dna", "content_rules", "recent_posts"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "image_style_memory"],
    input_schema: {
      type: "object",
      required: ["postId", "contentType", "platform"],
      properties: {
        postId: { type: "string" },
        contentType: { type: "string" },
        platform: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "string" },
        imagePrompt: { type: "string" },
        contentSchema: { type: "object" },
      },
    },
    output_schema: {
      type: "object",
      required: ["overall", "verdict", "checks"],
      properties: {
        overall: { type: "string", enum: ["good", "needs_review", "weak"] },
        verdict: { type: "string", enum: ["approve", "improve", "reject"] },
        score: { type: "number", minimum: 0, maximum: 100 },
        checks: {
          type: "array",
          items: {
            type: "object",
            required: ["key", "status", "note"],
            properties: {
              key: { type: "string" },
              status: { type: "string", enum: ["good", "needs_review", "weak"] },
              note: { type: "string" },
            },
          },
        },
        suggestions: { type: "array", items: { type: "string" } },
        revisedCaption: { type: "string" },
      },
    },
    prompt_template:
      "Review this draft across all relevant quality checks for its content type.\n\nPost ID: {{postId}}\nContent type: {{contentType}}\nPlatform: {{platform}}\nCaption:\n{{caption}}\nHashtags: {{hashtags}}\nImage/artwork prompt: {{imagePrompt}}\nContent schema:\n{{contentSchema}}\n\nChecks (use the keys exactly):\n- brand_match\n- cta_strength\n- platform_fit\n- caption_quality\n- hashtags\n- grammar\n- ai_visibility_value\n- local_value\n- reel_hook_strength (only if contentType is a reel/short)\n- carousel_flow (only if contentType is a carousel)\n- blog_answer_engine (only if contentType is a blog)\n- image_video_prompt_quality\n- whatsapp_suitability (only if contentType is whatsapp_*)\n\nReturn only JSON matching the output schema. Verdict 'approve' = good; 'improve' = needs_review with suggestions; 'reject' = weak with reason. Do not block — this is advisory.",
    quality_gate: { min_score: 0, checks: [] },
    provider_routing: { default_quality_mode: "balanced", allow_fallback: true, max_tokens: 2400 },
    save_destination: { table: "quality_checks", status: "reviewed" },
    memory_writeback: {},
  },
  isGlobal: true,
  isActive: true,
};

const SOCIAL_CAPTION_OPTIMIZER: SkillConfig = {
  skillId: "social_caption_optimizer",
  version: "1.0.0",
  displayName: "Social Caption Optimizer",
  category: "social_post",
  config: {
    skill_id: "social_caption_optimizer",
    version: "1.0.0",
    display_name: "Social Caption Optimizer",
    category: "social_post",
    description: "Rewrites a caption to be tighter, hookier, more on-brand for a target platform.",
    required_memory: ["brand_dna", "content_rules"],
    optional_memory: ["performance_memory", "rejection_memory"],
    input_schema: {
      type: "object",
      required: ["caption", "platform"],
      properties: {
        caption: { type: "string" },
        platform: { type: "string", enum: ["instagram", "facebook", "linkedin", "twitter"] },
        goal: { type: "string" },
      },
    },
    output_schema: {
      type: "object",
      required: ["caption", "hashtags", "cta", "changesMade"],
      properties: {
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        cta: { type: "string" },
        changesMade: { type: "array", items: { type: "string" } },
      },
    },
    prompt_template:
      "Optimize this caption for {{platform}} ({{goal}}).\n\nOriginal:\n{{caption}}\n\nKeep the strategic idea. Apply platform best practices, Brand DNA, Content Growth Rules. Use the platform's typical hashtag density. Return only JSON matching the output schema.",
    quality_gate: { min_score: 0.7, checks: ["brand_voice_match", "platform_fit"] },
    provider_routing: { default_quality_mode: "fast", allow_fallback: true, max_tokens: 1200 },
    save_destination: { table: "posts", status: "draft" },
    memory_writeback: { on_approved: "Save accepted caption patterns." },
  },
  isGlobal: true,
  isActive: true,
};

export const PHASE_50_SKILLS = [
  OMNICHANNEL_CAMPAIGN_BUILDER,
  FESTIVAL_CAMPAIGN_BUILDER,
  TREND_RADAR_RESEARCHER,
  LOCAL_GROWTH_BOOSTER,
  GBP_POST_BUILDER,
  WHATSAPP_STATUS_EXPORT_BUILDER,
  CAROUSEL_BUILDER,
  REEL_STORYBOARD_BUILDER,
  BLOG_ANSWER_ENGINE_WRITER,
  CONTENT_REPURPOSER,
  CREATIVE_QUALITY_REVIEWER,
  SOCIAL_CAPTION_OPTIMIZER,
];
