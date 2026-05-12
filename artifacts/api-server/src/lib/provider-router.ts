/**
 * Provider Router
 *
 * Central config for all text / image / video provider options.
 * Decouples quality-mode selection from hard-coded provider names.
 *
 * Quality modes:
 *   cheap       → lowest cost, still capable (flash / mini models)
 *   balanced    → best general-purpose ratio (gpt-4o / claude-sonnet)
 *   best_quality → highest reasoning / output quality
 *   fastest     → lowest latency (flash / mini)
 *
 * Text providers map to the same names used by ai-provider.ts:
 *   "anthropic" | "openai" | "gemini"
 *
 * Image + video providers beyond DALL-E 3 are interface-only for now
 * (available: false) — the router documents them so the UI can show
 * "coming soon" and the API can extend support without structural changes.
 */

import { getProviderKeyStatus } from "./ai-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityMode = "cheap" | "balanced" | "best_quality" | "fastest";

export type TextProviderName = "openai" | "anthropic" | "gemini" | "deepseek" | "kimi";
export type ImageProviderName = "openai" | "grok" | "gemini" | "ideogram" | "flux";
export type VideoProviderName = "kling" | "runway" | "pika" | "luma" | "veo";

export interface TextProviderOption {
  name: TextProviderName;
  label: string;
  model: string;
  internalKey: "openai" | "anthropic" | "gemini"; // key used in ai-provider.ts
  notes: string;
}

export interface ImageProviderOption {
  name: ImageProviderName;
  label: string;
  model: string;
  available: boolean;       // true = integrated; false = coming soon
  internalKey?: "openai";   // only openai is integrated right now
  notes: string;
}

export interface VideoProviderOption {
  name: VideoProviderName;
  label: string;
  available: boolean;       // false for all until rendering is built
  website: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Text provider routing table
// Order within each mode = preference (first available key wins)
// ---------------------------------------------------------------------------

export const TEXT_PROVIDERS: Record<QualityMode, TextProviderOption[]> = {
  cheap: [
    { name: "gemini",    label: "Gemini Flash",      model: "gemini-2.5-flash",  internalKey: "gemini",    notes: "Fast, cost-effective" },
    { name: "openai",    label: "GPT-4o-mini",       model: "gpt-4o-mini",       internalKey: "openai",    notes: "Cheap OpenAI option" },
    { name: "anthropic", label: "Claude Haiku",      model: "claude-haiku-4-5-20251001", internalKey: "anthropic", notes: "Fast Anthropic" },
  ],
  balanced: [
    { name: "openai",    label: "GPT-4o",            model: "gpt-4o",            internalKey: "openai",    notes: "Strong all-rounder" },
    { name: "anthropic", label: "Claude Sonnet",     model: "claude-sonnet-4-6", internalKey: "anthropic", notes: "Balanced Anthropic" },
    { name: "gemini",    label: "Gemini Flash",      model: "gemini-2.5-flash",  internalKey: "gemini",    notes: "Balanced Google" },
  ],
  best_quality: [
    { name: "anthropic", label: "Claude Opus",       model: "claude-opus-4-7",   internalKey: "anthropic", notes: "Highest reasoning quality" },
    { name: "openai",    label: "GPT-4o",            model: "gpt-4o",            internalKey: "openai",    notes: "Best OpenAI option" },
    { name: "gemini",    label: "Gemini Flash",      model: "gemini-2.5-flash",  internalKey: "gemini",    notes: "Best Google option" },
  ],
  fastest: [
    { name: "gemini",    label: "Gemini Flash",      model: "gemini-2.5-flash",  internalKey: "gemini",    notes: "Lowest latency" },
    { name: "openai",    label: "GPT-4o-mini",       model: "gpt-4o-mini",       internalKey: "openai",    notes: "Fast OpenAI" },
    { name: "anthropic", label: "Claude Haiku",      model: "claude-haiku-4-5-20251001", internalKey: "anthropic", notes: "Fast Claude" },
  ],
};

// ---------------------------------------------------------------------------
// Image provider catalogue
// ---------------------------------------------------------------------------

export const IMAGE_PROVIDERS: ImageProviderOption[] = [
  {
    name: "openai",    label: "DALL-E 3",     model: "dall-e-3",   available: true,  internalKey: "openai",
    notes: "Integrated — generates via OpenAI API",
  },
  {
    name: "grok",      label: "Grok Aurora",  model: "aurora",     available: false,
    notes: "Coming soon — xAI image generation",
  },
  {
    name: "gemini",    label: "Gemini Imagen", model: "imagen-3",  available: false,
    notes: "Coming soon — Google Imagen 3",
  },
  {
    name: "ideogram",  label: "Ideogram 2",   model: "ideogram-v2", available: false,
    notes: "Coming soon — excellent for text-in-image",
  },
  {
    name: "flux",      label: "Flux Pro",     model: "flux-pro",   available: false,
    notes: "Coming soon — Black Forest Labs",
  },
];

// ---------------------------------------------------------------------------
// Video provider catalogue (all interface-only for now)
// ---------------------------------------------------------------------------

export const VIDEO_PROVIDERS: VideoProviderOption[] = [
  { name: "kling",   label: "Kling 1.6",    available: false, website: "https://kling.kuaishou.com",      notes: "Best for realistic motion, 5–10 s clips" },
  { name: "runway",  label: "Runway Gen-3",  available: false, website: "https://runwayml.com",            notes: "Cinema-grade, supports camera prompts" },
  { name: "pika",    label: "Pika 2.0",      available: false, website: "https://pika.art",                notes: "Fast, great for social-media length clips" },
  { name: "luma",    label: "Luma Dream Machine", available: false, website: "https://lumalabs.ai",        notes: "Strong on product shots + B-roll" },
  { name: "veo",     label: "Google Veo 2",  available: false, website: "https://deepmind.google/veo",     notes: "Highest resolution, 1080p 60 s" },
];

// ---------------------------------------------------------------------------
// Resolver — picks the first available text provider for a quality mode
// ---------------------------------------------------------------------------

/**
 * Returns the first text provider from the quality-mode ranking whose key
 * is configured for the given user.  Falls back through the list until one
 * is found; throws if none are configured at all.
 */
export async function resolveTextProviderForMode(
  mode: QualityMode,
  userId?: string
): Promise<{ provider: string; model: string; label: string }> {
  const status = await getProviderKeyStatus(userId);
  const candidates = TEXT_PROVIDERS[mode] ?? TEXT_PROVIDERS.balanced;

  for (const opt of candidates) {
    if (status[opt.internalKey]?.keyExists) {
      return { provider: opt.internalKey, model: opt.model, label: opt.label };
    }
  }

  // If the preferred mode has no keys, fall back to balanced, then any
  for (const opt of TEXT_PROVIDERS.balanced) {
    if (status[opt.internalKey]?.keyExists) {
      return { provider: opt.internalKey, model: opt.model, label: opt.label };
    }
  }

  throw new Error(
    "No AI provider API keys configured. Add a key in Settings → AI Keys."
  );
}

// ---------------------------------------------------------------------------
// Public registry (for UI / settings display)
// ---------------------------------------------------------------------------

export const PROVIDER_REGISTRY = {
  text:  TEXT_PROVIDERS,
  image: IMAGE_PROVIDERS,
  video: VIDEO_PROVIDERS,
} as const;
