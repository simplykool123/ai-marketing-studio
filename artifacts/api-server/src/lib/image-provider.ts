import OpenAI from "openai";
import { getEligibleProviders, resolveApiKey, safeErrorMessage, type AiErrorCategory, aiErrorCategory } from "./ai-provider.js";
import { logger } from "./logger.js";

export type ImageProvider = "flux" | "ideogram" | "openai";

export type ImageProviderResult = {
  provider: ImageProvider;
  model: string;
  providerUrl: string;
  keySource: "database" | "env";
  keyHint: string;
  fallbackUsed: boolean;
  attempts: Array<{ provider: ImageProvider; model: string; ok: boolean; errorCategory?: AiErrorCategory }>;
};

type GenerateImageParams = {
  prompt: string;
  userId?: string;
  provider?: ImageProvider | "auto";
  aspectRatio?: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
  model?: string;
};

const DEFAULT_MODELS: Record<ImageProvider, string> = {
  flux: "black-forest-labs/flux-1.1-pro",
  ideogram: "ideogram-v3",
  openai: "dall-e-3",
};

async function providerOrder(preferred?: ImageProvider | "auto", userId?: string): Promise<ImageProvider[]> {
  const base: ImageProvider[] = ["flux", "ideogram", "openai"];
  const eligible = (await getEligibleProviders("image", userId)).filter((provider): provider is ImageProvider =>
    provider === "flux" || provider === "ideogram" || provider === "openai"
  );
  const ordered = eligible.length ? eligible : [];
  if (!preferred || preferred === "auto") return ordered;
  if (!ordered.includes(preferred)) return ordered;
  return [preferred, ...ordered.filter((provider) => provider !== preferred)];
}

function ratioForIdeogram(aspectRatio?: string): string {
  if (aspectRatio === "16:9") return "16x9";
  if (aspectRatio === "9:16") return "9x16";
  if (aspectRatio === "4:5") return "4x5";
  return "1x1";
}

function ratioForReplicate(aspectRatio?: string): string {
  if (aspectRatio === "16:9") return "16:9";
  if (aspectRatio === "9:16") return "9:16";
  if (aspectRatio === "4:5") return "4:5";
  return "1:1";
}

function sizeForOpenAi(aspectRatio?: string, size?: GenerateImageParams["size"]): GenerateImageParams["size"] {
  if (size) return size;
  if (aspectRatio === "16:9") return "1792x1024";
  if (aspectRatio === "9:16" || aspectRatio === "4:5") return "1024x1792";
  return "1024x1024";
}

function firstUrl(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("http")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item);
      if (url) return url;
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "image", "image_url", "output", "data"]) {
      const url = firstUrl(record[key]);
      if (url) return url;
    }
  }
  return null;
}

async function generateWithOpenAi(params: GenerateImageParams, key: string): Promise<{ providerUrl: string; model: string }> {
  const model = params.model || DEFAULT_MODELS.openai;
  const openai = new OpenAI({ apiKey: key });
  const result = await openai.images.generate({
    model,
    prompt: params.prompt,
    n: 1,
    size: sizeForOpenAi(params.aspectRatio, params.size),
    quality: "standard",
    response_format: "url",
  });
  const providerUrl = result.data?.[0]?.url ?? "";
  if (!providerUrl) throw new Error("DALL-E returned no image URL");
  return { providerUrl, model };
}

async function generateWithFlux(params: GenerateImageParams, key: string): Promise<{ providerUrl: string; model: string }> {
  const model = params.model || DEFAULT_MODELS.flux;
  const [owner, name] = model.split("/");
  if (!owner || !name) throw new Error("Invalid Replicate model name");
  const create = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        prompt: params.prompt,
        aspect_ratio: ratioForReplicate(params.aspectRatio),
        output_format: "png",
      },
    }),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok) throw new Error(`Replicate image generation failed: HTTP ${create.status}`);
  let outputUrl = firstUrl((created as Record<string, unknown>).output);
  let status = typeof (created as Record<string, unknown>).status === "string" ? String((created as Record<string, unknown>).status) : "";
  let getUrl = typeof (created as { urls?: { get?: unknown } }).urls?.get === "string" ? String((created as { urls?: { get?: unknown } }).urls?.get) : "";

  for (let i = 0; !outputUrl && getUrl && i < 18 && !["failed", "canceled", "succeeded"].includes(status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1250));
    const poll = await fetch(getUrl, { headers: { Authorization: `Bearer ${key}` } });
    const data = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(`Replicate image polling failed: HTTP ${poll.status}`);
    outputUrl = firstUrl((data as Record<string, unknown>).output);
    status = typeof (data as Record<string, unknown>).status === "string" ? String((data as Record<string, unknown>).status) : status;
    getUrl = typeof (data as { urls?: { get?: unknown } }).urls?.get === "string" ? String((data as { urls?: { get?: unknown } }).urls?.get) : getUrl;
  }

  if (!outputUrl) throw new Error(`Replicate returned no image URL${status ? ` (${status})` : ""}`);
  return { providerUrl: outputUrl, model };
}

async function generateWithIdeogram(params: GenerateImageParams, key: string): Promise<{ providerUrl: string; model: string }> {
  const model = params.model || DEFAULT_MODELS.ideogram;
  const form = new FormData();
  form.append("prompt", params.prompt);
  form.append("aspect_ratio", ratioForIdeogram(params.aspectRatio));
  form.append("rendering_speed", "DEFAULT");

  const response = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
    method: "POST",
    headers: { "Api-Key": key },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ideogram image generation failed: HTTP ${response.status}`);
  const providerUrl = firstUrl(data);
  if (!providerUrl) throw new Error("Ideogram returned no image URL");
  return { providerUrl, model };
}

export async function generateImageWithProvider(params: GenerateImageParams): Promise<ImageProviderResult> {
  const attempts: ImageProviderResult["attempts"] = [];
  const providers = await providerOrder(params.provider, params.userId);
  if (!providers.length) {
    throw new Error("No image provider connected. Add key in Settings -> AI Keys or copy the image prompt and generate manually.");
  }
  for (const provider of providers) {
    try {
      const keyProvider = provider === "flux" ? "replicate" : provider;
      const { key, source, keyHint } = await resolveApiKey(keyProvider, params.userId);
      const model = provider === params.provider && params.model ? params.model : DEFAULT_MODELS[provider];
      logger.info(
        { provider, model, keySource: source, keyHint, userIdPresent: params.userId ? "yes" : "no" },
        "AI image generation requested"
      );
      const generated =
        provider === "flux" ? await generateWithFlux({ ...params, model }, key) :
        provider === "ideogram" ? await generateWithIdeogram({ ...params, model }, key) :
        await generateWithOpenAi({ ...params, model }, key);
      attempts.push({ provider, model: generated.model, ok: true });
      return {
        provider,
        model: generated.model,
        providerUrl: generated.providerUrl,
        keySource: source,
        keyHint,
        fallbackUsed: attempts.some((attempt) => !attempt.ok),
        attempts,
      };
    } catch (err) {
      const model = provider === params.provider && params.model ? params.model : DEFAULT_MODELS[provider];
      const errorCategory = aiErrorCategory(err);
      attempts.push({ provider, model, ok: false, errorCategory });
      logger.warn(
        { provider, model, errorCategory, error: safeErrorMessage(err), userIdPresent: params.userId ? "yes" : "no" },
        "AI image provider failed; trying fallback if available"
      );
    }
  }
  throw new Error("Image generation failed for all providers. Add key in Settings -> AI Keys or try again later.");
}
