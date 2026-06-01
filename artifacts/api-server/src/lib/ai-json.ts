// Phase 51 — Strict-JSON generation with provider-native structured-output
// modes + a single repair retry. All omnichannel/festival/trend/growth/
// GBP/WhatsApp/AI-Brain/quality skills route through generateJsonWithFallback
// below instead of generateTextWithFallback, so the parser failure rate that
// caused Phase 50's 422s drops dramatically.
//
// Provider modes:
//   - OpenAI: response_format = { type: "json_object" }
//   - Gemini: generationConfig.responseMimeType = "application/json"
//   - Anthropic: strict prompt wrapper ("Return ONLY JSON, no prose").
// On parse failure we run a single repair pass with a tiny meta-prompt that
// just asks the model to re-emit valid JSON for the schema. If that also
// fails, we throw SkillEngineError(422) — never silent garbage saves.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger.js";
import {
  DEFAULT_MODELS,
  type GenerateWithFallbackResult,
  generateTextWithFallback,
  getEligibleProviders,
  recordProviderFailure,
  recordProviderSuccess,
  resolveApiKey,
  resolveModel,
  PROVIDER_PRIORITY,
} from "./ai-provider.js";

// ---------------------------------------------------------------------------
// Strict-JSON instructions appended to every prompt regardless of provider.
// Keep this short — Anthropic + smaller Gemini models drift if it's too long.
// ---------------------------------------------------------------------------
const JSON_ONLY_SUFFIX = `

CRITICAL: Return ONLY a single valid JSON object. No prose before or after.
No markdown fences. No commentary. No code blocks. The first character of
your reply must be { and the last must be }.`;

const REPAIR_PROMPT = (raw: string, schemaName: string) => `The following text was meant to be valid JSON for the "${schemaName}" schema, but it did not parse cleanly. Convert it into valid JSON. Return ONLY the JSON object — no prose, no code fences. The first character must be { and the last must be }.

Original output:
"""
${raw.slice(0, 12_000)}
"""`;

// ---------------------------------------------------------------------------
// Tolerant JSON extractor — borrows from skill-engine.parseSkillJsonOutput but
// is exported here so the repair path uses the same logic.
// ---------------------------------------------------------------------------
export class JsonParseError extends Error {
  rawSample: string;
  constructor(message: string, rawSample: string) {
    super(message);
    this.name = "JsonParseError";
    this.rawSample = rawSample.slice(0, 240);
  }
}

export function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new JsonParseError("Empty response", raw);

  // 1) fenced ```json blocks
  const fencedJson = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  const fencedAny = trimmed.match(/```\s*([\s\S]*?)\s*```/);
  const inner = fencedJson?.[1] ?? fencedAny?.[1] ?? trimmed;
  const candidates: string[] = [];
  if (inner.trim().startsWith("{")) candidates.push(inner.trim());

  // 2) balanced { ... } walk from the first '{'
  const firstBrace = inner.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < inner.length; i++) {
      const ch = inner[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(inner.slice(firstBrace, i + 1));
          break;
        }
      }
    }
  }
  // 3) greedy fallback
  const greedy = inner.match(/\{[\s\S]*\}/)?.[0];
  if (greedy) candidates.push(greedy);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* try next */ }
  }
  throw new JsonParseError("Could not extract a JSON object from the response", raw);
}

// ---------------------------------------------------------------------------
// Provider-native JSON-mode generators.
// Return raw text; caller parses + validates.
// ---------------------------------------------------------------------------

async function generateOpenAiJson(model: string, key: string, prompt: string, maxTokens: number): Promise<string> {
  const client = new OpenAI({ apiKey: key });
  const res = await client.chat.completions.create({
    model: model || DEFAULT_MODELS.openai,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt + JSON_ONLY_SUFFIX }],
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content ?? "";
}

async function generateGeminiJson(model: string, key: string, prompt: string, maxTokens: number): Promise<string> {
  const genai = new GoogleGenerativeAI(key);
  const geminiModel = genai.getGenerativeModel({
    model: model || DEFAULT_MODELS.gemini,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: maxTokens,
    },
  });
  const res = await geminiModel.generateContent(prompt + JSON_ONLY_SUFFIX);
  return res.response.text();
}

async function generateAnthropicJson(model: string, key: string, prompt: string, maxTokens: number): Promise<string> {
  const anthropic = new Anthropic({ apiKey: key });
  // Anthropic doesn't expose a JSON-only mode in the SDK at this version, but
  // assistant-prefill of "{" is the documented trick to constrain output to a
  // JSON object — combined with the suffix this is reliable in practice.
  const msg = await anthropic.messages.create({
    model: model || DEFAULT_MODELS.anthropic,
    max_tokens: maxTokens,
    messages: [
      { role: "user", content: prompt + JSON_ONLY_SUFFIX },
      { role: "assistant", content: "{" },
    ],
  });
  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  // Some Anthropic keys are restricted to use through Claude Code CLI only and
  // return a sentinel string instead of generating. Detect this and throw so
  // the fallback loop moves on to another provider.
  if (/use Claude Code CLI/i.test(text) || /\bclaude code\b/i.test(text.slice(0, 80))) {
    throw new Error("Anthropic key is restricted to Claude Code CLI usage; cannot be called directly.");
  }
  // Prepend the prefilled "{" so the parser sees a complete object.
  return "{" + text;
}

async function generateJsonWithRawKey(provider: string, model: string, key: string, prompt: string, maxTokens: number): Promise<string> {
  if (provider === "openai") return generateOpenAiJson(model, key, prompt, maxTokens);
  if (provider === "gemini") return generateGeminiJson(model, key, prompt, maxTokens);
  return generateAnthropicJson(model, key, prompt, maxTokens);
}

