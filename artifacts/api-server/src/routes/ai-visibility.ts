import { Router } from "express";
import type { Response } from "express";
import { db } from "@workspace/db";
import { brandDnaTable, contentMemoryTable, postsTable, brandAssetsTable, clientsTable, campaignsTable, campaignOutputsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateJsonWithFallback, JsonParseError } from "../lib/ai-json.js";
import { validatorForSkill } from "../lib/skill-validators.js";
import { requireClientRole, type AuthRequest } from "../middleware/auth.js";

const router = Router();

// AI Visibility Analysis
router.post(
  "/clients/:clientId/ai-visibility/analyze",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res: Response) => {
  try {
    const { clientId } = req.params;
    const { topic } = req.body;

    // Fetch brand data
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    const [dna] = await db.select().from(brandDnaTable).where(eq(brandDnaTable.clientId, clientId));
    const memory = await db.select().from(contentMemoryTable).where(eq(contentMemoryTable.clientId, clientId));
    const recentPosts = await db.select().from(postsTable)
      .where(eq(postsTable.clientId, clientId))
      .orderBy(desc(postsTable.createdAt))
      .limit(10);

    // Calculate AI Visibility Score
    const score = calculateVisibilityScore(client, dna, memory, recentPosts);

    // Generate AI analysis
    const prompt = `You are an AI Visibility strategist analyzing a brand for modern discoverability across:
- SEO (Google search)
- AEO (Answer Engine Optimization)
- GEO (Generative Engine Optimization for ChatGPT/Gemini/Perplexity/Grok)
- Social Search (Instagram/YouTube/LinkedIn)
- Brand Authority (trust, proof, case studies)

Brand: ${client?.name || 'Unknown'}
${dna ? `
Brand DNA:
- Tone: ${dna.voiceTone}
- Target Audience: ${dna.targetAudience}
- Industry: ${dna.industry}
- Brand Values: ${dna.brandValues}
- Visual Style: ${dna.visualStyle}
` : ''}

${topic ? `Focus Topic: ${topic}` : ''}

Recent Content: ${recentPosts.length} posts in last period

Analyze and provide:

1. Customer Questions (5-7 questions people ask AI about this brand/industry)
2. FAQ Ideas (5 essential FAQs)
3. Comparison Topics (3 "vs" or "best for" topics)
4. Local Search Topics (3 location-based topics if applicable)
5. Trust/Proof Gaps (what's missing for credibility)
6. Content Gap Ideas (3 topics competitors cover but this brand doesn't)
7. Blog/Article Ideas (3 answer-ready topics)
8. LinkedIn Authority Post Ideas (2 thought leadership topics)
9. Instagram Content Ideas (2 carousel + 2 reel ideas)
10. Image Prompt Directions (3 visual concepts that build authority)

Format as JSON:
{
  "customerQuestions": ["question1", ...],
  "faqIdeas": [{"question": "...", "answerDirection": "..."}],
  "comparisonTopics": ["topic1", ...],
  "localSearchTopics": ["topic1", ...],
  "trustGaps": ["gap1", ...],
  "contentGaps": ["gap1", ...],
  "blogIdeas": [{"title": "...", "outline": "..."}],
  "linkedInIdeas": [{"topic": "...", "angle": "..."}],
  "instagramIdeas": {
    "carousels": [{"title": "...", "slides": "..."}],
    "reels": [{"concept": "...", "hook": "...", "storyboard": "..."}]
  },
  "imagePrompts": [{"concept": "...", "prompt": "...", "purpose": "..."}]
}`;

    try {
      const { object: parsedAnalysis, usedProvider, usedModel, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        prompt,
        maxTokens: 4000,
        userId: req.userId,
        schemaName: "ai_visibility_analysis",
        validate: validatorForSkill("ai_visibility_analysis"),
      });

      res.json({
        score,
        analysis: parsedAnalysis,
        recommendations: generateRecommendations(score),
        meta: { provider: usedProvider, model: usedModel, fallbackUsed, repairUsed },
      });
    } catch (innerErr) {
      if (innerErr instanceof JsonParseError) {
        console.error("AI Visibility analysis JSON failure:", innerErr.message);
        res.status(422).json({ error: "AI could not produce a valid AI Visibility analysis. Please retry." });
        return;
      }
      throw innerErr;
    }
  } catch (error: any) {
    console.error("AI Visibility analysis error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate AI Visibility Campaign
router.post(
  "/clients/:clientId/ai-visibility/generate-campaign",
  requireClientRole(["owner", "admin", "editor"]),
  async (req: AuthRequest, res: Response) => {
  try {
    const { clientId } = req.params;
    const { topic, analysis } = req.body;

    // Fetch brand data
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    const [dna] = await db.select().from(brandDnaTable).where(eq(brandDnaTable.clientId, clientId));
    const assets = await db.select().from(brandAssetsTable).where(eq(brandAssetsTable.clientId, clientId));

    const hasLogo = assets.some(a => a.assetType === 'logo');
    const brandColors = [dna?.primaryColor, dna?.secondaryColor, dna?.accentColor].filter(Boolean);

    const prompt = `You are creating an AI Visibility Campaign for ${client?.name || 'this brand'}.

Brand DNA:
${dna ? `
- Tone: ${dna.voiceTone}
- Target Audience: ${dna.targetAudience}
- Industry: ${dna.industry}
- Brand Values: ${dna.brandValues}
- Visual Style: ${dna.visualStyle}
- Brand Colors: ${brandColors.join(', ') || 'Not specified'}
- Has Logo: ${hasLogo ? 'Yes' : 'No'}
` : ''}

Topic: ${topic || 'General brand visibility'}

Previous Analysis:
${JSON.stringify(analysis, null, 2)}

Create a comprehensive campaign pack with:

1. One Answer-Ready Blog/Article Outline (800-1200 words)
   - SEO-optimized title
   - Meta description
   - H2/H3 structure
   - Key points to cover
   - FAQ section
   - CTA

2. Five FAQs (question + detailed answer)

3. Two LinkedIn Authority Posts
   - Hook
   - Main content
   - CTA
   - Hashtags

4. Two Instagram Posts
   - Caption
   - Hashtags
   - CTA
   - Image concept

5. One Carousel Outline (5-7 slides)
   - Cover slide
   - Content slides
   - CTA slide

6. One Reel Storyboard
   - Hook (first 3 seconds)
   - Main content (scenes)
   - CTA
   - Audio suggestion

7. Three Image Prompt Directions
   - Concept
   - Detailed prompt for AI image generation
   - Brand color integration
   - Platform optimization

8. Suggested Posting Schedule (next 2 weeks)

Format as JSON:
{
  "campaignName": "...",
  "blogOutline": {...},
  "faqs": [{...}],
  "linkedInPosts": [{...}],
  "instagramPosts": [{...}],
  "carousel": {...},
  "reel": {...},
  "imagePrompts": [{...}],
  "schedule": [{...}]
}`;

    try {
      const { object: parsedCampaign, usedProvider, usedModel, fallbackUsed, repairUsed } = await generateJsonWithFallback({
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        prompt,
        maxTokens: 6000,
        userId: req.userId,
        schemaName: "ai_visibility_campaign",
        validate: validatorForSkill("ai_visibility_campaign"),
      });

      res.json({
        campaign: parsedCampaign,
        meta: { provider: usedProvider, model: usedModel, fallbackUsed, repairUsed },
      });
    } catch (innerErr) {
      if (innerErr instanceof JsonParseError) {
        console.error("AI Visibility campaign JSON failure:", innerErr.message);
        res.status(422).json({ error: "AI could not produce a valid AI Visibility campaign. Please retry." });
        return;
      }
      throw innerErr;
    }
  } catch (error: any) {
    console.error("Campaign generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Calculate AI Visibility Score
function calculateVisibilityScore(client: any, dna: any, memory: any[], recentPosts: any[]) {
  let score = 0;
  const checks: any[] = [];

  // Website exists (10 points)
  if (client?.website) {
    score += 10;
    checks.push({ check: "Website exists", status: "pass" });
  } else {
    checks.push({ check: "Website exists", status: "fail" });
  }

  // Services/products clear (10 points)
  if (dna?.industry && dna.industry.length > 5) {
    score += 10;
    checks.push({ check: "Services/products clear", status: "pass" });
  } else {
    checks.push({ check: "Services/products clear", status: "fail" });
  }

  // Location/service area clear (10 points)
  if (client?.location) {
    score += 10;
    checks.push({ check: "Location/service area clear", status: "pass" });
  } else {
    checks.push({ check: "Location/service area clear", status: "fail" });
  }

  // Contact exists (10 points)
  if (client?.email || client?.phone) {
    score += 10;
    checks.push({ check: "Contact info exists", status: "pass" });
  } else {
    checks.push({ check: "Contact info exists", status: "fail" });
  }

  // CTA exists (10 points)
  if (dna?.campaignGoals) {
    score += 10;
    checks.push({ check: "CTA exists", status: "pass" });
  } else {
    checks.push({ check: "CTA exists", status: "fail" });
  }

  // FAQs exist (10 points)
  const hasFAQs = memory.some(m => m.key?.includes('faq') || m.key?.includes('question'));
  if (hasFAQs) {
    score += 10;
    checks.push({ check: "FAQs exist", status: "pass" });
  } else {
    checks.push({ check: "FAQs exist", status: "fail" });
  }

  // Portfolio/case studies (10 points)
  const hasPortfolio = memory.some(m => m.key?.includes('portfolio') || m.key?.includes('case'));
  if (hasPortfolio) {
    score += 10;
    checks.push({ check: "Portfolio/case studies exist", status: "pass" });
  } else {
    checks.push({ check: "Portfolio/case studies exist", status: "fail" });
  }

  // Testimonials/reviews (10 points)
  const hasTestimonials = memory.some(m => m.key?.includes('testimonial') || m.key?.includes('review'));
  if (hasTestimonials) {
    score += 10;
    checks.push({ check: "Testimonials/reviews exist", status: "pass" });
  } else {
    checks.push({ check: "Testimonials/reviews exist", status: "fail" });
  }

  // Social proof (10 points)
  if (dna?.socialProof || memory.some(m => m.key?.includes('social'))) {
    score += 10;
    checks.push({ check: "Social proof exists", status: "pass" });
  } else {
    checks.push({ check: "Social proof exists", status: "fail" });
  }

  // Recent posts (10 points)
  if (recentPosts.length >= 5) {
    score += 10;
    checks.push({ check: "Recent posts exist", status: "pass" });
  } else {
    checks.push({ check: "Recent posts exist", status: "fail" });
  }

  // Determine rating
  let rating: "strong" | "needs_work" | "weak";
  if (score >= 70) rating = "strong";
  else if (score >= 40) rating = "needs_work";
  else rating = "weak";

  return {
    score,
    rating,
    checks,
    maxScore: 100,
  };
}

// Helper: Generate recommendations
function generateRecommendations(score: any) {
  const recommendations: string[] = [];

  score.checks.forEach((check: any) => {
    if (check.status === "fail") {
      switch (check.check) {
        case "Website exists":
          recommendations.push("Add your website URL to Brand DNA");
          break;
        case "Services/products clear":
          recommendations.push("Clearly define your services/products in Brand DNA");
          break;
        case "Location/service area clear":
          recommendations.push("Add your location or service areas");
          break;
        case "Contact info exists":
          recommendations.push("Add contact information (WhatsApp, email, phone)");
          break;
        case "CTA exists":
          recommendations.push("Define a clear call-to-action");
          break;
        case "FAQs exist":
          recommendations.push("Create FAQ content in Memory");
          break;
        case "Portfolio/case studies exist":
          recommendations.push("Add case studies or portfolio examples");
          break;
        case "Testimonials/reviews exist":
          recommendations.push("Collect and add customer testimonials");
          break;
        case "Social proof exists":
          recommendations.push("Add social proof (awards, certifications, client logos)");
          break;
        case "Recent posts exist":
          recommendations.push("Maintain consistent posting schedule");
          break;
      }
    }
  });

  return recommendations;
}

// Save AI Visibility Campaign to Drafts/Review
router.post(
  "/clients/:clientId/ai-visibility/save-campaign",
  requireClientRole(["owner", "admin", "editor"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientId } = req.params;
      const { campaign, topic, score } = req.body;

      if (!campaign) {
        res.status(400).json({ error: "Campaign data required" });
        return;
      }

      // Create campaign container
      const [newCampaign] = await db.insert(campaignsTable).values({
        clientId,
        name: campaign.campaignName || `AI Visibility Campaign - ${topic || 'General'}`,
        goal: `AI Visibility optimization for ${topic || 'brand discovery'}`,
        description: `Generated from AI Visibility analysis. Score: ${score?.score || 'N/A'}/100`,
        platforms: JSON.stringify(["instagram", "linkedin", "facebook"]),
        status: "draft",
      }).returning();

      const campaignId = newCampaign.id;
      const createdPosts: any[] = [];
      const imagePromptDirections = Array.isArray(campaign.imagePrompts) ? campaign.imagePrompts : [];
      const firstImagePrompt = imagePromptDirections[0];
      const firstImagePromptText = typeof firstImagePrompt === "string"
        ? firstImagePrompt
        : firstImagePrompt?.prompt || firstImagePrompt?.concept || "";

      // Save LinkedIn posts
      if (campaign.linkedInPosts && Array.isArray(campaign.linkedInPosts)) {
        for (const post of campaign.linkedInPosts) {
          const captionText = [post.hook, post.content, post.mainContent, post.body]
            .filter((v: unknown) => typeof v === "string" && v.trim())
            .join("\n\n") || post.angle || "";
          const [savedPost] = await db.insert(postsTable).values({
            clientId,
            campaignId,
            contentType: "social_post",
            topic: post.topic || topic || "AI Visibility",
            caption: captionText,
            hashtags: post.hashtags || "",
            platform: "linkedin",
            postType: "social",
            status: "draft",
            contentSchema: {
              source: "ai_visibility",
              visibilityScore: score?.score,
              cta: post.cta || "",
              hook: post.hook || "",
              imagePromptDirections,
              imagePrompt: post.imageConcept || firstImagePromptText,
            },
          }).returning();
          createdPosts.push(savedPost);
        }
      }

      // Save Instagram posts
      if (campaign.instagramPosts && Array.isArray(campaign.instagramPosts)) {
        for (const post of campaign.instagramPosts) {
          const [savedPost] = await db.insert(postsTable).values({
            clientId,
            campaignId,
            contentType: "social_post",
            topic: post.topic || topic || "AI Visibility",
            caption: post.caption || "",
            hashtags: post.hashtags || "",
            platform: "instagram",
            postType: "social",
            status: "draft",
            imagePrompt: post.imageConcept || firstImagePromptText,
            contentSchema: {
              source: "ai_visibility",
              visibilityScore: score?.score,
              cta: post.cta || "",
              imagePromptDirections,
              imagePrompt: post.imageConcept || firstImagePromptText,
            },
          }).returning();
          createdPosts.push(savedPost);
        }
      }

      // Save carousel as a draft
      if (campaign.carousel) {
        const [savedPost] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "carousel",
          topic: campaign.carousel.title || topic || "AI Visibility Carousel",
          caption: campaign.carousel.caption || "",
          hashtags: campaign.carousel.hashtags || "",
          platform: "instagram",
          postType: "social",
          status: "draft",
          contentSchema: {
            source: "ai_visibility",
            visibilityScore: score?.score,
            carouselSlides: campaign.carousel.slides || [],
            cta: campaign.carousel.cta || "",
            imagePromptDirections,
            imagePrompt: campaign.carousel.imagePrompt || firstImagePromptText,
          },
        }).returning();
        createdPosts.push(savedPost);
      }

      // Save reel storyboard as a draft
      if (campaign.reel) {
        const [savedPost] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "video",
          topic: campaign.reel.concept || topic || "AI Visibility Reel",
          caption: campaign.reel.caption || "",
          hashtags: campaign.reel.hashtags || "",
          platform: "instagram",
          postType: "social",
          status: "draft",
          contentSchema: {
            source: "ai_visibility",
            visibilityScore: score?.score,
            storyboard: campaign.reel.storyboard || "",
            hook: campaign.reel.hook || "",
            scenes: campaign.reel.scenes || [],
            audioSuggestion: campaign.reel.audioSuggestion || "",
            imagePromptDirections,
            thumbnailPrompt: campaign.reel.thumbnailPrompt || firstImagePromptText,
          },
        }).returning();
        createdPosts.push(savedPost);
      }

      // Save blog outline as a draft
      if (campaign.blogOutline) {
        const [savedPost] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "blog",
          topic: campaign.blogOutline.title || topic || "AI Visibility Article",
          caption: campaign.blogOutline.metaDescription || "",
          title: campaign.blogOutline.title || "",
          longFormBody: JSON.stringify(campaign.blogOutline.outline || campaign.blogOutline),
          platform: "blog",
          postType: "blog",
          status: "draft",
          contentSchema: {
            source: "ai_visibility",
            visibilityScore: score?.score,
            seoTitle: campaign.blogOutline.seoTitle || "",
            metaDescription: campaign.blogOutline.metaDescription || "",
            outline: campaign.blogOutline.outline || "",
            faqs: campaign.blogOutline.faqs || [],
            imagePromptDirections,
            imagePrompt: campaign.blogOutline.imagePrompt || firstImagePromptText,
          },
        }).returning();
        createdPosts.push(savedPost);
      }

      // Save FAQs as campaign output
      if (campaign.faqs && Array.isArray(campaign.faqs)) {
        const [savedPost] = await db.insert(postsTable).values({
          clientId,
          campaignId,
          contentType: "faq",
          topic: `FAQs - ${topic || 'AI Visibility'}`,
          caption: `${campaign.faqs.length} FAQs for AI visibility`,
          platform: "website",
          postType: "content",
          status: "draft",
          contentSchema: {
            source: "ai_visibility",
            visibilityScore: score?.score,
            faqs: campaign.faqs,
          },
        }).returning();
        createdPosts.push(savedPost);
      }

      // Save campaign output record
      await db.insert(campaignOutputsTable).values({
        clientId,
        campaignId,
        campaignName: campaign.campaignName || `AI Visibility - ${topic || 'General'}`,
        goal: `AI Visibility optimization`,
        platforms: JSON.stringify(["instagram", "linkedin", "facebook", "blog"]),
        intensity: "standard",
        qualityMode: "balanced",
        brief: `AI Visibility campaign generated from analysis. Score: ${score?.score || 'N/A'}/100`,
        socialPostsJson: JSON.stringify(campaign.linkedInPosts || []),
        blogOutlinesJson: JSON.stringify(campaign.blogOutline ? [campaign.blogOutline] : []),
        imagePromptsJson: JSON.stringify(campaign.imagePrompts || []),
        videoConceptsJson: JSON.stringify(campaign.reel ? [campaign.reel] : []),
        scheduleJson: JSON.stringify(campaign.schedule || []),
        status: "ready",
      });

      res.json({
        success: true,
        campaignId,
        postsCreated: createdPosts.length,
        posts: createdPosts,
      });
    } catch (error: any) {
      console.error("Save campaign error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
