// Phase 51 — Honest video render-job lifecycle.
// We do NOT have a real MP4 render worker yet. Per the Phase 51 brief
// "Option B": expose a render-job lifecycle so the UI and the Queue can show
// truthful state (planned → queued → rendering → rendered → failed) and the
// route honestly returns 503 "render worker not connected" when no worker
// is registered.
//
// No fake MP4. videoUrl is NEVER set unless a real worker uploads one.

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { postsTable } from "@workspace/db/schema";
import { EDIT_CONTENT_ROLES, ALL_CLIENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { safeErrorMessage } from "../lib/ai-provider.js";

const router = Router();

// Set this env var when an external render worker becomes available. Until
// then we return a truthful "not connected" response with no fake URL.
const RENDER_WORKER_URL = process.env.RENDER_WORKER_URL ?? "";

type RenderState = "planned" | "queued" | "rendering" | "rendered" | "failed";

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readRenderJob(post: { contentSchema?: unknown }): {
  state: RenderState;
  videoUrl: string | null;
  message: string | null;
  updatedAt: string | null;
  spec: Record<string, unknown> | null;
} {
  const schema = asRecord(post.contentSchema);
  const spec = asRecord(schema.videoRenderSpec);
  const renderJob = asRecord(schema.renderJob);
  const state = (typeof renderJob.state === "string" && ["planned", "queued", "rendering", "rendered", "failed"].includes(renderJob.state)
    ? renderJob.state
    : Object.keys(spec).length > 0 ? "planned" : "planned") as RenderState;
  return {
    state,
    videoUrl: typeof schema.videoUrl === "string" && schema.videoUrl ? schema.videoUrl
      : typeof schema.finalVideoUrl === "string" && schema.finalVideoUrl ? schema.finalVideoUrl
      : null,
    message: typeof renderJob.message === "string" ? renderJob.message : null,
    updatedAt: typeof renderJob.updatedAt === "string" ? renderJob.updatedAt : null,
    spec: Object.keys(spec).length > 0 ? spec : null,
  };
}

async function writeRenderJob(clientId: string, postId: string, next: { state: RenderState; message?: string; videoUrl?: string }) {
  const [post] = await db
    .select()
    .from(postsTable)
    .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
    .limit(1);
  if (!post) return null;
  const schema = asRecord(post.contentSchema);
  const nextSchema = {
    ...schema,
    renderJob: {
      ...asRecord(schema.renderJob),
      state: next.state,
      message: next.message ?? null,
      updatedAt: new Date().toISOString(),
    },
    // We never set videoUrl unless a real worker provided one.
    ...(next.videoUrl ? { videoUrl: next.videoUrl, finalVideoUrl: next.videoUrl } : {}),
  };
  const [updated] = await db
    .update(postsTable)
    .set({ contentSchema: nextSchema, contentSchemaVersion: 1, updatedAt: new Date() })
    .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
    .returning();
  return updated;
}

router.get(
  "/clients/:clientId/video-render/status",
  requireClientRole(ALL_CLIENT_ROLES),
  async (_req: AuthRequest, res): Promise<void> => {
    res.json({
      workerConnected: !!RENDER_WORKER_URL,
      message: RENDER_WORKER_URL
        ? "Render worker is configured."
        : "Render worker not connected. Storyboards + render specs are saved; MP4 render must be done manually or via an external sidecar.",
      workerUrlHint: RENDER_WORKER_URL ? RENDER_WORKER_URL.replace(/^(https?:\/\/[^/]+).*$/, "$1") : null,
    });
  },
);

router.get(
  "/clients/:clientId/video-render/:postId",
  requireClientRole(ALL_CLIENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const [post] = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId)))
        .limit(1);
      if (!post) { res.status(404).json({ error: "Post not found" }); return; }
      res.json({ postId: post.id, ...readRenderJob(post), workerConnected: !!RENDER_WORKER_URL });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Render-job read failed");
      res.status(500).json({ error: "Failed to read render-job state" });
    }
  },
);

// Queue a render. Without a worker URL we honestly write "queued" then return
// 503 with the truthful message. The UI shows "queued — waiting for worker"
// and lets the user export the storyboard instead.
router.post(
  "/clients/:clientId/video-render/:postId/queue",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const [existing] = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId)))
        .limit(1);
      if (!existing) { res.status(404).json({ error: "Post not found" }); return; }
      const job = readRenderJob(existing);
      if (!job.spec) {
        res.status(400).json({ error: "Post has no videoRenderSpec yet. Generate the storyboard first." });
        return;
      }

      if (!RENDER_WORKER_URL) {
        const updated = await writeRenderJob(req.params.clientId, req.params.postId, {
          state: "queued",
          message: "Render worker not connected — queued for when a worker is available.",
        });
        res.status(503).json({
          ok: false,
          state: "queued",
          message: "Render worker not connected. Storyboard + render spec are saved. The job will run when a worker is registered. You can export the storyboard for manual rendering.",
          post: updated,
        });
        return;
      }

      // Worker is configured — POST the spec. We never fake completion.
      const updatedQueued = await writeRenderJob(req.params.clientId, req.params.postId, {
        state: "queued",
        message: "Submitted to render worker.",
      });
      void updatedQueued;
      try {
        const workerRes = await fetch(`${RENDER_WORKER_URL.replace(/\/$/, "")}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: req.params.clientId, postId: req.params.postId, spec: job.spec }),
        });
        if (!workerRes.ok) {
          const updatedFail = await writeRenderJob(req.params.clientId, req.params.postId, {
            state: "failed",
            message: `Worker returned HTTP ${workerRes.status}`,
          });
          res.status(502).json({ ok: false, state: "failed", message: `Worker returned HTTP ${workerRes.status}`, post: updatedFail });
          return;
        }
        const updatedRendering = await writeRenderJob(req.params.clientId, req.params.postId, {
          state: "rendering",
          message: "Worker accepted the job.",
        });
        res.json({ ok: true, state: "rendering", message: "Render worker accepted the job. Poll /video-render/:postId for completion.", post: updatedRendering });
      } catch (workerErr) {
        const updatedFail = await writeRenderJob(req.params.clientId, req.params.postId, {
          state: "failed",
          message: workerErr instanceof Error ? workerErr.message : "Worker unreachable",
        });
        res.status(502).json({ ok: false, state: "failed", message: "Render worker unreachable", post: updatedFail });
      }
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Render-job queue failed");
      res.status(500).json({ error: "Render-job queue failed" });
    }
  },
);

// Webhook the external worker calls when render completes. Auth via a shared
// secret env var so only the trusted worker can complete a job. This is
// mounted on the public chain (see routes/index.ts) so the worker doesn't
// need a Supabase user token. The shared-secret header replaces user auth.
export const renderWorkerWebhookRouter = Router();
renderWorkerWebhookRouter.post(
  "/internal/video-render/complete",
  async (req, res): Promise<void> => {
    const secret = req.headers["x-render-worker-secret"];
    if (!process.env.RENDER_WORKER_SECRET || secret !== process.env.RENDER_WORKER_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body as { clientId?: string; postId?: string; state?: RenderState; videoUrl?: string; message?: string };
    if (!body.clientId || !body.postId || !body.state) {
      res.status(400).json({ error: "clientId, postId, state required" });
      return;
    }
    if (body.state === "rendered" && !body.videoUrl) {
      res.status(400).json({ error: "videoUrl is required when state=rendered" });
      return;
    }
    const updated = await writeRenderJob(body.clientId, body.postId, {
      state: body.state,
      message: body.message,
      videoUrl: body.videoUrl,
    });
    res.json({ ok: true, post: updated });
  },
);

export default router;
