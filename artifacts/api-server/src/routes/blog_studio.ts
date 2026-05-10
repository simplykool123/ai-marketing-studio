/**
 * Blog Studio routes
 *
 * POST /clients/:clientId/blog/generate
 *   - Keyword/topic input
 *   - Delegates to SkillEngine skill "seo_blog_strategist"
 *   - Saves draft with contentType="blog", qualityScore, qualityReport
 *   - Architecture ready for Tavily/Exa/SerpAPI: add a research step before
 *     executeSkill and inject results into the input object
 *
 * GET  /clients/:clientId/blog/posts    — list blog drafts for client
 * GET  /clients/:clientId/blog/posts/:postId — single blog post
 * PATCH /clients/:clientId/blog/posts/:postId — update blog draft
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, qualityChecksTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { executeSkill, SkillEngineError } from "../lib/skill-engine.js";
import { evaluateQuality } from "../lib/quality-gate.js";
import { toAiErrorResponse, safeErrorMessage } from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const BLOG_SKILL_ID = "seo_blog_strategist";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlogSection {
  heading: string;
  content: string;
}

interface BlogFaq {
  q: string;
  a: string;
}

interface GeneratedBlog {
  researchSummary: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  outline: string[];
  faq: BlogFaq[];
  schemaType: string;
  schemaSuggestion: string;
  fullDraft: string;
  sections: BlogSection[];
  estimatedReadTime: string;
  targetKeywords: string[];
}

// ---------------------------------------------------------------------------
// POST /clients/:clientId/blog/generate
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/blog/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId } = req.params;
    const {
      keyword,
      tone,
      targetAudience,
      wordCount,
      campaignId,
      storylineId,
    } = req.body as {
      keyword?: string;
      tone?: string;
      targetAudience?: string;
      wordCount?: number;
      // qualityMode is intentionally not used here — the seo_blog_strategist
      // skill config controls provider routing via provider_routing.default_quality_mode
      campaignId?: string;
      storylineId?: string;
    };

    if (!keyword?.trim()) {
      res.status(400).json({ error: "keyword is required" });
      return;
    }

    try {
      const result = await executeSkill({
        clientId,
        skillId: BLOG_SKILL_ID,
        input: {
          keyword,
          tone:           tone ?? null,
          targetAudience: targetAudience ?? null,
          wordCount:      wordCount ?? 1200,
        },
        userId: req.userId,
      });

      const gen = result.output as unknown as GeneratedBlog;
      const quality = evaluateQuality({ skill: result.skill, output: result.output });

      logger.info(
        { provider: result.metadata.provider, model: result.metadata.model,
          fallbackUsed: result.metadata.fallbackUsed, clientId, skillId: BLOG_SKILL_ID },
        "Blog Studio: skill complete"
      );

      const keywords = Array.isArray(gen.targetKeywords) ? gen.targetKeywords : [];
      const hashtags = keywords.map(k => `#${String(k).replace(/\s+/g, "")}`).join(" ");

      const [post] = await db.transaction(async (tx) => {
        const [createdPost] = await tx
          .insert(postsTable)
          .values({
            clientId,
            campaignId:          campaignId ?? null,
            storylineId:         storylineId ?? null,
            skillId:             BLOG_SKILL_ID,
            contentType:         "blog",
            contentSchema:       gen,
            contentSchemaVersion: 1,
            topic:               gen.seoTitle ?? keyword,
            caption:             gen.metaDescription ?? "",
            hashtags,
            platform:            "blog",
            postType:            "blog",
            status:              "draft",
            generationStatus:    "ready",
            title:               gen.seoTitle ?? keyword,
            longFormBody:        JSON.stringify(gen),
            qualityScore:        quality.score,
            qualityReport:       quality.report,
            generationMetadata:  {
              ...result.metadata,
              route: "blog_studio.generate",
              keyword,
              tone: tone ?? null,
              targetAudience: targetAudience ?? null,
              wordCount: wordCount ?? null,
            },
          })
          .returning();

        await tx.insert(qualityChecksTable).values({
          postId:  createdPost.id,
          skillId: BLOG_SKILL_ID,
          score:   quality.score,
          report:  quality.report,
        });

        return [createdPost];
      });

      res.json({
        post,
        generated: gen,
        meta: { provider: result.metadata.provider, fallbackUsed: result.metadata.fallbackUsed },
      });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const { status, message } = toAiErrorResponse(
        err, "Failed to generate blog post. Check your AI provider key in Settings."
      );
      logger.error({ error: safeErrorMessage(err) }, "Blog Studio generate error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/blog/posts — list blog drafts
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/blog/posts",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const posts = await db
        .select({
          id:               postsTable.id,
          topic:            postsTable.topic,
          caption:          postsTable.caption,
          title:            postsTable.title,
          status:           postsTable.status,
          generationStatus: postsTable.generationStatus,
          createdAt:        postsTable.createdAt,
          updatedAt:        postsTable.updatedAt,
        })
        .from(postsTable)
        .where(
          and(
            eq(postsTable.clientId, req.params.clientId),
            eq(postsTable.postType, "blog")
          )
        )
        .orderBy(postsTable.createdAt);

      res.json({ posts });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog posts list error");
      res.status(500).json({ error: "Failed to list blog posts" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/blog/posts/:postId
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/blog/posts/:postId",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const [post] = await db
        .select()
        .from(postsTable)
        .where(
          and(
            eq(postsTable.id, req.params.postId),
            eq(postsTable.clientId, req.params.clientId),
            eq(postsTable.postType, "blog")
          )
        )
        .limit(1);

      if (!post) {
        res.status(404).json({ error: "Blog post not found" });
        return;
      }
      res.json({ post });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog post get error");
      res.status(500).json({ error: "Failed to get blog post" });
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /clients/:clientId/blog/posts/:postId — update draft
// ---------------------------------------------------------------------------

router.patch(
  "/clients/:clientId/blog/posts/:postId",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { title, caption, longFormBody, status } = req.body as {
      title?: string;
      caption?: string;
      longFormBody?: string;
      status?: string;
    };

    let parsedContentSchema: unknown | undefined;
    if (longFormBody !== undefined) {
      try {
        parsedContentSchema = JSON.parse(longFormBody);
      } catch {
        parsedContentSchema = undefined;
      }
    }

    try {
      const [updated] = await db
        .update(postsTable)
        .set({
          ...(title        !== undefined ? { title, topic: title } : {}),
          ...(caption      !== undefined ? { caption } : {}),
          ...(longFormBody !== undefined ? { longFormBody } : {}),
          ...(parsedContentSchema !== undefined ? { contentSchema: parsedContentSchema, contentSchemaVersion: 1 } : {}),
          ...(status       !== undefined ? { status } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(postsTable.id, req.params.postId),
            eq(postsTable.clientId, req.params.clientId)
          )
        )
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Blog post not found" });
        return;
      }
      res.json({ post: updated });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog post update error");
      res.status(500).json({ error: "Failed to update blog post" });
    }
  }
);

export default router;
