import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, clientsTable, postingLogsTable, campaignsTable, qualityChecksTable, skillConfigsTable, postingRulesTable, type Post } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  CreatePostBody,
  UpdatePostBody,
  ApprovePostBody,
  ListPostsQueryParams,
} from "@workspace/api-zod";
import {
  APPROVE_CONTENT_ROLES,
  EDIT_CONTENT_ROLES,
  MUTATE_CONTENT_ROLES,
  requireClientRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { buildClientMemoryPacket, formatClientMemoryPacket, writeClientMemory } from "../lib/client-memory-packet.js";
import { generateTextWithFallback, safeErrorMessage, toAiErrorResponse } from "../lib/ai-provider.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
import {
  buildPublishPackage,
  buildPublishPayloadPost,
  getPublishingReadiness,
  markPublished,
} from "../lib/publishing-destinations.js";
import { executeSkill } from "../lib/skill-engine.js";
import { executeSkillToReviewDraft } from "./skills.js";
import { logger } from "../lib/logger.js";
import { addDays, startOfDay, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";

const router = Router();

const QUALITY_REVIEW_SKILL = {
  skillId: "quality_review",
  version: "1.0.0",
  displayName: "Quality Review",
  category: "quality",
  config: {
    skill_id: "quality_review",
    version: "1.0.0",
    display_name: "Quality Review",
    category: "quality",
    description: "Reviews a draft for brand fit, platform fit, clarity, CTA quality, repetition risk, and artwork/image prompt fit.",
    required_memory: ["brand_dna", "content_rules", "recent_posts"],
    optional_memory: ["story_memory", "performance_memory", "rejection_memory", "image_style_memory"],
    input_schema: {
      type: "object",
      required: ["postId", "caption", "platform", "contentType", "topic"],
      properties: {
        postId: { type: "string" },
        caption: { type: "string" },
        platform: { type: "string" },
        contentType: { type: "string" },
        topic: { type: "string" },
        imagePrompt: { type: "string" },
        contentSchema: { type: "object" },
      },
    },
    output_schema: {
      type: "object",
      required: ["score", "verdict", "issues", "suggestions", "revisedCaption", "revisedHashtags", "brandFitNotes", "platformFitNotes", "repeatRiskNotes", "ctaSuggestion"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        verdict: { type: "string", enum: ["approve", "improve", "reject"] },
        issues: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } },
        revisedCaption: { type: "string" },
        revisedHashtags: { type: "array", items: { type: "string" } },
        brandFitNotes: { type: "string" },
        platformFitNotes: { type: "string" },
        repeatRiskNotes: { type: "string" },
        ctaSuggestion: { type: "string" },
      },
    },
    prompt_template:
      "Review this draft before approval.\n\nPost ID: {{postId}}\nTopic: {{topic}}\nPlatform: {{platform}}\nContent type: {{contentType}}\nCaption:\n{{caption}}\nImage/artwork prompt:\n{{imagePrompt}}\nContent schema:\n{{contentSchema}}\n\nUse Brand DNA, AI Memory, Content Growth Rules, active Storyline, recent approved/published posts, rejection memory, and performance memory. Judge brand fit, platform fit, CTA quality, website/WhatsApp/link usage, hashtags, SEO keywords, avoid phrases, trend relevance, posting readiness, repetition risk, and artwork/image prompt fit. If the draft can be improved, provide revisedCaption and revisedHashtags, but do not assume the app will apply them automatically. Return only JSON matching the output schema.",
    quality_gate: {
      min_score: 0.75,
      checks: ["brand_voice_match", "platform_fit", "clarity", "cta_quality", "repetition_risk", "artwork_prompt_fit"],
    },
    provider_routing: {
      default_quality_mode: "balanced",
      allow_fallback: true,
      max_tokens: 2200,
    },
    save_destination: {
      table: "quality_checks",
      status: "reviewed",
    },
    memory_writeback: {},
  },
  isGlobal: true,
  isActive: true,
};

async function ensureQualityReviewSkill() {
  await db
    .insert(skillConfigsTable)
    .values(QUALITY_REVIEW_SKILL)
    .onConflictDoNothing();
}

function qualityScorePercent(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.round(Math.max(0, Math.min(raw <= 1 ? raw * 100 : raw, 100)));
}

