import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, qualityChecksTable } from "@workspace/db/schema";
import { executeSkill, getSkillSaveDestination, SkillEngineError } from "../lib/skill-engine.js";
import { evaluateQuality } from "../lib/quality-gate.js";
import { toAiErrorResponse, safeErrorMessage } from "../lib/ai-provider.js";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

function stringFromOutput(output: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = output[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function hashtagsFromOutput(output: Record<string, unknown>): string {
  const hashtags = output.hashtags;
  if (Array.isArray(hashtags)) return hashtags.map(String).join(" ");
  if (typeof hashtags === "string") return hashtags;
  return "";
}

function postTypeForContentType(contentType: string): "social" | "blog" | "newsletter" {
  if (contentType === "blog") return "blog";
  if (contentType === "newsletter") return "newsletter";
  return "social";
}

router.post(
  "/clients/:clientId/skills/:skillId/execute",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res) => {
    const { clientId, skillId } = req.params;
    const {
      input,
      campaignId,
      storylineId,
    } = req.body as {
      input?: Record<string, unknown>;
      campaignId?: string;
      storylineId?: string;
    };

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      res.status(400).json({ error: "input object is required" });
      return;
    }

    try {
      const result = await executeSkill({
        clientId,
        skillId,
        input,
        userId: req.userId,
      });

      const saveDestination = getSkillSaveDestination(result.skill);
      const contentType = saveDestination.content_type ?? result.skill.category ?? "social_post";
      const platform = stringFromOutput(result.output, ["platform"], saveDestination.platform ?? "social");
      const topic = stringFromOutput(result.output, ["topic", "title", "seoTitle", "subject"], "Untitled skill draft");
      const caption = stringFromOutput(result.output, ["caption", "metaDescription", "preheader", "hook"], "");
      const imagePrompt = stringFromOutput(result.output, ["imagePrompt", "visualDirection"], "");
      const title = stringFromOutput(result.output, ["title", "seoTitle", "subject"], "");
      const longFormBody = stringFromOutput(result.output, ["fullDraft", "body", "voiceoverFull"], "");
      const quality = evaluateQuality({ skill: result.skill, output: result.output });

      const [post] = await db.transaction(async (tx) => {
        const [createdPost] = await tx
          .insert(postsTable)
          .values({
            clientId,
            campaignId: campaignId ?? null,
            storylineId: storylineId ?? null,
            skillId,
            contentType,
            contentSchema: result.output,
            contentSchemaVersion: 1,
            topic,
            caption,
            hashtags: hashtagsFromOutput(result.output),
            platform,
            postType: postTypeForContentType(contentType),
            title: title || null,
            longFormBody: longFormBody || null,
            imagePrompt: imagePrompt || null,
            qualityScore: quality.score,
            qualityReport: quality.report,
            status: "draft",
            generationStatus: "ready",
            generationMetadata: {
              ...result.metadata,
              route: "skill_engine.execute",
            },
          })
          .returning();

        await tx.insert(qualityChecksTable).values({
          postId: createdPost.id,
          skillId,
          score: quality.score,
          report: quality.report,
        });

        return [createdPost];
      });

      res.json({ post, output: result.output });
    } catch (err) {
      if (err instanceof SkillEngineError) {
        res.status(err.status).json({ error: err.message });
        return;
      }

      const { status, message } = toAiErrorResponse(
        err,
        "Failed to execute skill. Check the skill config and AI provider settings."
      );
      logger.error({ error: safeErrorMessage(err), skillId, clientId }, "Skill execute error");
      res.status(status).json({ error: message });
    }
  }
);

export default router;
