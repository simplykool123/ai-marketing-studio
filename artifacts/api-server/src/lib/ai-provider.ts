/**
 * Canonical AI provider utilities.
 *
 * Key resolution order for every request:
 *   1. User's encrypted key stored in DB (decrypted on the fly)
 *   2. Server-level .env key (ANTHROPIC_KEY / OPENAI_KEY / GEMINI_KEY)
 *
 * Keys are never logged or exposed in error messages.
 * Future: when multi-tenant encrypted DB keys are needed, extend resolveApiKey().
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@workspace/db";
import { userApiKeysTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "./encryption.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Retired model aliases → current working model IDs
// ---------------------------------------------------------------------------

export const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-5": "claude-sonnet-4-6",
  "claude-3-opus-20240229": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "claude-3-haiku-20240307": "claude-sonnet-4-6",
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class AiConfigError extends Error {
  constructor(message: string) { super(message); this.name = "AiConfigError"; }
}

export type AiErrorCategory =
  | "auth"
  | "config"
  | "quota"
  | "model"
  | "network"
  | "unknown";

// ---------------------------------------------------------------------------
// Key resolution — DB first, then .env
// ---------------------------------------------------------------------------

/**
 * Resolves the plaintext API key for a provider.
 * Checks the user's DB-stored encrypted key first, falls back to .env.
 * Throws AiConfigError if no key is available.
 */
export async function resolveApiKey(provider: string, userId?: string): Promise<{ key: string; source: "database" | "env" }> {
  const candidates = await resolveApiKeyCandidates(provider, userId);
  if (candidates.length > 0) return candidates[0]!;

  throw new AiConfigError(
    `No API key configured for ${provider}. Add one in Settings → AI Keys or set the .env variable.`
  );
}