function numericQualityScore(value: unknown): number {
  return qualityScorePercent(value) / 100;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function safeJson<T>(raw: string): T | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

function buildPreflightFixPrompt(input: {
  context: string;
  post: typeof postsTable.$inferSelect;
  issues: string[];
}) {
  return `You are a senior social copy editor fixing a draft before it reaches the publish queue.

${input.context}

## Draft
Topic: ${input.post.topic}
Platform: ${input.post.platform ?? "instagram"}
Content type: ${input.post.contentType ?? input.post.postType ?? "social_post"}
Caption:
${input.post.caption}

Hashtags:
${input.post.hashtags ?? ""}

Content schema:
${JSON.stringify(input.post.contentSchema ?? {}, null, 2)}

## Preflight issues to fix
${input.issues.length ? input.issues.map((issue) => `- ${issue}`).join("\n") : "- Improve business readiness, platform fit, CTA, hashtags, and growth-rule usage if appropriate."}

## Rules
- Use Brand DNA, AI Memory, active Storyline, trend source context, and Content Growth Rules.
- Do not force website links, WhatsApp, CTAs, hashtags, or SEO keywords into every post. Use them when appropriate for the platform and content.
- Instagram: hook, short value body, CTA, hashtags.
- LinkedIn: professional hook, useful insight, soft CTA, fewer hashtags.
- Facebook: friendly caption, CTA/link/WhatsApp if useful.
- X/Twitter: short hook, concise CTA, no long hashtag block.
- Blog intro: SEO keyword focus, readable intro, meta-style angle.
- Avoid any phrases listed in Content Growth Rules.
- Return a suggestion only. The user will decide whether to apply it.

Return ONLY valid JSON:
{
  "revisedCaption": "",
  "revisedHashtags": ["#tag"],
  "changesMade": [],
  "notes": ""
}`;
}

function qualityReportFromOutput(output: Record<string, unknown>) {
  const score = qualityScorePercent(output.score);
  const verdict = output.verdict === "approve" || output.verdict === "reject" ? output.verdict : "improve";
  return {
    skillId: "quality_review",
    score,
    verdict,
    issues: stringList(output.issues),
    suggestions: stringList(output.suggestions),
    revisedCaption: typeof output.revisedCaption === "string" ? output.revisedCaption : "",
    revisedHashtags: stringList(output.revisedHashtags),
    brandFitNotes: typeof output.brandFitNotes === "string" ? output.brandFitNotes : "",
    platformFitNotes: typeof output.platformFitNotes === "string" ? output.platformFitNotes : "",
    repeatRiskNotes: typeof output.repeatRiskNotes === "string" ? output.repeatRiskNotes : "",
    ctaSuggestion: typeof output.ctaSuggestion === "string" ? output.ctaSuggestion : "",
    reviewedAt: new Date().toISOString(),
  };
}

async function campaignBelongsToClient(campaignId: string | undefined, clientId: string): Promise<boolean> {
  if (!campaignId) return true;
  const [campaign] = await db
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.clientId, clientId)))
    .limit(1);
  return !!campaign;
}

router.get("/clients/:clientId/posts", async (req, res) => {
  try {
    const query = ListPostsQueryParams.parse(req.query);
    const conditions = [eq(postsTable.clientId, req.params.clientId)];
    if (query.status) {
      conditions.push(eq(postsTable.status, query.status));
    }
    if (query.campaignId) {
      conditions.push(eq(postsTable.campaignId, query.campaignId));
    }
    const posts = await db
      .select()
      .from(postsTable)
      .where(and(...conditions))
      .orderBy(postsTable.createdAt);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: "Failed to list posts" });
  }
});

router.get("/clients/:clientId/publishing/readiness", async (req, res): Promise<void> => {
  try {
    res.json(await getPublishingReadiness(req.params.clientId));
  } catch {
    res.status(500).json({ error: "Failed to get publishing readiness" });
  }
});

