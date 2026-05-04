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

// ---------------------------------------------------------------------------
// Key resolution — DB first, then .env
// ---------------------------------------------------------------------------

/**
 * Resolves the plaintext API key for a provider.
 * Checks the user's DB-stored encrypted key first, falls back to .env.
 * Throws AiConfigError if no key is available.
 */
export async function resolveApiKey(provider: string, userId?: string): Promise<{ key: string; source: "database" | "env" }> {
  if (userId) {
    const [row] = await db
      .select({ encryptedKey: userApiKeysTable.encryptedKey })
      .from(userApiKeysTable)
      .where(and(eq(userApiKeysTable.userId, userId), eq(userApiKeysTable.provider, provider)))
      .limit(1);
    if (row) {
      try {
        return { key: decrypt(row.encryptedKey), source: "database" };
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

  if (envKey) return { key: envKey, source: "env" };

  throw new AiConfigError(
    `No API key configured for ${provider}. Add one in Settings → AI Keys or set the .env variable.`
  );
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
// Provider + model resolution
// ---------------------------------------------------------------------------

export function resolveModel(provider: string, model: string): string {
  if (provider === "anthropic") return MODEL_ALIASES[model] ?? (model || "claude-sonnet-4-6");
  if (provider === "openai")    return model || "gpt-4o";
  if (provider === "gemini")    return model || "gemini-1.5-pro";
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

  // Auto-detect from available keys
  const status = await getProviderKeyStatus(userId);
  if (status.anthropic.keyExists) return { provider: "anthropic", model: "claude-sonnet-4-6" };
  if (status.openai.keyExists)    return { provider: "openai",    model: "gpt-4o" };
  if (status.gemini.keyExists)    return { provider: "gemini",    model: "gemini-1.5-pro" };

  throw new AiConfigError(
    "No AI provider API keys are configured. Add a key in Settings → AI Keys or set an .env variable."
  );
}

// ---------------------------------------------------------------------------
// Error translation (safe, no key leakage)
// ---------------------------------------------------------------------------

function redactSecrets(msg: string): string {
  return msg.replace(/(?:sk-ant-|sk-proj-|sk-|AIza)[A-Za-z0-9_\-]{10,}/g, "[REDACTED]");
}

export function toAiErrorResponse(err: unknown, fallback: string): { status: number; message: string } {
  if (err instanceof AiConfigError) return { status: 503, message: err.message };
  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    if (
      lower.includes("authentication") ||
      lower.includes("api key") ||
      lower.includes("incorrect api key") ||
      lower.includes("invalid api key") ||
      lower.includes("unauthorized")
    ) {
      return { status: 503, message: "AI provider authentication failed — check your API key in Settings → AI Keys." };
    }
    if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("invalid model"))) {
      return { status: 503, message: "AI model not recognised — update your model in Settings." };
    }
    return { status: 500, message: fallback };
  }
  return { status: 500, message: fallback };
}

export function safeErrorMessage(err: unknown): string {
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
  const { key, source } = await resolveApiKey(provider, userId);
  logger.info({ provider, model, keySource: source }, "AI text generation requested");

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
    const geminiModel = genai.getGenerativeModel({ model: model || "gemini-1.5-pro" });
    const res = await geminiModel.generateContent(prompt);
    return res.response.text();
  }

  // Default: anthropic
  const anthropic = new Anthropic({ apiKey: key });
  const msg = await anthropic.messages.create({
    model: model || "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
}
