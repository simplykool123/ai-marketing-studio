import { Router } from "express";
import { db } from "@workspace/db";
import { userSettingsTable, userApiKeysTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  getProviderKeyStatus,
  getProviderControls,
  normalizeProviderControls,
  generateTextWithProvider,
  generateTextWithRawKey,
  resolveModel,
  resolveApiKey,
  toAiErrorResponse,
  safeErrorMessage,
  aiErrorCategory,
} from "../lib/ai-provider.js";
import { encrypt, decrypt, maskKey, extractHint } from "../lib/encryption.js";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { ensureStorageBucket } from "./upload.js";
import { logger } from "../lib/logger.js";

const router = Router();

const VALID_PROVIDERS = ["anthropic", "openai", "gemini", "replicate", "ideogram", "serper", "tavily", "twitter", "kling", "elevenlabs"] as const;
type Provider = typeof VALID_PROVIDERS[number];
type HealthStatus = "green" | "yellow" | "red";

function envConfigured(...keys: string[]): boolean {
  return keys.every((key) => Boolean(process.env[key]));
}

function healthItem(id: string, label: string, status: HealthStatus, message: string) {
  return { id, label, status, message };
}

// GET /settings/provider-status — which AI provider keys are configured (DB or env)
router.get("/settings/provider-status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const status = await getProviderKeyStatus(req.userId);
    res.json(status);
  } catch {
    res.status(500).json({ error: "Failed to get provider status" });
  }
});

router.get("/settings/provider-controls", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [controls, status] = await Promise.all([
      getProviderControls(req.userId),
      getProviderKeyStatus(req.userId),
    ]);
    res.json({ controls, status });
  } catch {
    res.status(500).json({ error: "Failed to get provider controls" });
  }
});

router.put("/settings/provider-controls", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const controls = normalizeProviderControls(req.body?.controls);
    const [existing] = await db
      .select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);

    const [saved] = existing
      ? await db
          .update(userSettingsTable)
          .set({ providerControls: controls, updatedAt: new Date() })
          .where(eq(userSettingsTable.userId, userId))
          .returning()
      : await db
          .insert(userSettingsTable)
          .values({ userId, providerControls: controls })
          .returning();

    res.json({ controls: normalizeProviderControls(saved.providerControls) });
  } catch (err) {
    logger.error({ error: safeErrorMessage(err) }, "Provider controls save error");
    res.status(500).json({ error: "Failed to save provider controls" });
  }
});

