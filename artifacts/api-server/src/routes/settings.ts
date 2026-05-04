import { Router } from "express";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  getProviderKeyStatus,
  generateTextWithProvider,
  resolveModel,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /settings/provider-status — which AI provider keys are configured in env
router.get("/settings/provider-status", requireAuth, (_req, res): void => {
  res.json(getProviderKeyStatus());
});

// POST /settings/test-ai-provider — send a minimal prompt to verify provider+model work
router.post("/settings/test-ai-provider", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { provider, model: rawModel } = req.body as { provider?: string; model?: string };
    if (!provider) { res.status(400).json({ error: "provider is required" }); return; }

    const status = getProviderKeyStatus();
    const providerStatus = status[provider];
    if (!providerStatus?.keyExists) {
      res.json({ success: false, provider, model: rawModel ?? "", keyFound: false, error: `No API key configured for ${provider}. Add the key to your .env file.` });
      return;
    }

    const model = resolveModel(provider, rawModel ?? "");
    logger.info({ provider, model, keyFound: true }, "AI provider test requested");

    const response = await generateTextWithProvider(provider, model, "Reply with only the word OK and nothing else.", 10);
    const success = response.trim().toLowerCase().includes("ok");

    res.json({ success, provider, model, keyFound: true });
  } catch (err) {
    logger.error({ error: safeErrorMessage(err) }, "AI provider test error");
    const { message } = toAiErrorResponse(err, "Provider test failed — check your API key.");
    res.json({ success: false, provider: req.body?.provider ?? "", model: req.body?.model ?? "", keyFound: true, error: message });
  }
});

// GET /settings
router.get("/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const [existing] = await db
      .select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);

    if (existing) { res.json(existing); return; }

    const [created] = await db
      .insert(userSettingsTable)
      .values({ userId })
      .returning();
    res.json(created);
  } catch {
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// PUT /settings
router.put("/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const { aiProvider, aiModel, imageProvider, imageModel } = req.body as {
      aiProvider?: string;
      aiModel?: string;
      imageProvider?: string;
      imageModel?: string;
    };

    const [existing] = await db
      .select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(userSettingsTable)
        .set({ aiProvider, aiModel, imageProvider, imageModel, updatedAt: new Date() })
        .where(eq(userSettingsTable.userId, userId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(userSettingsTable)
        .values({ userId, aiProvider: aiProvider ?? "anthropic", aiModel: aiModel ?? "claude-sonnet-4-6", imageProvider: imageProvider ?? "openai", imageModel: imageModel ?? "dall-e-3" })
        .returning();
      res.json(created);
    }
  } catch {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
