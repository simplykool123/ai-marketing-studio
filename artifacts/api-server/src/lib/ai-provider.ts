/**
 * Canonical AI provider utilities.
 *
 * Key resolution order for every request:
 *   1. User's encrypted key stored in DB (decrypted on the fly)
 *   2. Server-level .env key (ANTHROPIC_KEY / OPENAI_KEY / GEMINI_KEY / provider-specific keys)
 *
 * Keys are never logged or exposed in error messages.
 * Future: when multi-tenant encrypted DB keys are needed, extend resolveApiKey().
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@workspace/db";
import { userApiKeysTable, userSettingsTable } from "@workspace/db/schema";
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

export type ProviderHealthRecord = {
  provider: string;
  model?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureCategory?: AiErrorCategory;
  lastFailureReason?: string;
};

export type ProviderAttempt = {
  provider: string;
  model: string;
  category: AiErrorCategory;
  reason: string;
};

const providerHealth = new Map<string, ProviderHealthRecord>();

export class AiProviderFallbackError extends AiConfigError {
  attempts: ProviderAttempt[];

  constructor(attempts: ProviderAttempt[]) {
    const summary = attempts.length
      ? attempts.map((attempt) => `${providerDisplayName(attempt.provider)} ${attempt.reason}`).join(", ")
      : "No configured provider keys were available";
    super(`No working AI provider available. ${summary}. Please update Settings → AI Keys.`);
    this.name = "AiProviderFallbackError";
    this.attempts = attempts;
  }
}

// ---------------------------------------------------------------------------
// Key resolution — DB first, then .env
// ---------------------------------------------------------------------------

/**
 * Resolves the plaintext API key for a provider.
 * Checks the user's DB-stored encrypted key first, falls back to .env.
 * Throws AiConfigError if no key is available.
 */
type ResolvedApiKey = { key: string; source: "database" | "env"; keyHint: string };

function keyHintFromPlaintext(key: string): string {
  return key.slice(-4);
}

export async function resolveApiKey(provider: string, userId?: string): Promise<ResolvedApiKey> {
  const candidates = await resolveApiKeyCandidates(provider, userId);
  if (candidates.length > 0) return candidates[0]!;

  throw new AiConfigError(
    `No API key configured for ${provider}. Add one in Settings → AI Keys.`
  );
}

async function resolveApiKeyCandidates(provider: string, userId?: string): Promise<ResolvedApiKey[]> {
  // Phase 51 policy: API keys MUST come from Settings (database). No .env
  // fallback. If a user has not added a key for this provider, the generation
  // path fails fast with AiConfigError so the UI shows the missing-key state.
  if (!userId) return [];

  const [row] = await db
    .select({ encryptedKey: userApiKeysTable.encryptedKey, keyHint: userApiKeysTable.keyHint })
    .from(userApiKeysTable)
    .where(and(eq(userApiKeysTable.userId, userId), eq(userApiKeysTable.provider, provider)))
    .limit(1);
  if (!row) return [];

  try {
    return [{ key: decrypt(row.encryptedKey), source: "database", keyHint: row.keyHint }];
  } catch {
    // Decryption failure — treat as missing rather than crashing the request.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Provider key status (never exposes actual key values)
// ---------------------------------------------------------------------------

export type ProviderKeyStatus = {
  keyExists: boolean;
  source: "env" | "database" | "none";
  keyHint?: string;
  enabled?: boolean;
  priority?: number;
};

export type ProviderCategory = "text" | "image" | "trend" | "video";

export type ProviderControl = {
  provider: string;
  enabled: boolean;
  priority: number;
  category: ProviderCategory;
  bestFor?: string;
};

export type ProviderControls = Record<ProviderCategory, ProviderControl[]>;

export const DEFAULT_PROVIDER_CONTROLS: ProviderControls = {
  text: [
    { category: "text", provider: "openai", enabled: true, priority: 1, bestFor: "Strong general content and image fallback support." },
    { category: "text", provider: "gemini", enabled: true, priority: 2, bestFor: "Fast free/low-cost fallback for briefs and drafts." },
    { category: "text", provider: "anthropic", enabled: true, priority: 3, bestFor: "High-quality strategic reasoning and brand voice." },
  ],
  image: [
    { category: "image", provider: "flux", enabled: true, priority: 1, bestFor: "Photorealistic lifestyle, people, product, and natural visuals." },
    { category: "image", provider: "ideogram", enabled: true, priority: 2, bestFor: "Text-on-image, offer graphics, banners, and posters." },
    { category: "image", provider: "openai", enabled: true, priority: 3, bestFor: "Reliable DALL-E fallback and general social images." },
  ],
  trend: [
    { category: "trend", provider: "free", enabled: true, priority: 1, bestFor: "Google News RSS, AI Memory, campaigns, and approved/rejected history." },
    { category: "trend", provider: "serper", enabled: true, priority: 2, bestFor: "Live Google/search/news signals when connected." },
    { category: "trend", provider: "tavily", enabled: true, priority: 3, bestFor: "Optional deeper web research context." },
    { category: "trend", provider: "twitter", enabled: false, priority: 4, bestFor: "Optional X signals only when a bearer token exists." },
  ],
  video: [
    { category: "video", provider: "kling", enabled: false, priority: 1, bestFor: "Realistic short video once connected." },
    { category: "video", provider: "elevenlabs", enabled: false, priority: 2, bestFor: "Voiceover audio once connected." },
  ],
};

function isProviderCategory(value: string): value is ProviderCategory {
  return value === "text" || value === "image" || value === "trend" || value === "video";
}

export function normalizeProviderControls(raw: unknown): ProviderControls {
  const normalized = structuredClone(DEFAULT_PROVIDER_CONTROLS) as ProviderControls;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(normalized)) {
    if (!isProviderCategory(key)) continue;
    const incoming = Array.isArray(record[key]) ? record[key] as unknown[] : [];
    const byProvider = new Map(normalized[key].map((item) => [item.provider, item]));
    for (const item of incoming) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const provider = typeof value.provider === "string" ? value.provider : "";
      const existing = byProvider.get(provider);
      if (!existing) continue;
      if (typeof value.enabled === "boolean") existing.enabled = value.enabled;
      if (typeof value.priority === "number" && Number.isFinite(value.priority)) existing.priority = value.priority;
    }
    normalized[key] = [...byProvider.values()].sort((a, b) => a.priority - b.priority);
  }
  return normalized;
}

