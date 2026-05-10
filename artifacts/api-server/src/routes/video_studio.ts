/**
 * Video Studio routes
 *
 * POST /clients/:clientId/video-studio/generate
 *   - Topic/concept input
 *   - AI generates: hook, 5-scene storyboard, voiceover per scene,
 *     subtitle style, CTA, platform recommendation, provider suggestion
 *   - Saves to posts table as contentType "video_script" (status: "draft")
 *
 * GET  /clients/:clientId/video-studio/concepts — list video concepts
 * GET  /clients/:clientId/video-studio/concepts/:conceptId — single concept
 * PATCH /clients/:clientId/video-studio/concepts/:conceptId — update concept
 *
 * Note: actual video rendering is not yet integrated. Provider cards
 * show recommended tools (Kling, Runway, Pika, Luma, Veo) as "coming soon".
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "../lib/client-memory-packet.js";
import {
  generateTextWithFallback,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { resolveTextProviderForMode, VIDEO_PROVIDERS, type QualityMode } from "../lib/provider-router.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

function postToVideoConcept(post: typeof postsTable.$inferSelect) {
  const schema = (post.contentSchema ?? {}) as Partial<GeneratedVideoConcept>;
  return {
    id: post.id,
    postId: post.id,
    topic: post.topic,
    title: schema.title ?? post.title ?? post.topic,
    targetPlatform: schema.platform ?? post.platform,
    platform: schema.platform ?? post.platform,
    hook: schema.hook ?? post.caption,
    scenesJson: JSON.stringify(schema.scenes ?? []),
    scenes: schema.scenes ?? [],
    voiceoverScript: schema.voiceoverFull ?? null,
    voiceoverFull: schema.voiceoverFull ?? "",
    subtitleStyle: schema.subtitleStyle ?? null,
    cta: schema.cta ?? null,
    estimatedDuration: schema.estimatedDuration ?? null,
    recommendedProvider: schema.recommendedProvider ?? null,
    providerNotes: schema.providerRationale ?? null,
    providerRationale: schema.providerRationale ?? "",
    musicMood: schema.musicMood ?? "",
    colorGrading: schema.colorGrading ?? "",
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoScene {
  order: number;
  duration: string;
  visual: string;
  text: string;
  voiceover: string;
}

interface GeneratedVideoConcept {
  title: string;
  platform: string;
  hook: string;
  estimatedDuration: string;
  scenes: VideoScene[];
  voiceoverFull: string;
  subtitleStyle: string;
  cta: string;
  recommendedProvider: string;
  providerRationale: string;
  musicMood: string;
  colorGrading: string;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildVideoPrompt(context: string, params: {
  topic: string;
  platform?: string;
  duration?: string;
  style?: string;
}): string {
  const platform = params.platform ?? "instagram_reels";
  const duration = params.duration ?? "30s";

  return `You are a senior video content strategist and script writer.
Generate a complete short-form video concept and storyboard for social media.

${context}

## Video Assignment
Topic: "${params.topic}"
Target platform: ${platform}
Target duration: ${duration}
${params.style ? `Visual style: ${params.style}` : ""}

## Requirements
- hook: the opening 3-second line or visual that stops the scroll — must be punchy and specific
- 5 scenes with exact durations that add up to the total duration
- Each scene: visual (what the camera shows), text (on-screen overlay), voiceover (spoken words)
- voiceoverFull: full voiceover script stitched together
- subtitleStyle: one of bold_captions | minimal | karaoke | none
- cta: the specific call to action at the end (not generic "follow us")
- recommendedProvider: one of kling | runway | pika | luma | veo — best for this concept
- providerRationale: one sentence why that provider is best for this concept
- musicMood: e.g. "upbeat electronic", "calm acoustic", "no music — VO only"
- colorGrading: brief description of colour tone (e.g. "warm golden tones", "cool blue cinematic")
- estimatedDuration: total duration string e.g. "30s"
- platform: the exact platform string

Quality rules:
- Hook must reference something specific to the brand or topic — no generic "Hey guys..."
- Voiceover per scene should feel natural, conversational, not corporate
- Scene durations must be realistic (3s–15s each) and sum to the target duration
- CTA must match the campaign goal implied by the topic

Respond with ONLY valid JSON — no markdown fences:
{
  "title": "Short concept title",
  "platform": "${platform}",
  "hook": "Opening 3-second line or visual description",
  "estimatedDuration": "${duration}",
  "scenes": [
    {
      "order": 1,
      "duration": "3s",
      "visual": "What camera sees",
      "text": "On-screen text overlay",
      "voiceover": "Spoken words"
    }
  ],
  "voiceoverFull": "Full script stitched together",
  "subtitleStyle": "bold_captions",
  "cta": "Specific call to action",
  "recommendedProvider": "kling",
  "providerRationale": "Why this provider",
  "musicMood": "upbeat electronic",
  "colorGrading": "warm golden tones"
}`;
}

// ---------------------------------------------------------------------------
// POST /clients/:clientId/video-studio/generate
// ---------------------------------------------------------------------------

router.post(
  "/clients/:clientId/video-studio/generate",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId } = req.params;
    const {
      topic,
      platform,
      duration,
      style,
      qualityMode = "balanced",
      campaignId,
      storylineId,
    } = req.body as {
      topic?: string;
      platform?: string;
      duration?: string;
      style?: string;
      qualityMode?: QualityMode;
      campaignId?: string;
      storylineId?: string;
    };

    if (!topic?.trim()) {
      res.status(400).json({ error: "topic is required" });
      return;
    }

    try {
      const packet  = await buildClientMemoryPacket(clientId);
      const context = formatClientMemoryPacket(packet);
      const { provider, model, label } = await resolveTextProviderForMode(
        qualityMode as QualityMode,
        req.userId
      );

      const prompt = buildVideoPrompt(context, { topic, platform, duration, style });

      const { text: raw, usedProvider, fallbackUsed } = await generateTextWithFallback(
        provider, model, prompt, 3000, req.userId
      );

      logger.info(
        { chosenProvider: usedProvider, requestedProvider: provider, label, fallbackUsed, clientId },
        "Video Studio: AI complete"
      );

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI returned no JSON");
      const gen = JSON.parse(jsonMatch[0]) as GeneratedVideoConcept;

      const voiceoverScript = gen.voiceoverFull ?? (gen.scenes ?? []).map(s => s.voiceover).join(" ");

      const [post] = await db
        .insert(postsTable)
        .values({
          clientId,
          campaignId:       campaignId ?? null,
          storylineId:      storylineId ?? null,
          contentType:      "video_script",
          contentSchema:    gen,
          contentSchemaVersion: 1,
          topic:            gen.title ?? topic,
          caption:          gen.hook ?? "",
          hashtags:         "",
          platform:         gen.platform ?? platform ?? "instagram_reels",
          postType:         "social",
          status:           "draft",
          generationStatus: "ready",
          title:            gen.title ?? topic,
          longFormBody:     voiceoverScript,
          generationMetadata: {
            route: "video_studio.generate",
            provider: usedProvider,
            requestedProvider: provider,
            model,
            fallbackUsed,
            qualityMode,
            requestedPlatform: platform ?? null,
            requestedDuration: duration ?? null,
            style: style ?? null,
          },
        })
        .returning();

      res.json({
        post,
        concept: postToVideoConcept(post),
        generated: gen,
        videoProviders: VIDEO_PROVIDERS,
        meta: { provider: usedProvider, fallbackUsed },
      });
    } catch (err) {
      const { status, message } = toAiErrorResponse(
        err, "Failed to generate video concept. Check your AI provider key in Settings."
      );
      logger.error({ error: safeErrorMessage(err) }, "Video Studio generate error");
      res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/video-studio/concepts
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/video-studio/concepts",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const concepts = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.clientId, req.params.clientId), eq(postsTable.contentType, "video_script")))
        .orderBy(postsTable.createdAt);

      res.json({ concepts: concepts.map(postToVideoConcept) });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Video concepts list error");
      res.status(500).json({ error: "Failed to list video concepts" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/video-studio/concepts/:conceptId
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/video-studio/concepts/:conceptId",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res) => {
    try {
      const [concept] = await db
        .select()
        .from(postsTable)
        .where(
          and(
            eq(postsTable.id, req.params.conceptId),
            eq(postsTable.clientId, req.params.clientId),
            eq(postsTable.contentType, "video_script")
          )
        )
        .limit(1);

      if (!concept) {
        res.status(404).json({ error: "Video concept not found" });
        return;
      }
      res.json({ concept: postToVideoConcept(concept), post: concept });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Video concept get error");
      res.status(500).json({ error: "Failed to get video concept" });
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /clients/:clientId/video-studio/concepts/:conceptId
// ---------------------------------------------------------------------------

router.patch(
  "/clients/:clientId/video-studio/concepts/:conceptId",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { hook, scenesJson, voiceoverScript, cta, subtitleStyle, status } = req.body as {
      hook?: string;
      scenesJson?: string;
      voiceoverScript?: string;
      cta?: string;
      subtitleStyle?: string;
      status?: string;
    };

    try {
      const [existing] = await db
        .select()
        .from(postsTable)
        .where(
          and(
            eq(postsTable.id, req.params.conceptId),
            eq(postsTable.clientId, req.params.clientId),
            eq(postsTable.contentType, "video_script")
          )
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Video concept not found" });
        return;
      }

      const existingSchema = (existing.contentSchema ?? {}) as Partial<GeneratedVideoConcept>;
      const nextScenes = scenesJson !== undefined ? JSON.parse(scenesJson) : existingSchema.scenes;
      const nextSchema: Partial<GeneratedVideoConcept> = {
        ...existingSchema,
        ...(hook            !== undefined ? { hook } : {}),
        ...(nextScenes      !== undefined ? { scenes: nextScenes } : {}),
        ...(voiceoverScript !== undefined ? { voiceoverFull: voiceoverScript } : {}),
        ...(cta             !== undefined ? { cta } : {}),
        ...(subtitleStyle   !== undefined ? { subtitleStyle } : {}),
      };

      const [updated] = await db
        .update(postsTable)
        .set({
          ...(hook            !== undefined ? { caption: hook } : {}),
          ...(voiceoverScript !== undefined ? { longFormBody: voiceoverScript } : {}),
          contentSchema: nextSchema,
          contentSchemaVersion: 1,
          ...(status          !== undefined ? { status } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(postsTable.id, req.params.conceptId),
            eq(postsTable.clientId, req.params.clientId),
            eq(postsTable.contentType, "video_script")
          )
        )
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Video concept not found" });
        return;
      }
      res.json({ concept: postToVideoConcept(updated), post: updated });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Video concept update error");
      res.status(500).json({ error: "Failed to update video concept" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /clients/:clientId/video-studio/providers
// ---------------------------------------------------------------------------

router.get(
  "/clients/:clientId/video-studio/providers",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (_req: AuthRequest, res) => {
    res.json({ providers: VIDEO_PROVIDERS });
  }
);

export default router;
