// Phase 50 — omnichannel + festival + WhatsApp + growth-boost generators.
// One module so the routes share helpers. Trend Radar lives in trends.ts;
// AI Brain campaign idea upgrade lives in ai_brain.ts. GBP composer is in
// gbp.ts (export-only this phase).

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignOutputsTable,
  postsTable,
  type Post,
} from "@workspace/db/schema";
import {
  EDIT_CONTENT_ROLES,
  requireClientRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { executeSkill, SkillEngineError } from "../lib/skill-engine.js";
import { ensureInitialGlobalSkillExternally } from "./skills.js";
import { getFormat, DEFAULT_OMNICHANNEL_PACK, type FormatDef } from "../lib/format-matrix.js";
import { recordLearning, writeClientMemory } from "../lib/client-memory-packet.js";
import { logger } from "../lib/logger.js";
import { safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// Helpers — shared by all generators below.
// ────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function hashtagsField(value: unknown): string {
  const arr = stringList(value);
  if (arr.length) return arr.map((t) => (t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`)).join(" ");
  return "";
}

function postTypeForContentType(contentType: string | null | undefined): "social" | "blog" | "newsletter" {
  const f = getFormat(contentType ?? "");
  if (!f) return "social";
  if (f.channelGroup === "blog") return "blog";
  if (f.channelGroup === "newsletter") return "newsletter";
  return "social";
}

type PackItem = {
  contentType: string;
  platform?: string;
  topic?: string;
  caption?: string;
  hashtags?: unknown;
  cta?: string;
  imagePrompt?: string;
  thumbnailPrompt?: string;
  scenes?: unknown[];
  slides?: unknown[];
  suggestedAt?: string;
  notes?: string;
};

async function persistPackItem(opts: {
  clientId: string;
  campaignId: string | null;
  storylineId?: string | null;
  skillId: string;
  generationRoute: string;
  item: PackItem;
  extraSchema?: Record<string, unknown>;
}): Promise<Post> {
  const f: FormatDef | null = getFormat(opts.item.contentType);
  const contentType = opts.item.contentType;
  const platform = opts.item.platform ?? f?.platform ?? "social";
  const topic = stringField(opts.item.topic, "Untitled campaign item");
  const caption = stringField(opts.item.caption, "");
  const imagePrompt = stringField(opts.item.imagePrompt, "");
  const contentSchema: Record<string, unknown> = {
    ...(opts.extraSchema ?? {}),
    cta: opts.item.cta ?? "",
    imagePrompt,
    thumbnailPrompt: opts.item.thumbnailPrompt ?? "",
    suggestedAt: opts.item.suggestedAt ?? "",
    notes: opts.item.notes ?? "",
  };
  if (Array.isArray(opts.item.scenes)) contentSchema.scenes = opts.item.scenes;
  if (Array.isArray(opts.item.slides)) contentSchema.slides = opts.item.slides;

  const [post] = await db
    .insert(postsTable)
    .values({
      clientId: opts.clientId,
      campaignId: opts.campaignId,
      storylineId: opts.storylineId ?? null,
      skillId: opts.skillId,
      contentType,
      contentSchema,
      contentSchemaVersion: 1,
      topic,
      caption: caption || topic,
      hashtags: hashtagsField(opts.item.hashtags),
      platform,
      postType: postTypeForContentType(contentType),
      title: contentType === "blog_article" ? stringField(opts.item.topic, "") : null,
      longFormBody: contentType === "blog_article" ? stringField(opts.item.caption, "") : null,
      imagePrompt: imagePrompt || null,
      status: "draft",
      scheduledAt: opts.item.suggestedAt ? new Date(opts.item.suggestedAt) : null,
      generationStatus: "ready",
      generationMetadata: { skillId: opts.skillId, route: opts.generationRoute },
    })
    .returning();
  return post;
}

// ────────────────────────────────────────────────────────────────────────────
// TASK 6 — One-click Omnichannel Campaign Pack.
// ────────────────────────────────────────────────────────────────────────────

router.post(
  "/clients/:clientId/omnichannel/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        topic?: string;
        goal?: string;
        audience?: string;
        platforms?: string[];
        formats?: string[];
        cta?: string;
        suggestedSchedule?: string;
        campaignName?: string;
      };
      if (!body.topic?.trim()) {
        res.status(400).json({ error: "topic is required" });
        return;
      }
      const formats = (body.formats && body.formats.length ? body.formats : DEFAULT_OMNICHANNEL_PACK).slice(0, 16);
      const platforms = body.platforms ?? Array.from(new Set(formats.map((c) => getFormat(c)?.platform).filter(Boolean) as string[]));
      const skillId = "omnichannel_campaign_builder";
      await ensureInitialGlobalSkillExternally(skillId);

      const [campaign] = await db
        .insert(campaignsTable)
        .values({
          clientId: req.params.clientId,
          name: body.campaignName?.trim() || `Omnichannel: ${body.topic.slice(0, 60)}`,
          goal: body.goal ?? "awareness",
          description: body.topic,
          platforms: JSON.stringify(platforms),
          status: "draft",
        })
        .returning();

      let skillResult;
      try {
        skillResult = await executeSkill({
          clientId: req.params.clientId,
          skillId,
          input: {
            topic: body.topic,
            goal: body.goal ?? "awareness",
            audience: body.audience ?? "",
            platforms,
            formats,
            cta: body.cta ?? "",
            suggestedSchedule: body.suggestedSchedule ?? "",
          },
          userId: req.userId,
        });
      } catch (err) {
        if (err instanceof SkillEngineError) {
          res.status(err.status).json({ error: err.message, campaignId: campaign.id });
          return;
        }
        throw err;
      }

      const output = skillResult.output;
      const rawItems = Array.isArray(output.items) ? (output.items as PackItem[]) : [];
      const items = rawItems.filter((it) => it && getFormat(it.contentType));

      const persisted: Post[] = [];
      for (const item of items) {
        try {
          const post = await persistPackItem({
            clientId: req.params.clientId,
            campaignId: campaign.id,
            skillId,
            generationRoute: "omnichannel.generate",
            item,
          });
          persisted.push(post);
        } catch (err) {
          logger.warn({ error: safeErrorMessage(err), contentType: item.contentType }, "Omnichannel item persist failed");
        }
      }

      const [outputRow] = await db
        .insert(campaignOutputsTable)
        .values({
          clientId: req.params.clientId,
          campaignId: campaign.id,
          campaignName: campaign.name,
          goal: campaign.goal ?? "awareness",
          platforms: JSON.stringify(platforms),
          intensity: "standard",
          qualityMode: "balanced",
          brief: stringField(asRecord(output.campaign).suggestedSchedule),
          socialPostsJson: JSON.stringify(items),
          status: "ready",
        })
        .returning();

      await recordLearning({
        clientId: req.params.clientId,
        kind: "campaign_outcome",
        topic: body.topic,
        summary: `Generated omnichannel pack covering ${items.length} formats across ${platforms.join(", ")}.`,
      });

      res.json({
        campaign,
        items: persisted,
        output: outputRow,
        meta: skillResult.metadata,
      });
    } catch (err) {
      const { status, message } = toAiErrorResponse(err, "Omnichannel generation failed");
      logger.error({ error: safeErrorMessage(err) }, "Omnichannel generation failed");
      res.status(status).json({ error: message });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// TASK 2 — Festival / Occasion Campaign Pack.
// Note: a single-occasion artwork skill already exists (occasion_artwork) and
// is reachable via /clients/:id/occasions/:occasionId/generate. This route
// builds a *multi-format pack* for a festival the user picked.
// ────────────────────────────────────────────────────────────────────────────

router.post(
  "/clients/:clientId/festivals/generate-pack",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        occasion?: string;
        date?: string;
        country?: string;
        city?: string;
        industry?: string;
        products?: string;
        platforms?: string[];
        offer?: string;
        imagePreference?: string;
        campaignName?: string;
      };
      if (!body.occasion?.trim() || !body.date?.trim()) {
        res.status(400).json({ error: "occasion and date are required" });
        return;
      }
      const skillId = "festival_campaign_builder";
      await ensureInitialGlobalSkillExternally(skillId);

      const [campaign] = await db
        .insert(campaignsTable)
        .values({
          clientId: req.params.clientId,
          name: body.campaignName?.trim() || `Festival: ${body.occasion}`,
          goal: "festival",
          description: `${body.occasion} on ${body.date}${body.offer ? ` — ${body.offer}` : ""}`,
          platforms: JSON.stringify(body.platforms ?? ["instagram", "facebook", "whatsapp"]),
          startDate: new Date(body.date),
          endDate: new Date(body.date),
          status: "draft",
        })
        .returning();

      const skillResult = await executeSkill({
        clientId: req.params.clientId,
        skillId,
        input: {
          occasion: body.occasion,
          date: body.date,
          country: body.country ?? "",
          city: body.city ?? "",
          industry: body.industry ?? "",
          products: body.products ?? "",
          platforms: body.platforms ?? ["instagram", "facebook", "whatsapp"],
          offer: body.offer ?? "",
          imagePreference: body.imagePreference ?? "",
        },
        userId: req.userId,
      });

      const rawItems = Array.isArray(skillResult.output.items) ? (skillResult.output.items as PackItem[]) : [];
      const items = rawItems.filter((it) => it && getFormat(it.contentType));
      const persisted: Post[] = [];
      for (const item of items) {
        try {
          const post = await persistPackItem({
            clientId: req.params.clientId,
            campaignId: campaign.id,
            skillId,
            generationRoute: "festivals.generate-pack",
            item: { ...item, suggestedAt: item.suggestedAt ?? body.date },
            extraSchema: { festival: { occasion: body.occasion, date: body.date, offer: body.offer ?? null } },
          });
          persisted.push(post);
        } catch (err) {
          logger.warn({ error: safeErrorMessage(err), contentType: item.contentType }, "Festival pack item persist failed");
        }
      }

      await recordLearning({
        clientId: req.params.clientId,
        kind: "festival_outcome",
        topic: body.occasion,
        summary: `Generated festival pack for ${body.occasion} (${items.length} items).`,
      });

      res.json({ campaign, items: persisted, meta: skillResult.metadata });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Festival pack generation failed");
      logger.error({ error: safeErrorMessage(err) }, "Festival pack generation failed");
      res.status(status).json({ error: message });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// TASK 5 — WhatsApp Status export builder.
// ────────────────────────────────────────────────────────────────────────────

router.post(
  "/clients/:clientId/whatsapp/status/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        topic?: string;
        offer?: string;
        targetAudience?: string;
        format?: "image" | "video";
      };
      if (!body.topic?.trim()) {
        res.status(400).json({ error: "topic is required" });
        return;
      }
      const skillId = "whatsapp_status_export_builder";
      await ensureInitialGlobalSkillExternally(skillId);

      const skillResult = await executeSkill({
        clientId: req.params.clientId,
        skillId,
        input: {
          topic: body.topic,
          offer: body.offer ?? "",
          targetAudience: body.targetAudience ?? "",
          format: body.format ?? "image",
        },
        userId: req.userId,
      });
      const out = skillResult.output;
      const contentType = body.format === "video" ? "whatsapp_status_video" : "whatsapp_status_image";

      const post = await persistPackItem({
        clientId: req.params.clientId,
        campaignId: null,
        skillId,
        generationRoute: "whatsapp.status.generate",
        item: {
          contentType,
          platform: "whatsapp",
          topic: body.topic,
          caption: stringField(out.shareCaption, ""),
          imagePrompt: stringField(out.imagePrompt, ""),
          scenes: Array.isArray(out.videoScenes) ? out.videoScenes : undefined,
          notes: stringField(out.broadcastCopy, ""),
        },
        extraSchema: {
          onImageText: stringField(out.onImageText, ""),
          broadcastCopy: stringField(out.broadcastCopy, ""),
          clickToChatLinkHint: stringField(out.clickToChatLinkHint, ""),
          exportPack: true,
        },
      });

      res.json({ post, output: out, meta: skillResult.metadata });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "WhatsApp Status generation failed");
      logger.error({ error: safeErrorMessage(err) }, "WhatsApp Status generation failed");
      res.status(status).json({ error: message });
    }
  }
);

// Mark a WhatsApp draft as ready_for_whatsapp after the user has the artwork
// and is ready to post manually.
router.post(
  "/clients/:clientId/whatsapp/:postId/ready",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req, res): Promise<void> => {
    try {
      const [post] = await db
        .update(postsTable)
        .set({ status: "ready_for_whatsapp", updatedAt: new Date() })
        .where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId)))
        .returning();
      if (!post) { res.status(404).json({ error: "Post not found" }); return; }
      res.json({ post });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "WhatsApp ready transition failed");
      res.status(500).json({ error: "Failed to mark ready_for_whatsapp" });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// TASK 13 — Growth Boost (local SEO + AI search).
// ────────────────────────────────────────────────────────────────────────────

router.post(
  "/clients/:clientId/growth-boost/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        industry?: string;
        city?: string;
        serviceAreas?: string;
        services?: string;
        topQuestions?: string;
        campaignName?: string;
      };
      if (!body.industry?.trim()) {
        res.status(400).json({ error: "industry is required" });
        return;
      }
      const skillId = "local_growth_booster";
      await ensureInitialGlobalSkillExternally(skillId);

      const [campaign] = await db
        .insert(campaignsTable)
        .values({
          clientId: req.params.clientId,
          name: body.campaignName?.trim() || `Growth Boost: ${body.industry}`,
          goal: "engagement",
          description: `Local + AI-search content for ${body.industry}${body.city ? ` in ${body.city}` : ""}`,
          platforms: JSON.stringify(["website", "google_business", "whatsapp", "blog"]),
          status: "draft",
        })
        .returning();

      const skillResult = await executeSkill({
        clientId: req.params.clientId,
        skillId,
        input: {
          industry: body.industry,
          city: body.city ?? "",
          serviceAreas: body.serviceAreas ?? "",
          services: body.services ?? "",
          topQuestions: body.topQuestions ?? "",
        },
        userId: req.userId,
      });

      const rawItems = Array.isArray(skillResult.output.items) ? (skillResult.output.items as Array<PackItem & { title?: string; body?: string; localKeywords?: string[]; aiAnswerSummary?: string }>) : [];
      const persisted: Post[] = [];
      for (const item of rawItems) {
        const contentType = stringField(item.contentType, "local_seo_content");
        if (!getFormat(contentType)) continue;
        try {
          const post = await persistPackItem({
            clientId: req.params.clientId,
            campaignId: campaign.id,
            skillId,
            generationRoute: "growth-boost.generate",
            item: {
              contentType,
              platform: getFormat(contentType)?.platform ?? "website",
              topic: stringField(item.title, body.industry),
              caption: stringField(item.body, ""),
              cta: stringField(item.cta, ""),
            },
            extraSchema: {
              localKeywords: Array.isArray(item.localKeywords) ? item.localKeywords : [],
              aiAnswerSummary: stringField(item.aiAnswerSummary, ""),
              growthBoost: true,
            },
          });
          persisted.push(post);
        } catch (err) {
          logger.warn({ error: safeErrorMessage(err), contentType }, "Growth Boost item persist failed");
        }
      }

      await recordLearning({
        clientId: req.params.clientId,
        kind: "local_value_angle",
        topic: body.industry,
        summary: `Generated Growth Boost pack covering ${persisted.length} items in ${body.city ?? "client area"}.`,
      });

      res.json({ campaign, items: persisted, meta: skillResult.metadata });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "Growth Boost generation failed");
      logger.error({ error: safeErrorMessage(err) }, "Growth Boost generation failed");
      res.status(status).json({ error: message });
    }
  }
);

export default router;