async function resolveApiKeyCandidates(provider: string, userId?: string): Promise<Array<{ key: string; source: "database" | "env" }>> {
  const candidates: Array<{ key: string; source: "database" | "env" }> = [];

  if (userId) {
    const [row] = await db
      .select({ encryptedKey: userApiKeysTable.encryptedKey })
      .from(userApiKeysTable)
      .where(and(eq(userApiKeysTable.userId, userId), eq(userApiKeysTable.provider, provider)))
      .limit(1);
    if (row) {
      try {
        return [{ key: decrypt(row.encryptedKey), source: "database" }];
      } catch {
        // Decryption failure falls through to .env
      }
    }
  }

  const envKey =
    provider === "anthropic" ? process.env.ANTHROPIC_KEY :
    provider === "openai"    ? process.env.OPENAI_KEY :
    provider === "gemini"    ? process.env.GEMINI_KEY :
    undefined;

  if (envKey && !candidates.some((candidate) => candidate.key === envKey)) {
    candidates.push({ key: envKey, source: "env" });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Provider key status (never exposes actual key values)
// ---------------------------------------------------------------------------

export type ProviderKeyStatus = {
  keyExists: boolean;
  source: "env" | "database" | "none";
};

export async function getProviderKeyStatus(userId?: string): Promise<Record<string, ProviderKeyStatus>> {
  const providers = ["anthropic", "openai", "gemini"];
  const result: Record<string, ProviderKeyStatus> = {};

  // Check DB keys for this user
  const dbRows = userId
    ? await db
        .select({ provider: userApiKeysTable.provider })
        .from(userApiKeysTable)
        .where(eq(userApiKeysTable.userId, userId))
    : [];
  const dbProviders = new Set(dbRows.map(r => r.provider));

  for (const p of providers) {
    if (dbProviders.has(p)) {
      result[p] = { keyExists: true, source: "database" };
    } else {
      const envKey =
        p === "anthropic" ? process.env.ANTHROPIC_KEY :
        p === "openai"    ? process.env.OPENAI_KEY :
        p === "gemini"    ? process.env.GEMINI_KEY :
        undefined;
      result[p] = envKey
        ? { keyExists: true, source: "env" }
        : { keyExists: false, source: "none" };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Provider priority & defaults
// ---------------------------------------------------------------------------

// Auto-select / fallback order when user has no preference or preferred key is missing.
// Priority: OpenAI → Gemini → Anthropic.
export const PROVIDER_PRIORITY = ["openai", "gemini", "anthropic"] as const;

export const DEFAULT_MODELS: Record<string, string> = {
  openai:    "gpt-4o",
  gemini:    "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-6",
};

// ---------------------------------------------------------------------------
// Provider + model resolution
// ---------------------------------------------------------------------------

export function resolveModel(provider: string, model: string): string {
  if (provider === "anthropic") return MODEL_ALIASES[model] ?? (model || DEFAULT_MODELS.anthropic);
  if (provider === "openai")    return model || DEFAULT_MODELS.openai;
  if (provider === "gemini")    return model || DEFAULT_MODELS.gemini;
  return model;
}

export async function resolveProviderAndModel(
  settings: { aiProvider: string; aiModel: string } | null,
  userId?: string
): Promise<{ provider: string; model: string }> {
  if (settings) {
    const { aiProvider, aiModel } = settings;
    const status = await getProviderKeyStatus(userId);
    if (status[aiProvider]?.keyExists) {
      return { provider: aiProvider, model: resolveModel(aiProvider, aiModel) };
    }
  }

  // Auto-detect from available keys in priority order: OpenAI → Gemini → Anthropic
  const status = await getProviderKeyStatus(userId);
  for (const p of PROVIDER_PRIORITY) {
    if (status[p]?.keyExists) {
      return { provider: p, model: DEFAULT_MODELS[p] };
    }
  }

  throw new AiConfigError(
    "No AI provider API keys are configured. Add a key in Settings → AI Keys or set an .env variable."
  );
}

// ---------------------------------------------------------------------------
// Error translation (safe, no key leakage)
// ---------------------------------------------------------------------------

function isAuthError(err: unknown): boolean {
  if (err instanceof AiConfigError) return false;
  if (!(err instanceof Error)) return false;
  const lower = err.message.toLowerCase();
  const code = (err as { status?: number; statusCode?: number }).status
    ?? (err as { status?: number; statusCode?: number }).statusCode;
  return (
    code === 401 ||
    code === 403 ||
    lower.includes("authentication") ||
    lower.includes("api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized")
  );
}

export function aiErrorCategory(err: unknown): AiErrorCategory {
  if (err instanceof AiConfigError) return "config";
  if (isAuthError(err)) return "auth";
  if (isQuotaOrCreditError(err)) return "quota";
  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("invalid model"))) {
      return "model";
    }
    if (lower.includes("network") || lower.includes("fetch") || lower.includes("timeout") || lower.includes("econn")) {
      return "network";
    }
  }
  return "unknown";
}

function redactSecrets(msg: string): string {
  return msg
    .replace(/authorization:\s*bearer\s+[^\s,;]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [REDACTED]")
    .replace(/(?:sk-ant-|sk-proj-|sk-|AIza|ssk-proj)[A-Za-z0-9_\-]{3,}(?:\*+[A-Za-z0-9_\-]*)?/g, "[REDACTED]")
    .replace(/[A-Za-z0-9_\-]{2,}\*{3,}[A-Za-z0-9_\-]{2,}/g, "[REDACTED]")
    .replace(/api[_ -]?key\s*(?:provided|is|:)?\s*[A-Za-z0-9_\-*.]{8,}/gi, "API key [REDACTED]");
}

export function toAiErrorResponse(err: unknown, fallback: string): { status: number; message: string } {
  if (err instanceof AiConfigError) return { status: 503, message: err.message };
  if (err instanceof Error) {
    const category = aiErrorCategory(err);
    if (category === "auth") {
      return { status: 503, message: "AI key invalid. Go to Settings → AI Keys and update provider key." };
    }
    if (category === "model") {
      return { status: 503, message: "AI model not recognised — update your model in Settings." };
    }
    return { status: 500, message: fallback };
  }
  return { status: 500, message: fallback };
}

export function safeErrorMessage(err: unknown): string {
  const category = aiErrorCategory(err);
  if (category === "auth") return "AI provider error category: auth";
  if (err instanceof Error) return redactSecrets(err.message);
  return "Unknown error";
}

// ---------------------------------------------------------------------------
// Canonical text generation
// ---------------------------------------------------------------------------

export async function generateTextWithProvider(
  provider: string,
  model: string,
  prompt: string,
  maxTokens = 1500,
  userId?: string
): Promise<string> {
  const candidates = await resolveApiKeyCandidates(provider, userId);
  if (candidates.length === 0) {
    throw new AiConfigError(
      `No API key configured for ${provider}. Add one in Settings → AI Keys or set the .env variable.`
    );
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      logger.info({ provider, model, keySource: candidate.source }, "AI text generation requested");

      if (provider === "openai") {
        const client = new OpenAI({ apiKey: candidate.key });
        const res = await client.chat.completions.create({
          model: model || "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
        });
        return res.choices[0]?.message?.content ?? "";
      }

      if (provider === "gemini") {
        const genai = new GoogleGenerativeAI(candidate.key);
        const geminiModel = genai.getGenerativeModel({ model: model || DEFAULT_MODELS.gemini });
        const res = await geminiModel.generateContent(prompt);
        return res.response.text();
      }

      const anthropic = new Anthropic({ apiKey: candidate.key });
      const msg = await anthropic.messages.create({
        model: model || "claude-sonnet-4-6",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      return msg.content[0].type === "text" ? msg.content[0].text : "";
    } catch (err) {
      lastError = err;
      if (!isAuthError(err) || candidate === candidates[candidates.length - 1]) {
        throw err;
      }
      logger.warn(
        { provider, keySource: candidate.source, errorCategory: aiErrorCategory(err) },
        "AI text generation key failed — trying next configured key source"
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI provider failed");
}

// ---------------------------------------------------------------------------
// Quota / credit error detection
// ---------------------------------------------------------------------------

/**
 * Returns true for errors that indicate a provider's quota or credits are
 * exhausted — these warrant a fallback attempt to another provider.
 * Auth/model checks are classified separately so logs and user-facing errors
 * can stay safe and actionable.
 */
export function isQuotaOrCreditError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code = (err as { status?: number; statusCode?: number }).status
    ?? (err as { status?: number; statusCode?: number }).statusCode;

  // HTTP 429 = rate-limit / quota; 529 = Anthropic overloaded
  if (code === 429 || code === 529) return true;

  return (
    msg.includes("quota") ||
    msg.includes("insufficient_quota") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("ratelimit") ||
    msg.includes("credits") ||
    msg.includes("billing") ||
    msg.includes("overloaded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("too many requests")
  );
}

// ---------------------------------------------------------------------------
// Text generation with automatic provider fallback
// ---------------------------------------------------------------------------

export type GenerateWithFallbackResult = {
  text: string;
  usedProvider: string;
  usedModel: string;
  fallbackUsed: boolean;
};

/**
 * Attempts text generation with the given provider/model.
 * On auth/quota failures, automatically retries the next available provider
 * in priority order (openai → gemini → anthropic), skipping the already-tried
 * provider.
 *
 * Logs the chosen provider and any fallback that was triggered.
 */
export async function generateTextWithFallback(
  provider: string,
  model: string,
  prompt: string,
  maxTokens: number,
  userId?: string
): Promise<GenerateWithFallbackResult> {
  let initialProviderError: unknown;
  // Attempt preferred provider
  try {
    logger.info({ provider, model }, "AI generation: trying provider");
    const text = await generateTextWithProvider(provider, model, prompt, maxTokens, userId);
    logger.info({ provider, model }, "AI generation: provider succeeded");
    return { text, usedProvider: provider, usedModel: model, fallbackUsed: false };
  } catch (err) {
    initialProviderError = err;
    if (!isQuotaOrCreditError(err) && !isAuthError(err)) throw err;
    logger.warn(
      { provider, errorCategory: aiErrorCategory(err) },
      "AI generation: provider failed — trying fallback providers"
    );
  }

  // Try remaining providers in priority order
  const status = await getProviderKeyStatus(userId);
  const candidates = PROVIDER_PRIORITY.filter((p) => p !== provider && status[p]?.keyExists);
  let lastFallbackError: unknown;

  for (const fallbackProvider of candidates) {
    const fallbackModel = DEFAULT_MODELS[fallbackProvider];
    try {
      logger.info(
        { fallbackProvider, fallbackModel, originalProvider: provider },
        "AI generation: trying fallback provider"
      );
      const text = await generateTextWithProvider(fallbackProvider, fallbackModel, prompt, maxTokens, userId);
      logger.info(
        { fallbackProvider, originalProvider: provider },
        "AI generation: fallback provider succeeded"
      );
      return { text, usedProvider: fallbackProvider, usedModel: fallbackModel, fallbackUsed: true };
    } catch (err) {
      lastFallbackError = err;
      if (!isQuotaOrCreditError(err) && !isAuthError(err)) throw err;
      logger.warn(
        { fallbackProvider, errorCategory: aiErrorCategory(err) },
        "AI generation: fallback provider failed — trying next"
      );
    }
  }

  if (lastFallbackError && isAuthError(lastFallbackError)) {
    throw lastFallbackError;
  }
  if (!lastFallbackError && initialProviderError && isAuthError(initialProviderError)) {
    throw initialProviderError;
  }

  throw new AiConfigError(
    "All configured AI providers are exhausted or unavailable. Check your API keys and quotas in Settings → AI Keys."
  );
}