async function generateJsonWithProvider(provider: string, model: string, prompt: string, maxTokens: number, userId?: string): Promise<string> {
  const candidate = await resolveApiKey(provider, userId);
  if (!candidate.key) {
    throw new Error(`No API key for ${provider}`);
  }
  return generateJsonWithRawKey(provider, model, candidate.key, prompt, maxTokens);
}

// ---------------------------------------------------------------------------
// Public entry point — replacement for generateTextWithFallback for any code
// path that wants JSON. Tries provider-native JSON mode; falls back across
// providers; repairs once with a meta-prompt if parsing fails.
// ---------------------------------------------------------------------------

export type JsonValidator = (obj: Record<string, unknown>) => string | null;

export type GenerateJsonOptions = {
  provider: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  userId?: string;
  schemaName?: string;
  validate?: JsonValidator;          // returns error message if invalid, else null
  allowRepair?: boolean;             // default true
};

export type GenerateJsonResult = GenerateWithFallbackResult & {
  object: Record<string, unknown>;
  repairUsed: boolean;
};

export async function generateJsonWithFallback(opts: GenerateJsonOptions): Promise<GenerateJsonResult> {
  const { provider, model, prompt, maxTokens = 2500, userId, schemaName = "skill_output", validate, allowRepair = true } = opts;
  const eligible = await getEligibleProviders("text", userId);
  const seen = new Set<string>();
  const candidates = [
    ...(eligible.includes(provider) ? [provider] : []),
    ...eligible.filter((p) => p !== provider),
  ].filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  if (candidates.length === 0) {
    throw new Error("No eligible AI provider configured");
  }

  const errors: string[] = [];

  for (const candidateProvider of candidates) {
    const candidateModel = candidateProvider === provider
      ? resolveModel(candidateProvider, model)
      : DEFAULT_MODELS[candidateProvider as typeof PROVIDER_PRIORITY[number]] ?? model;
    try {
      const raw = await generateJsonWithProvider(candidateProvider, candidateModel, prompt, maxTokens, userId);
      try {
        const obj = extractJsonObject(raw);
        const validationError = validate ? validate(obj) : null;
        if (validationError) {
          throw new JsonParseError(`Schema validation failed: ${validationError}`, raw);
        }
        recordProviderSuccess(candidateProvider, candidateModel);
        logger.info({ provider: candidateProvider, model: candidateModel, schemaName }, "AI JSON generation succeeded");
        return {
          text: raw,
          usedProvider: candidateProvider,
          usedModel: candidateModel,
          fallbackUsed: candidateProvider !== provider,
          object: obj,
          repairUsed: false,
        };
      } catch (parseErr) {
        if (!allowRepair) throw parseErr;
        // Repair retry — same provider/model, one shot.
        try {
          logger.warn({ provider: candidateProvider, schemaName, sample: parseErr instanceof JsonParseError ? parseErr.rawSample : String(parseErr).slice(0, 240) }, "AI JSON parse failed — attempting one repair pass");
          const repaired = await generateJsonWithProvider(candidateProvider, candidateModel, REPAIR_PROMPT(raw, schemaName), Math.min(maxTokens, 4000), userId);
          const obj = extractJsonObject(repaired);
          const validationError = validate ? validate(obj) : null;
          if (validationError) {
            throw new JsonParseError(`Schema validation failed after repair: ${validationError}`, repaired);
          }
          recordProviderSuccess(candidateProvider, candidateModel);
          logger.info({ provider: candidateProvider, model: candidateModel, schemaName }, "AI JSON repair succeeded");
          return {
            text: repaired,
            usedProvider: candidateProvider,
            usedModel: candidateModel,
            fallbackUsed: candidateProvider !== provider,
            object: obj,
            repairUsed: true,
          };
        } catch (repairErr) {
          errors.push(`${candidateProvider}: ${repairErr instanceof Error ? repairErr.message : "unknown"}`);
          recordProviderFailure(candidateProvider, candidateModel, repairErr);
        }
      }
    } catch (providerErr) {
      errors.push(`${candidateProvider}: ${providerErr instanceof Error ? providerErr.message : "unknown"}`);
      recordProviderFailure(candidateProvider, candidateModel, providerErr);
      logger.warn({ provider: candidateProvider, model: candidateModel, schemaName, error: providerErr instanceof Error ? providerErr.message : "unknown" }, "AI JSON provider failed — trying next");
    }
  }

  // All providers failed. Surface a clean error — caller should map to 422.
  throw new JsonParseError(
    `Could not produce valid JSON for "${schemaName}" after all providers + repair. ${errors.join("; ")}`.slice(0, 800),
    "",
  );
}

// Last-resort path that uses the plain text generator (no JSON mode) plus the
// tolerant extractor — kept for migrations where a route can't yet target a
// concrete schemaName. New code should prefer generateJsonWithFallback.
export async function generateAndExtractJson(opts: {
  provider: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  userId?: string;
}): Promise<{ object: Record<string, unknown>; usedProvider: string; usedModel: string; fallbackUsed: boolean }> {
  const { provider, model, prompt, maxTokens = 2500, userId } = opts;
  const result = await generateTextWithFallback(provider, model, prompt, maxTokens, userId);
  const object = extractJsonObject(result.text);
  return { object, usedProvider: result.usedProvider, usedModel: result.usedModel, fallbackUsed: result.fallbackUsed };
}