router.post("/clients/:clientId/posts", requireClientRole(EDIT_CONTENT_ROLES), async (req, res) => {
  try {
    const body = CreatePostBody.parse(req.body);
    if (!(await campaignBelongsToClient(body.campaignId, req.params.clientId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const [post] = await db
      .insert(postsTable)
      .values({ clientId: req.params.clientId, ...body, status: "draft" })
      .returning();
    res.status(201).json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to create post" });
  }
});

// Export all approved posts as JSON download
router.get("/clients/:clientId/posts/export", async (req, res) => {
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, req.params.clientId))
      .limit(1);

    const posts = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.clientId, req.params.clientId),
          inArray(postsTable.status, ["approved", "export_ready", "scheduled"])
        )
      )
      .orderBy(postsTable.scheduledAt);

    const exportData = buildPublishPackage(client?.name ?? "Unknown", posts);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: "Failed to export posts" });
  }
});

// Canonical "export/approved" endpoint returning all approved content
router.get("/clients/:clientId/export/approved", async (req, res) => {
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, req.params.clientId))
      .limit(1);

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const posts = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.clientId, req.params.clientId),
          inArray(postsTable.status, ["approved", "export_ready", "scheduled"])
        )
      )
      .orderBy(postsTable.scheduledAt);

    const exportData = {
      ...buildPublishPackage(client.name, posts),
      posts: posts.map((p) => ({
        ...buildPublishPayloadPost(client.name, p),
        topic: p.topic,
        originalImageUrl: p.originalImageUrl ?? "",
        brandedImageUrl: p.brandedImageUrl ?? "",
        sourceAiIdeaId: p.sourceAiIdeaId ?? "",
      })),
    };

    res.setHeader("Content-Disposition", `attachment; filename="approved-content-${client.name.toLowerCase().replace(/\s+/g, "-")}.json"`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: "Failed to export approved content" });
  }
});

router.get("/clients/:clientId/posts/:postId", async (req, res): Promise<void> => {
  try {
    const [post] = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .limit(1);
    if (!post) { res.status(404).json({ error: "Not found" }); return; }
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to get post" });
  }
});

