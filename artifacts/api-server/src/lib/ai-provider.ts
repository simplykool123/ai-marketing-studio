/**
 * Canonical AI provider utilities.
 *
 * Both /ai/generate-captions and /settings/test-ai-provider import from here,
 * guaranteeing they use identical key resolution and generation logic (req 5).
 *
 * Keys come from environment variables only (req 6).
 * TODO (future): when UI-entered encrypted keys are stored in the DB, add a
 *   getEncryptedKey(provider, userId) helper here that decrypts with
 *   TOKEN_ENCRYPTION_KEY before passing to the client constructors. Never store
 *   or log plaintext keys.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
// Provider key status (never exposes actual key values)
// ---------------------------------------------------------------------------

export type ProviderKeyStatus = {
  keyExists: boolean;
  /** "env" = set in .env file; "database" = stored encrypted in DB (future) */
  source: "env" | "database";
};

export function getProviderKeyStatus(): Record<string, ProviderKeyStatus> {
  return {
    anthropic: { keyExists: !!process.env.ANTHROPIC_KEY, source: "env" },
    openai:    { keyExists: !!process.env.OPENAI_KEY,    source: "env" },
    gemini:    { keyExists: !!process.env.GEMINI_KEY,    source: "env" },
  };
}

// ---------------------------------------------------------------------------
// Client constructors
// ---------------------------------------------------------------------------

export class AiConfigError extends Error {
  constructor(message: string) { super(message); this.name = "AiConfigError"; }
}

export function getAnthropicClient(): Anthropic {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) throw new AiConfigError("Anthropic API key is not configured. Add ANTHROPIC_KEY to your .env file.");
  return new Anthropic({ apiKey: key });
}

export function getOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_KEY;
  if (!key) throw new AiConfigError("OpenAI API key is not configured. Add OPENAI_KEY to your .env file.");
  return new OpenAI({ apiKey: key });
}

export function getGeminiClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_KEY;
  if (!key) throw new AiConfigError("Gemini API key is not configured. Add GEMINI_KEY to your .env file.");
  return new GoogleGenerativeAI(key);
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

/**
 * Resolve provider + model from user settings.
 * Uses configured provider when its key is present; auto-detects from env otherwise.
 */
export function resolveProviderAndModel(
  settings: { aiProvider: string; aiModel: string } | null
): { provider: string; model: string } {
  if (settings) {
    const { aiProvider, aiModel } = settings;
    const status = getProviderKeyStatus();
    if (status[aiProvider]?.keyExists) {
      return { provider: aiProvider, model: resolveModel(aiProvider, aiModel) };
    }
    // Configured provider key is missing — fall through to auto-detect
  }

  const status = getProviderKeyStatus();
  if (status.anthropic.keyExists) return { provider: "anthropic", model: "claude-sonnet-4-6" };
  if (status.openai.keyExists)    return { provider: "openai",    model: "gpt-4o" };
  if (status.gemini.keyExists)    return { provider: "gemini",    model: "gemini-1.5-pro" };

  throw new AiConfigError(
    "No AI provider API keys are configured. Add ANTHROPIC_KEY, OPENAI_KEY, or GEMINI_KEY to your .env file."
  );
}

// ---------------------------------------------------------------------------
// Error translation (safe, no key leakage)
// ---------------------------------------------------------------------------

/** Strip anything that looks like an API key from an error message. */
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
      return { status: 503, message: "AI provider authentication failed — check your API key in Settings." };
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
// Canonical text generation  (the ONLY implementation — used by both
// generate-captions and test-ai-provider, guaranteeing identical behaviour)
// ---------------------------------------------------------------------------

export async function generateTextWithProvider(
  provider: string,
  model: string,
  prompt: string,
  maxTokens = 1500
): Promise<string> {
  const keyExists = getProviderKeyStatus()[provider]?.keyExists ?? false;
  logger.info({ provider, model, keyExists }, "AI text generation requested");

  if (provider === "openai") {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: model || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  if (provider === "gemini") {
    const genai = getGeminiClient();
    const geminiModel = genai.getGenerativeModel({ model: model || "gemini-1.5-pro" });
    const res = await geminiModel.generateContent(prompt);
    return res.response.text();
  }

  // Default: anthropic
  const anthropic = getAnthropicClient();
  const msg = await anthropic.messages.create({
    model: model || "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
}
