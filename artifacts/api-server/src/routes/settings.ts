import { Router } from "express";
import { db } from "@workspace/db";
import { userSettingsTable, userApiKeysTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  getProviderKeyStatus,
  generateTextWithProvider,
  resolveModel,
  resolveApiKey,
  toAiErrorResponse,
  safeErrorMessage,
} from "../lib/ai-provider.js";
import { encrypt, decrypt, maskKey, extractHint } from "../lib/encryption.js";
import { logger } from "../lib/logger.js";

const router = Router();

const VALID_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
type Provider = typeof VALID_PROVIDERS[number];

// GET /settings/provider-status — which AI provider keys are configured (DB or env)
router.get("/settings/provider-status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const status = await getProviderKeyStatus(req.userId);
    res.json(status);
  } catch {
    res.status(500).json({ error: "Failed to get provider status" });
  }
});

// GET /settings/api-keys — returns masked key info (never plaintext)
router.get("/settings/api-keys", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const rows = await db
      .select({ provider: userApiKeysTable.provider, keyHint: userApiKeysTable.keyHint })
      .from(userApiKeysTable)
      .where(eq(userApiKeysTable.userId, req.userId!));

    const result: Record<string, { masked: string; source: "database" } | null> = {
      anthropic: null,
      openai: null,
      gemini: null,
    };
    for (const row of rows) {
      result[row.provider] = { masked: maskKey(row.provider, row.keyHint), source: "database" };
    }
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to get API keys" });
  }
});

// PUT /settings/api-keys/:provider — save (encrypt + upsert) a key
router.put("/settings/api-keys/:provider", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { provider } = req.params;
    if (!VALID_PROVIDERS.includes(provider as Provider)) {
      res.status(400).json({ error: "Invalid provider" }); return;
    }
    const { key } = req.body as { key?: string };
    if (!key || key.trim().length < 8) {
      res.status(400).json({ error: "Key must be at least 8 characters" }); return;
    }
    const plaintext = key.trim();
    const encryptedKey = encrypt(plaintext);
    const keyHint = extractHint(plaintext);

    await db
      .insert(userApiKeysTable)
      .values({ userId: req.userId!, provider, encryptedKey, keyHint })
      .onConflictDoUpdate({
        target: [userApiKeysTable.userId, userApiKeysTable.provider],
        set: { encryptedKey, keyHint, updatedAt: new Date() },
      });

    logger.info({ provider, userId: req.userId }, "API key saved");
    res.json({ provider, masked: maskKey(provider, keyHint), source: "database" });
  } catch (err) {
    logger.error({ error: safeErrorMessage(err) }, "API key save error");
    res.status(500).json({ error: "Failed to save API key" });
  }
});

// DELETE /settings/api-keys/:provider — remove a stored key
router.delete("/settings/api-keys/:provider", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { provider } = req.params;
    if (!VALID_PROVIDERS.includes(provider as Provider)) {
      res.status(400).json({ error: "Invalid provider" }); return;
    }
    await db
      .delete(userApiKeysTable)
      .where(and(eq(userApiKeysTable.userId, req.userId!), eq(userApiKeysTable.provider, provider)));

    logger.info({ provider, userId: req.userId }, "API key deleted");
    res.json({ deleted: true, provider });
  } catch (err) {
    logger.error({ error: safeErrorMessage(err) }, "API key delete error");
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

// POST /settings/test-ai-provider — verify a provider+model works end-to-end
router.post("/settings/test-ai-provider", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { provider, model: rawModel } = req.body as { provider?: string; model?: string };
    if (!provider) { res.status(400).json({ error: "provider is required" }); return; }

    const status = await getProviderKeyStatus(req.userId);
    const providerStatus = status[provider];
    if (!providerStatus?.keyExists) {
      res.json({ success: false, provider, model: rawModel ?? "", keyFound: false, error: `No API key configured for ${provider}. Add one in Settings → AI Keys.` });
      return;
    }

    const model = resolveModel(provider, rawModel ?? "");
    const keySource = providerStatus.source;
    logger.info({ provider, model, keySource }, "AI provider test requested");

    const response = await generateTextWithProvider(provider, model, "Reply with only the word OK and nothing else.", 10, req.userId);
    const success = response.trim().toLowerCase().includes("ok");

    res.json({ success, provider, model, keyFound: true, keySource });
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