export async function getProviderControls(userId?: string): Promise<ProviderControls> {
  if (!userId) return normalizeProviderControls(null);
  const [settings] = await db
    .select({ providerControls: userSettingsTable.providerControls })
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return normalizeProviderControls(settings?.providerControls);
}

function keyProviderForControl(provider: string): string {
  if (provider === "flux") return "replicate";
  if (provider === "free") return "free";
  return provider;
}

export async function getEligibleProviders(category: ProviderCategory, userId?: string): Promise<string[]> {
  const [controls, status] = await Promise.all([
    getProviderControls(userId),
    getProviderKeyStatus(userId),
  ]);
  return controls[category]
    .filter((control) => control.enabled)
    .sort((a, b) => a.priority - b.priority)
    .filter((control) => {
      const keyProvider = keyProviderForControl(control.provider);
      return keyProvider === "free" || status[keyProvider]?.keyExists === true;
    })
    .map((control) => control.provider);
}

export function envKeyForProvider(provider: string): string | undefined {
  if (provider === "anthropic") return process.env.ANTHROPIC_KEY;
  if (provider === "openai") return process.env.OPENAI_KEY;
  if (provider === "gemini") return process.env.GEMINI_KEY;
  if (provider === "replicate" || provider === "flux") return process.env.REPLICATE_API_KEY;
  if (provider === "ideogram") return process.env.IDEOGRAM_API_KEY;
  if (provider === "serper") return process.env.SERPER_API_KEY;
  if (provider === "tavily") return process.env.TAVILY_API_KEY;
  if (provider === "twitter") return process.env.TWITTER_BEARER_TOKEN;
  if (provider === "kling") return process.env.KLING_API_KEY;
  if (provider === "elevenlabs") return process.env.ELEVENLABS_API_KEY;
  return undefined;
}