// GET /settings/health — operational readiness without exposing secrets
router.get("/settings/health", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const items: ReturnType<typeof healthItem>[] = [];

  try {
    await db.execute(sql`select 1`);
    items.push(healthItem("database", "Database connected", "green", "Postgres responded to a simple health query."));
  } catch {
    items.push(healthItem("database", "Database connected", "red", "Database query failed. Check DATABASE_URL and Supabase availability."));
  }

  try {
    await ensureStorageBucket();
    items.push(healthItem("storage", "Supabase storage configured", "green", "post-images bucket is reachable and configured for current uploads."));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage check failed.";
    items.push(healthItem("storage", "Supabase storage configured", "red", message));
  }

  try {
    const providerStatus = await getProviderKeyStatus(req.userId);
    const configuredProviders = Object.entries(providerStatus)
      .filter(([, status]) => status.keyExists)
      .map(([provider, status]) => `${provider} (${status.source})`);
    items.push(healthItem(
      "ai_provider",
      "AI provider available",
      configuredProviders.length > 0 ? "green" : "red",
      configuredProviders.length > 0
        ? `Configured: ${configuredProviders.join(", ")}.`
        : "No AI provider key is configured in Settings or backend env."
    ));
  } catch {
    items.push(healthItem("ai_provider", "AI provider available", "red", "Could not check AI provider status."));
  }

  const tokenEncryptionReady = isEncryptionConfigured();
  items.push(healthItem(
    "token_encryption",
    "TOKEN_ENCRYPTION_KEY configured",
    tokenEncryptionReady ? "green" : "red",
    tokenEncryptionReady ? "Encrypted token storage is available." : "Required before OAuth tokens, analytics refresh, and auto-publish."
  ));

  const autoPublishEnabled = process.env.ENABLE_AUTO_PUBLISH !== "false";
  items.push(healthItem(
    "auto_publish",
    "Auto-publish",
    autoPublishEnabled ? "yellow" : "green",
    autoPublishEnabled
      ? "Enabled for this API process. Use only after real social connectors are tested."
      : "Disabled. Recommended until live social connectors are tested."
  ));

  const metaConfigured = envConfigured("META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI");
  items.push(healthItem(
    "meta_credentials",
    "Meta credentials",
    metaConfigured ? "green" : "yellow",
    metaConfigured ? "Meta app credentials are present." : "Missing one or more Meta app credentials; Meta OAuth/publishing stays unavailable."
  ));

  const falConfigured = envConfigured("FAL_KEY");
  items.push(healthItem(
    "fal_key",
    "FAL_KEY",
    falConfigured ? "green" : "yellow",
    falConfigured ? "Video generation key is configured." : "Missing. Video Studio should show the configured missing-key message."
  ));

  const replicateConfigured = envConfigured("REPLICATE_API_KEY");
  items.push(healthItem(
    "replicate_key",
    "REPLICATE_API_KEY",
    replicateConfigured ? "green" : "yellow",
    replicateConfigured ? "Flux image generation is configured." : "Missing. Flux stays disabled unless a key is saved in Settings → AI Keys."
  ));

  const ideogramConfigured = envConfigured("IDEOGRAM_API_KEY");
  items.push(healthItem(
    "ideogram_key",
    "IDEOGRAM_API_KEY",
    ideogramConfigured ? "green" : "yellow",
    ideogramConfigured ? "Ideogram image generation is configured." : "Missing. Ideogram stays disabled unless a key is saved in Settings → AI Keys."
  ));

  const klingConfigured = envConfigured("KLING_API_KEY");
  items.push(healthItem(
    "kling_key",
    "KLING_API_KEY",
    klingConfigured ? "yellow" : "yellow",
    klingConfigured ? "Kling key is present; API integration remains scaffold-only until endpoint details are enabled." : "Missing. Video generation stays disconnected; reel script flow still works."
  ));

  const elevenLabsConfigured = envConfigured("ELEVENLABS_API_KEY");
  items.push(healthItem(
    "elevenlabs_key",
    "ELEVENLABS_API_KEY",
    elevenLabsConfigured ? "yellow" : "yellow",
    elevenLabsConfigured ? "ElevenLabs key is present; voiceover generation remains scaffold-only until provider flow is enabled." : "Missing. Voiceover audio is disabled; reel script flow still works."
  ));

  const googleDriveConfigured = envConfigured("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI");
  items.push(healthItem(
    "google_drive_archive",
    "Google Drive archive",
    googleDriveConfigured ? "yellow" : "yellow",
    googleDriveConfigured
      ? "Archive env is present, but Drive OAuth/upload is scaffold-only in V1."
      : "Missing. Optional; app storage still uses Supabase as active working storage."
  ));

  const hasRed = items.some((item) => item.status === "red");
  const hasYellow = items.some((item) => item.status === "yellow");
  res.json({
    status: hasRed ? "red" : hasYellow ? "yellow" : "green",
    generatedAt: new Date().toISOString(),
    items,
  });
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
      replicate: null,
      ideogram: null,
      serper: null,
      tavily: null,
      twitter: null,
      kling: null,
      elevenlabs: null,
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
  const routeUsed = "settings.test-ai-provider → generateTextWithProvider";
  try {
    const { provider, model: rawModel } = req.body as { provider?: string; model?: string };
    if (!provider) { res.status(400).json({ error: "provider is required" }); return; }

    const status = await getProviderKeyStatus(req.userId);
    const providerStatus = status[provider];
    if (!providerStatus?.keyExists) {
      res.json({
        success: false,
        provider,
        model: rawModel ?? "",
        keyFound: false,
        routeUsed,
        error: `No API key configured for ${provider}. Add one in Settings → AI Keys.`,
      });
      return;
    }

    const model = resolveModel(provider, rawModel ?? "");
    const keySource = providerStatus.source;
    const keyHint = providerStatus.keyHint;
    logger.info({ provider, model, keySource, keyHint, userIdPresent: req.userId ? "yes" : "no", routeUsed }, "AI provider test requested");

    const response = await generateTextWithProvider(provider, model, "Reply with only the word OK and nothing else.", 10, req.userId);
    const success = response.trim().toLowerCase().includes("ok");
    let warning: string | undefined;
    let envComparison: { keySource: "env"; keyHint: string; success: boolean; failureReason?: string } | undefined;

    if (provider === "openai" && keySource === "database" && process.env.OPENAI_KEY) {
      const envHint = extractHint(process.env.OPENAI_KEY);
      try {
        const envResponse = await generateTextWithRawKey(provider, model, process.env.OPENAI_KEY, "Reply with only the word OK and nothing else.", 10);
        envComparison = {
          keySource: "env",
          keyHint: envHint,
          success: envResponse.trim().toLowerCase().includes("ok"),
        };
      } catch (err) {
        envComparison = {
          keySource: "env",
          keyHint: envHint,
          success: false,
          failureReason: aiErrorCategory(err),
        };
      }
      if (success && envComparison && !envComparison.success) {
        warning = "OpenAI DB key works, but server .env OpenAI key is invalid. Some routes may be using env because userId was not passed.";
      }
    }

    res.json({ success, provider, model, keyFound: true, keySource, keyHint, routeUsed, warning, envComparison });
  } catch (err) {
    logger.error({ error: safeErrorMessage(err), routeUsed }, "AI provider test error");
    const { message } = toAiErrorResponse(err, "Provider test failed — check your API key.");
    res.json({
      success: false,
      provider: req.body?.provider ?? "",
      model: req.body?.model ?? "",
      keyFound: true,
      routeUsed,
      error: message,
    });
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
