// Phase 50 — Google Business Profile composer (export-only).
// No OAuth in this phase; we honestly say "GBP not connected" and offer
// export/manual. The post still appears in Review and Queue, and the format
// matrix marks gbp_post as api_when_connected so a future Phase 50B can
// upgrade publish without changing the schema.

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { brandDnaTable, clientsTable, contentMemoryTable, postsTable, socialAccountsTable } from "@workspace/db/schema";
import {
  EDIT_CONTENT_ROLES,
  ALL_CLIENT_ROLES,
  requireClientRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { executeSkill, SkillEngineError } from "../lib/skill-engine.js";
import { ensureInitialGlobalSkillExternally } from "./skills.js";
import { logger } from "../lib/logger.js";
import { safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";

const router = Router();

function stringField(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function trimToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

// GET status — "is GBP connected for this client". Today: always false,
// because Phase 50 ships export-only. Surfaces a Local Growth Checklist so
// the user can see what's still missing for local SEO regardless of GBP.
router.get(
  "/clients/:clientId/gbp/status",
  requireClientRole(ALL_CLIENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const clientId = req.params.clientId;
      const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
      const [brand] = await db.select().from(brandDnaTable).where(eq(brandDnaTable.clientId, clientId)).limit(1);
      const memories = await db
        .select()
        .from(contentMemoryTable)
        .where(eq(contentMemoryTable.clientId, clientId));
      // Phase 50: GBP OAuth is not wired. If we ever add it, this is the
      // only place that needs to flip the boolean (and store accountId).
      const gbpAccount = await db
        .select()
        .from(socialAccountsTable)
        .where(
          and(
            eq(socialAccountsTable.clientId, clientId),
            eq(socialAccountsTable.platform, "google_business"),
            eq(socialAccountsTable.isActive, true),
          ),
        )
        .limit(1);
      const connected = gbpAccount.length > 0;

      // Build a Local Growth Checklist from Brand DNA + content_memory keys.
      const growthRules = (() => {
        const row = memories.find((m) => m.key === "Content Growth Rules / client defaults");
        if (!row) return {};
        try { return JSON.parse(row.value) as Record<string, unknown>; } catch { return {}; }
      })();

      const has = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : !!v;

      const checklist = [
        { key: "business_name", label: "Business name", done: has(client?.name) },
        { key: "website", label: "Website", done: has(growthRules.website) || has(brand?.industry) },
        { key: "phone", label: "Phone", done: has(growthRules.phone) },
        { key: "address_or_service_area", label: "Address / service area", done: has(growthRules.address) || has(growthRules.serviceAreas) },
        { key: "hours", label: "Business hours", done: has(growthRules.hours) },
        { key: "services_or_products", label: "Services / products", done: has(growthRules.services) || has(growthRules.products) || has(brand?.brandValues) },
        { key: "photos", label: "Photos uploaded", done: false /* requires GBP API for ground truth */ },
        { key: "latest_post", label: "Latest GBP post", done: false },
        { key: "reviews", label: "Reviews collected", done: false },
        { key: "faqs", label: "FAQs / Q&A", done: false },
        { key: "city_service_area_content", label: "City / service-area content", done: has(growthRules.serviceAreas) || has(growthRules.city) },
        { key: "local_keywords", label: "Local keywords", done: has(growthRules.seoKeywords) },
        { key: "near_me_questions", label: "Near-me question answers", done: false },
        { key: "review_request_message", label: "Review request message", done: false },
      ];

      const completed = checklist.filter((c) => c.done).length;
      res.json({
        connected,
        connectionNote: connected
          ? "Google Business Profile is connected via OAuth."
          : "Google Business Profile is not connected. Generate posts and export/copy them to GBP manually. Phase 50B will add OAuth.",
        checklist,
        completed,
        total: checklist.length,
      });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "GBP status failed");
      res.status(500).json({ error: "Failed to load GBP status" });
    }
  }
);

// Compose a GBP post via skill. Saves to posts table as draft. User exports
// from Review/Drafts because gbp_post is api_when_connected (and we're not
// connected this phase).
router.post(
  "/clients/:clientId/gbp/compose",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        topic?: string;
        postKind?: "update" | "offer" | "event";
        offerTerms?: string;
        eventStart?: string;
        eventEnd?: string;
        targetCity?: string;
      };
      if (!body.topic?.trim()) {
        res.status(400).json({ error: "topic is required" });
        return;
      }
      const skillId = "google_business_profile_post_builder";
      await ensureInitialGlobalSkillExternally(skillId);

      const skillResult = await executeSkill({
        clientId: req.params.clientId,
        skillId,
        input: {
          topic: body.topic,
          postKind: body.postKind ?? "update",
          offerTerms: body.offerTerms ?? "",
          eventStart: body.eventStart ?? "",
          eventEnd: body.eventEnd ?? "",
          targetCity: body.targetCity ?? "",
        },
        userId: req.userId,
      });

      const out = skillResult.output;
      const contentType = body.postKind === "offer" || body.postKind === "event" ? "gbp_offer" : "gbp_post";
      const caption = trimToLimit(stringField(out.caption, ""), 1500);

      const [post] = await db
        .insert(postsTable)
        .values({
          clientId: req.params.clientId,
          contentType,
          contentSchema: {
            actionButton: stringField(out.actionButton, "LEARN_MORE"),
            actionUrl: stringField(out.actionUrl, ""),
            offerTitle: stringField(out.offerTitle, ""),
            eventTitle: stringField(out.eventTitle, ""),
            eventStart: stringField(out.eventStart, body.eventStart ?? ""),
            eventEnd: stringField(out.eventEnd, body.eventEnd ?? ""),
            targetCity: body.targetCity ?? "",
            imagePrompt: stringField(out.imagePrompt, ""),
            exportPack: true,
          },
          contentSchemaVersion: 1,
          topic: body.topic,
          caption,
          platform: "google_business",
          postType: "social",
          status: "draft",
          generationStatus: "ready",
          generationMetadata: { skillId, route: "gbp.compose" },
        })
        .returning();

      res.json({ post, output: out, meta: skillResult.metadata });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const { status, message } = toAiErrorResponse(err, "GBP compose failed");
      logger.error({ error: safeErrorMessage(err) }, "GBP compose failed");
      res.status(status).json({ error: message });
    }
  }
);