export async function getProviderKeyStatus(userId?: string): Promise<Record<string, ProviderKeyStatus>> {
  const providers = [
    "anthropic",
    "openai",
    "gemini",
    "replicate",
    "ideogram",
    "serper",
    "tavily",
    "twitter",
    "kling",
    "elevenlabs",
  ];
  const result: Record<string, ProviderKeyStatus> = {};

  // Check DB keys for this user
  const dbRows = userId
    ? await db
        .select({ provider: userApiKeysTable.provider, keyHint: userApiKeysTable.keyHint })
        .from(userApiKeysTable)
        .where(eq(userApiKeysTable.userId, userId))
    : [];
  const dbProviders = new Map(dbRows.map(r => [r.provider, r.keyHint]));

  for (const p of providers) {
    if (dbProviders.has(p)) {
      result[p] = { keyExists: true, source: "database", keyHint: dbProviders.get(p) };
    } else {
      // Phase 51: no .env fallback. Provider is "none" until added in Settings.
      result[p] = { keyExists: false, source: "none" };
    }
  }

  const controls = await getProviderControls(userId);
  for (const category of Object.keys(controls) as ProviderCategory[]) {
    for (const control of controls[category]) {
      const keyProvider = keyProviderForControl(control.provider);
      if (keyProvider === "free") continue;
      if (result[keyProvider]) {
        result[keyProvider] = {
          ...result[keyProvider],
          enabled: control.enabled,
          priority: control.priority,
        };
      }
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
  const eligible = await getEligibleProviders("text", userId);
  if (settings) {
    const { aiProvider, aiModel } = settings;
    if (eligible.includes(aiProvider)) {
      return { provider: aiProvider, model: resolveModel(aiProvider, aiModel) };
    }
  }

  for (const p of eligible) {
    if (p in DEFAULT_MODELS) {
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

function providerDisplayName(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  if (provider === "anthropic") return "Anthropic";
  return provider;
}

function providerFailureReason(err: unknown): string {
  const category = aiErrorCategory(err);
  if (category === "auth") return "key failed auth";
  if (category === "quota") return "quota exceeded";
  if (category === "network") return "network unavailable";
  if (category === "model") return "model unavailable";
  if (category === "config") return "key missing";
  return "unavailable";
}

export function recordProviderFailure(provider: string, model: string, err: unknown): ProviderAttempt {
  const category = aiErrorCategory(err);
  const attempt = {
    provider,
    model,
    category,
    reason: providerFailureReason(err),
  };
  providerHealth.set(provider, {
    ...(providerHealth.get(provider) ?? { provider }),
    provider,
    model,
    lastFailureAt: new Date().toISOString(),
    lastFailureCategory: category,
    lastFailureReason: attempt.reason,
  });
  return attempt;
}

export function recordProviderSuccess(provider: string, model: string): void {
  providerHealth.set(provider, {
    ...(providerHealth.get(provider) ?? { provider }),
    provider,
    model,
    lastSuccessAt: new Date().toISOString(),
  });
}

export function getProviderHealthSnapshot(): Record<string, ProviderHealthRecord> {
  const snapshot: Record<string, ProviderHealthRecord> = {};
  for (const provider of PROVIDER_PRIORITY) {
    snapshot[provider] = providerHealth.get(provider) ?? { provider };
  }
  return snapshot;
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
      logger.info(
        {
          provider,
          model,
          keySource: candidate.source,
          keyHint: candidate.keyHint,
          userIdPresent: userId ? "yes" : "no",
        },
        "AI text generation requested"
      );

      return await generateTextWithRawKey(provider, model, candidate.key, prompt, maxTokens);
    } catch (err) {
      lastError = err;
      if (!isAuthError(err) || candidate === candidates[candidates.length - 1]) {
        throw err;
      }
      logger.warn(
        {
          provider,
          keySource: candidate.source,
          keyHint: candidate.keyHint,
          userIdPresent: userId ? "yes" : "no",
          errorCategory: aiErrorCategory(err),
        },
        "AI text generation key failed — trying next configured key source"
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI provider failed");
}

export async function generateTextWithRawKey(
  provider: string,
  model: string,
  key: string,
  prompt: string,
  maxTokens = 1500,
): Promise<string> {
  if (provider === "openai") {
    const client = new OpenAI({ apiKey: key });
    const res = await client.chat.completions.create({
      model: model || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  if (provider === "gemini") {
    const genai = new GoogleGenerativeAI(key);
    const geminiModel = genai.getGenerativeModel({ model: model || DEFAULT_MODELS.gemini });
    const res = await geminiModel.generateContent(prompt);
    return res.response.text();
  }

  const anthropic = new Anthropic({ apiKey: key });
  const msg = await anthropic.messages.create({
    model: model || "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
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
  const attempts: ProviderAttempt[] = [];
  const eligible = await getEligibleProviders("text", userId);
  const seen = new Set<string>();
  const candidates = [
    ...(eligible.includes(provider) ? [provider] : []),
    ...eligible.filter((p) => p !== provider),
  ].filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });

  if (candidates.length === 0) {
    throw new AiProviderFallbackError([]);
  }

  for (const candidateProvider of candidates) {
    const candidateModel = candidateProvider === provider
      ? resolveModel(candidateProvider, model)
      : DEFAULT_MODELS[candidateProvider as typeof PROVIDER_PRIORITY[number]] ?? model;
    try {
      logger.info(
        {
          provider: candidateProvider,
          model: candidateModel,
          originalProvider: provider,
          fallbackAttempt: candidateProvider !== provider,
          userIdPresent: userId ? "yes" : "no",
        },
        "AI generation: provider attempted"
      );
      const text = await generateTextWithProvider(candidateProvider, candidateModel, prompt, maxTokens, userId);
      recordProviderSuccess(candidateProvider, candidateModel);
      logger.info(
        {
          provider: candidateProvider,
          model: candidateModel,
          originalProvider: provider,
          fallbackUsed: candidateProvider !== provider || attempts.length > 0,
          userIdPresent: userId ? "yes" : "no",
        },
        "AI generation: provider succeeded"
      );
      return {
        text,
        usedProvider: candidateProvider,
        usedModel: candidateModel,
        fallbackUsed: candidateProvider !== provider || attempts.length > 0,
      };
    } catch (err) {
      const attempt = recordProviderFailure(candidateProvider, candidateModel, err);
      attempts.push(attempt);
      logger.warn(
        {
          provider: candidateProvider,
          model: candidateModel,
          originalProvider: provider,
          errorCategory: attempt.category,
          reason: attempt.reason,
          userIdPresent: userId ? "yes" : "no",
        },
        "AI generation: provider failed — trying next configured provider"
      );
    }
  }

  throw new AiProviderFallbackError(attempts);
}