router.post("/clients/:clientId/posts/:postId/quality-review", requireClientRole(MUTATE_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;
    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    await ensureQualityReviewSkill();
    const result = await executeSkill({
      clientId,
      skillId: "quality_review",
      userId: req.userId,
      input: {
        postId: post.id,
        caption: post.caption,
        platform: post.platform ?? "instagram",
        contentType: post.contentType ?? post.postType ?? "social_post",
        topic: post.topic,
        imagePrompt: post.imagePrompt ?? "",
        contentSchema: post.contentSchema ?? {},
      },
    });

    const report = qualityReportFromOutput(result.output);
    const score = numericQualityScore(report.score);

    const [updated] = await db.transaction(async (tx) => {
      const [updatedPost] = await tx
        .update(postsTable)
        .set({
          qualityScore: score,
          qualityReport: report,
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .returning();

      await tx.insert(qualityChecksTable).values({
        postId,
        skillId: "quality_review",
        score,
        report,
      });

      return [updatedPost];
    });

    res.json({ post: updated, review: report });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to review draft quality" });
  }
});

router.post("/clients/:clientId/posts/:postId/preflight-fix", requireClientRole(MUTATE_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;
    const rawIssues = (req.body as { issues?: unknown[] } | undefined)?.issues;
    const issues = Array.isArray(rawIssues)
      ? rawIssues.map(String).map((issue: string) => issue.trim()).filter(Boolean).slice(0, 12)
      : [];
    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const packet = await buildClientMemoryPacket(clientId);
    const { provider, model } = await resolveTextProviderForMode("balanced", req.userId);
    const prompt = buildPreflightFixPrompt({
      context: formatClientMemoryPacket(packet),
      post,
      issues,
    });
    const { text, usedProvider, usedModel, fallbackUsed } = await generateTextWithFallback(provider, model, prompt, 1800, req.userId);
    const parsed = safeJson<{
      revisedCaption?: string;
      revisedHashtags?: string[] | string;
      changesMade?: string[];
      notes?: string;
    }>(text);

    if (!parsed?.revisedCaption?.trim()) {
      res.status(502).json({ error: "AI did not return a usable preflight fix" });
      return;
    }

    res.json({
      suggestion: {
        revisedCaption: parsed.revisedCaption.trim(),
        revisedHashtags: Array.isArray(parsed.revisedHashtags)
          ? parsed.revisedHashtags.map(String).filter(Boolean)
          : typeof parsed.revisedHashtags === "string" && parsed.revisedHashtags.trim()
            ? parsed.revisedHashtags.split(/\s+/).filter(Boolean)
            : [],
        changesMade: Array.isArray(parsed.changesMade) ? parsed.changesMade.map(String).filter(Boolean) : [],
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
      },
      meta: { provider: usedProvider, model: usedModel, requestedModel: model, fallbackUsed },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fix draft preflight issues" });
  }
});

router.post("/clients/:clientId/posts/:postId/retry-skill", requireClientRole(MUTATE_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  const { clientId, postId } = req.params;
  try {
    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (!post.skillId) {
      res.status(400).json({ error: "This draft was not created with an AI skill, so it cannot be retried with the same skill." });
      return;
    }

    const schema = post.contentSchema && typeof post.contentSchema === "object" && !Array.isArray(post.contentSchema)
      ? post.contentSchema as Record<string, unknown>
      : {};
    const input = {
      topic: post.topic || post.title || "Retried draft",
      platform: post.platform ?? "instagram",
      format: post.contentType ?? post.postType ?? "social_post",
      source: "review_retry",
      notes: [
        `Retrying Review draft ${post.id}.`,
        schema.miniCampaign && typeof schema.miniCampaign === "object"
          ? `Mini campaign item: ${(schema.miniCampaign as Record<string, unknown>).label ?? "campaign item"}.`
          : "",
        "Create a fresh improved version. Do not refer to the previous failed attempt.",
      ].filter(Boolean).join(" "),
    };

    const result = await executeSkillToReviewDraft({
      clientId,
      skillId: post.skillId,
      input,
      userId: req.userId,
      campaignId: post.campaignId,
      storylineId: post.storylineId,
      scheduledAt: post.scheduledAt,
      generationRoute: "review.retry_skill",
      extraContentSchema: {
        retriedFromPostId: post.id,
        retryReason: "manual_review_retry",
        ...(schema.miniCampaign ? { miniCampaign: schema.miniCampaign } : {}),
      },
    });

    logger.info(
      {
        clientId,
        postId,
        newPostId: result.post.id,
        skillId: post.skillId,
        campaignId: post.campaignId,
        provider: result.metadata.provider,
        model: result.metadata.model,
        fallbackUsed: result.metadata.fallbackUsed,
      },
      "Review draft skill retry succeeded"
    );
    res.status(201).json(result);
  } catch (err) {
    const { status, message } = toAiErrorResponse(err, "Failed to retry this draft.");
    logger.warn({ error: safeErrorMessage(err), clientId, postId }, "Review draft skill retry failed");
    res.status(status).json({ error: message });
  }
});

router.patch("/clients/:clientId/posts/:postId", requireClientRole(MUTATE_CONTENT_ROLES), async (req, res) => {
  try {
    const body = UpdatePostBody.parse(req.body);
    if (!(await campaignBelongsToClient(body.campaignId, req.params.clientId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const { scheduledAt, ...rest } = body;
    const [post] = await db
      .update(postsTable)
      .set({ ...rest, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}), updatedAt: new Date() })
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to update post" });
  }
});

// Dedicated status-transition endpoint
router.patch("/clients/:clientId/posts/:postId/status", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { status, scheduledAt, platform } = req.body as {
      status: string;
      scheduledAt?: string;
      platform?: string;
    };
    const validStatuses = [
      "draft",
      "in_review",
      "approved",
      "export_ready",
      "scheduled",
      "posted",
      "published",
      "failed",
      "rejected",
    ];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (scheduledAt) updates.scheduledAt = new Date(scheduledAt);
    if (platform) updates.platform = platform;

    const [post] = await db
      .update(postsTable)
      .set(updates)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to update post status" });
  }
});

function skillLearningSuffix(post: Post): string {
  if (!post.skillId) return "";
  const metadata = (post.generationMetadata ?? {}) as {
    skillVersion?: string;
    provider?: string;
    model?: string;
    qualityBadge?: string;
    qualityScore?: number;
  };
  return [
    `AI skill: ${post.skillId}${metadata.skillVersion ? ` v${metadata.skillVersion}` : ""}.`,
    metadata.qualityBadge ? `Quality badge: ${metadata.qualityBadge}.` : null,
    typeof metadata.qualityScore === "number" ? `Quality score: ${Math.round(metadata.qualityScore * 100)}%.` : null,
  ].filter(Boolean).join(" ");
}

router.delete("/clients/:clientId/posts/:postId", requireClientRole(EDIT_CONTENT_ROLES), async (req, res) => {
  try {
    await db
      .delete(postsTable)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

router.post("/clients/:clientId/posts/:postId/reject", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { category, reason } = req.body as { category?: string; reason?: string };
    const cleanCategory = typeof category === "string" && category.trim() ? category.trim() : "other";
    const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim() : "";
    const [post] = await db
      .update(postsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();
    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    await writeClientMemory(
      req.params.clientId,
      "Rejection Memory / Rejected draft",
      [
        `User rejected draft "${post.topic}".`,
        `Category: ${cleanCategory}.`,
        cleanReason ? `Reason: ${cleanReason}.` : null,
        skillLearningSuffix(post) || null,
        "Avoid repeating this angle unless edited.",
      ].filter(Boolean).join(" ")
    );
    res.json(post);
  } catch {
    res.status(500).json({ error: "Failed to reject post" });
  }
});

router.post("/clients/:clientId/posts/bulk-approve", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { postIds, scheduledAt, platform, spreadSchedule, campaignId, campaignName } = req.body as {
      postIds: string[];
      scheduledAt?: string;
      platform?: string;
      spreadSchedule?: boolean;
      campaignId?: string;
      campaignName?: string;
    };
    if (!Array.isArray(postIds) || postIds.length === 0) {
      res.status(400).json({ error: "postIds must be a non-empty array" });
      return;
    }
    const { clientId } = req.params;

    // Build spread schedule if requested
    let spreadDates: (Date | null)[] = postIds.map(() => scheduledAt ? new Date(scheduledAt) : null);
    if (spreadSchedule) {
      const [rules] = await db.select().from(postingRulesTable).where(eq(postingRulesTable.clientId, clientId)).limit(1);
      const preferredWindows = ((rules?.preferredWindows as number[] | null)?.length ? rules!.preferredWindows as number[] : [9, 12, 15, 18]);
      const blackoutDates = new Set<string>((rules?.blackoutDates as string[] | null) ?? []);
      const preferredDaysList = ((rules as any)?.preferredDays as number[] | null)?.length
        ? (rules as any).preferredDays as number[]
        : [1, 2, 3, 4, 5];
      const preferredDaysSet = new Set<number>(preferredDaysList);

      const slots: Date[] = [];
      const slotsPerDay = new Map<string, number>();
      let dayOffset = 1;

      for (let i = 0; i < postIds.length && dayOffset < 90; ) {
        const day = addDays(startOfDay(new Date()), dayOffset);
        const dayKey = day.toISOString().slice(0, 10);
        const dayOfWeek = day.getDay();

        if (blackoutDates.has(dayKey) || !preferredDaysSet.has(dayOfWeek)) {
          dayOffset++;
          continue;
        }

        const used = slotsPerDay.get(dayKey) ?? 0;
        const maxPerDay = 2;
        if (used < maxPerDay) {
          const hourIndex = used % preferredWindows.length;
          const hour = preferredWindows[hourIndex] ?? 9;
          slots.push(setMilliseconds(setSeconds(setMinutes(setHours(day, hour), 0), 0), 0));
          slotsPerDay.set(dayKey, used + 1);
          i++;
        } else {
          dayOffset++;
        }
      }
      spreadDates = postIds.map((_, idx) => slots[idx] ?? null);
    }

    const results = [];
    for (let i = 0; i < postIds.length; i++) {
      const postId = postIds[i]!;
      const parsedDate = spreadDates[i];
      const [post] = await db
        .update(postsTable)
        .set({
          status: parsedDate ? "scheduled" : "export_ready",
          ...(parsedDate ? { scheduledAt: parsedDate } : {}),
          ...(platform ? { platform } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .returning();
      if (post) results.push(post);
    }

    // Write a single campaign-level memory if campaign context is present
    if (campaignId && results.length > 0) {
      const topics = results.map(p => p.topic).filter(Boolean).slice(0, 5).join(", ");
      const platforms = [...new Set(results.map(p => p.platform ?? "social"))].join(", ");
      await writeClientMemory(
        clientId,
        `Performance Memory / Campaign approved`,
        `Bulk approved campaign${campaignName ? ` "${campaignName}"` : ""} — ${results.length} drafts (${platforms}). Topics: ${topics}. Scheduled across ${spreadSchedule ? "multiple days via posting rules" : "single date"}.`
      );
    } else {
      // Individual memory entries for non-campaign bulk approve
      for (const post of results) {
        await writeClientMemory(clientId, "Performance Memory / Approved draft", `User approved ${post.platform ?? "social"} draft "${post.topic}". Caption angle: ${post.caption.slice(0, 140)} ${skillLearningSuffix(post)}`.trim());
      }
    }

    res.json({ approved: results, count: results.length, scheduled: spreadSchedule && results.length > 0 });
  } catch {
    res.status(400).json({ error: "Failed to bulk approve posts" });
  }
});

router.post("/clients/:clientId/posts/:postId/approve", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res) => {
  try {
    const body = ApprovePostBody.parse(req.body);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const updates: Record<string, unknown> = {
      status: scheduledAt ? "scheduled" : "export_ready",
      ...(scheduledAt ? { scheduledAt } : {}),
      ...(body.platform ? { platform: body.platform } : {}),
      updatedAt: new Date(),
    };

    const [post] = await db
      .update(postsTable)
      .set(updates)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();
    if (post) {
      await writeClientMemory(req.params.clientId, "Performance Memory / Approved draft", `User approved ${post.platform ?? "social"} draft "${post.topic}". Caption angle: ${post.caption.slice(0, 140)} ${skillLearningSuffix(post)}`.trim());
    }
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to approve post" });
  }
});

router.post("/clients/:clientId/posts/:postId/mock-post", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;

    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }

    const [updated] = await db
      .update(postsTable)
      .set({ status: "posted", updatedAt: new Date() })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .returning();

    await db.insert(postingLogsTable).values({
      clientId,
      postId,
      action: "mock_post",
      status: "success",
      provider: "mock",
      payload: { caption: post.caption, platform: post.platform ?? "instagram" },
      responseBody: JSON.stringify({ success: true, mockId: `mock_${Date.now()}`, message: "Post published successfully (mock)" }),
    });

    await writeClientMemory(clientId, "Performance Memory / Mock posted", `User mock posted ${post.platform ?? "social"} post "${post.topic}". Treat this as a final accepted content direction.`);

    res.json({ post: updated, message: "Mock post published successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to mock post" });
  }
});