// "Publish" handler that is honest about the no-OAuth state. It does not
// pretend the post is live — it marks the post as exported and notes the
// reason in publishError. When GBP OAuth lands, this becomes a real API call.
router.post(
  "/clients/:clientId/gbp/:postId/publish",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req, res): Promise<void> => {
    try {
      const [account] = await db
        .select()
        .from(socialAccountsTable)
        .where(
          and(
            eq(socialAccountsTable.clientId, req.params.clientId),
            eq(socialAccountsTable.platform, "google_business"),
            eq(socialAccountsTable.isActive, true),
          ),
        )
        .limit(1);
      if (!account) {
        // honest "not connected" — do not fake-publish, just mark exported
        // so the user knows the next step is manual.
        const [post] = await db
          .update(postsTable)
          .set({ status: "exported", updatedAt: new Date() })
          .where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId)))
          .returning();
        if (!post) { res.status(404).json({ error: "Post not found" }); return; }
        res.status(409).json({
          error: "Google Business Profile is not connected. Marked as exported — copy the caption + image into GBP manually.",
          post,
          gbpConnected: false,
        });
        return;
      }
      res.status(501).json({
        error: "GBP API publish not implemented yet. Connect via OAuth in a later phase.",
        gbpConnected: true,
      });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "GBP publish failed");
      res.status(500).json({ error: "GBP publish failed" });
    }
  }
);

// Build a downloadable JSON export of one GBP post — the user pastes into GBP.
router.get(
  "/clients/:clientId/gbp/:postId/export",
  requireClientRole(ALL_CLIENT_ROLES),
  async (req, res): Promise<void> => {
    try {
      const [post] = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId)))
        .orderBy(desc(postsTable.createdAt))
        .limit(1);
      if (!post) { res.status(404).json({ error: "Post not found" }); return; }
      const schema = post.contentSchema && typeof post.contentSchema === "object" && !Array.isArray(post.contentSchema)
        ? post.contentSchema as Record<string, unknown>
        : {};
      res.json({
        post: {
          id: post.id,
          contentType: post.contentType,
          topic: post.topic,
          caption: post.caption,
          actionButton: schema.actionButton ?? "LEARN_MORE",
          actionUrl: schema.actionUrl ?? "",
          imagePrompt: schema.imagePrompt ?? "",
          imageUrl: post.selectedImageUrl ?? schema.imageUrl ?? "",
          offerTitle: schema.offerTitle ?? "",
          eventTitle: schema.eventTitle ?? "",
          eventStart: schema.eventStart ?? "",
          eventEnd: schema.eventEnd ?? "",
          targetCity: schema.targetCity ?? "",
        },
        instructions: "Paste the caption, choose the action button, and attach the artwork inside Google Business Profile manager.",
      });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "GBP export failed");
      res.status(500).json({ error: "GBP export failed" });
    }
  }
);

export default router;
