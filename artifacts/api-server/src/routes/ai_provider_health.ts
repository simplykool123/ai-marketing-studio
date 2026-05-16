import { Router } from "express";
import {
  DEFAULT_MODELS,
  PROVIDER_PRIORITY,
  getProviderHealthSnapshot,
  getProviderKeyStatus,
} from "../lib/ai-provider.js";
import { resolveTextProviderForMode } from "../lib/provider-router.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();

function recentFailureOnly(record: ReturnType<typeof getProviderHealthSnapshot>[string] | undefined) {
  if (!record?.lastFailureAt) return null;
  return {
    category: record.lastFailureCategory ?? "unknown",
    reason: record.lastFailureReason ?? "unavailable",
    at: record.lastFailureAt,
  };
}

router.get("/ai/provider-health", async (req: AuthRequest, res): Promise<void> => {
  const keyStatus = await getProviderKeyStatus(req.userId);
  const health = getProviderHealthSnapshot();
  const providers = PROVIDER_PRIORITY.map((provider) => {
    const status = keyStatus[provider];
    const record = health[provider];
    return {
      provider,
      keyExists: Boolean(status?.keyExists),
      source: status?.source ?? "none",
      model: record?.model ?? DEFAULT_MODELS[provider],
      lastKnownSuccessAt: record?.lastSuccessAt ?? null,
      lastKnownFailure: recentFailureOnly(record),
    };
  });

  let recommendedProviderRoute: { provider: string; model: string; label: string } | null = null;
  try {
    recommendedProviderRoute = await resolveTextProviderForMode("balanced", req.userId);
  } catch {
    recommendedProviderRoute = null;
  }

  const configured = providers.filter((provider) => provider.keyExists);
  const working = configured.filter((provider) => provider.lastKnownSuccessAt);
  const failedConfigured = configured.filter((provider) => provider.lastKnownFailure);
  const status = configured.length === 0
    ? "red"
    : working.length > 0
      ? "green"
      : failedConfigured.length === configured.length
        ? "red"
        : "yellow";

  res.json({
    status,
    providers,
    recommendedProviderRoute,
    warning: status === "green"
      ? `${working[0]?.provider ?? "AI provider"} worked recently.`
      : status === "yellow"
        ? "AI keys exist, but live provider health is not confirmed yet. Try generating once or update Settings → AI Keys if generation fails."
        : configured.length
          ? "Configured AI providers have recent failures. Update Settings → AI Keys or check provider quota."
          : "No AI provider key configured. Add one in Settings → AI Keys.",
    generatedAt: new Date().toISOString(),
  });
});

export default router;