router.post("/clients/:clientId/posts/:postId/mark-posted", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;
    const updated = await markPublished(postId, clientId);

    if (!updated) { res.status(404).json({ error: "Post not found" }); return; }

    await writeClientMemory(clientId, "Performance Memory / Posted manually", `User marked ${updated.platform ?? "social"} post "${updated.topic}" as posted. Treat this as an accepted final content direction.`);

    res.json({ post: updated, message: "Post marked as posted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark post" });
  }
});

// Webhook export — uses the client's stored webhookUrl, not a user-supplied URL
router.post("/clients/:clientId/webhook/export", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { postId } = req.body as { postId?: string };

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId))
      .limit(1);

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    let posts;
    if (postId) {
      posts = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .limit(1);
    } else {
      posts = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.clientId, clientId), inArray(postsTable.status, ["approved", "export_ready"])));
    }

    const payload = buildPublishPackage(client.name, posts);

    const storedWebhookUrl = (client as { webhookUrl?: string | null }).webhookUrl;

    if (!storedWebhookUrl) {
      res.json({ success: false, payload, message: "No webhook URL configured for this client. Configure it in Settings." });
      return;
    }

    try {
      const hookRes = await fetch(storedWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      for (const post of posts) {
        await db.insert(postingLogsTable).values({
          clientId,
          postId: post.id,
          action: "webhook_export",
          status: hookRes.ok ? "success" : "failed",
          provider: "webhook",
          payload,
          responseBody: `HTTP ${hookRes.status}`,
        });
      }

      res.json({ success: hookRes.ok, status: hookRes.status, payload, message: hookRes.ok ? "Webhook delivery successful" : `Webhook returned ${hookRes.status}` });
    } catch (fetchErr) {
      res.status(502).json({ error: "Failed to call webhook", details: String(fetchErr) });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to export via webhook" });
  }
});

export default router;
