export type VideoAspectRatio = "9:16" | "1:1" | "16:9";
export type VideoQualityMode = "cheap" | "balanced" | "best_quality" | "fastest";

export type GenerateVideoInput = {
  prompt: string;
  imageUrl?: string;
  durationSeconds?: number;
  aspectRatio?: VideoAspectRatio;
  qualityMode?: VideoQualityMode;
};

export type GenerateVideoResult = {
  provider: "fal.ai";
  model: string;
  status: "queued" | "completed" | "failed";
  videoUrl?: string;
  jobId?: string;
  error?: string;
};

export type VideoJobResult = {
  provider: "fal.ai";
  model: string;
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
  raw?: unknown;
};

const FAL_QUEUE_BASE = "https://queue.fal.run";
export const WAN_TEXT_TO_VIDEO_MODEL = "fal-ai/wan-25-preview/text-to-video";
export const WAN_IMAGE_TO_VIDEO_MODEL = "fal-ai/wan-25-preview/image-to-video";

function modelPath(model: string): string {
  return model.replace(/^\/+|\/+$/g, "");
}

function durationForFal(value?: number): "5" | "10" {
  return value && value > 5 ? "10" : "5";
}

function resolutionForQuality(value?: VideoQualityMode): "480p" | "720p" | "1080p" {
  if (value === "cheap" || value === "fastest") return "480p";
  if (value === "best_quality") return "1080p";
  return "720p";
}

function safeErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Video generation failed";
}

function videoUrlFromResponse(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const video = data.video && typeof data.video === "object" ? data.video as Record<string, unknown> : null;
  return typeof video?.url === "string" ? video.url : undefined;
}

function falStatusToNormalized(value: unknown, videoUrl?: string): VideoJobResult["status"] {
  if (videoUrl) return "completed";
  if (value === "COMPLETED") return "completed";
  if (value === "IN_PROGRESS") return "processing";
  if (value === "IN_QUEUE") return "queued";
  return "failed";
}

async function falGet(model: string, jobId: string, suffix: string): Promise<VideoJobResult> {
  const key = process.env.FAL_KEY;
  const cleanModel = modelPath(model || WAN_TEXT_TO_VIDEO_MODEL);
  if (!jobId.trim()) {
    return { provider: "fal.ai", model: cleanModel, jobId, status: "failed", error: "jobId is required" };
  }
  if (!key) {
    return { provider: "fal.ai", model: cleanModel, jobId, status: "failed", error: "FAL_KEY is not configured" };
  }

  try {
    const res = await fetch(`${FAL_QUEUE_BASE}/${cleanModel}/requests/${encodeURIComponent(jobId)}${suffix}`, {
      headers: { Authorization: `Key ${key}` },
    });
    const raw = await res.json().catch(() => ({})) as Record<string, unknown>;
    const videoUrl = videoUrlFromResponse(raw);

    if (!res.ok) {
      return {
        provider: "fal.ai",
        model: cleanModel,
        jobId,
        status: "failed",
        error: typeof raw.detail === "string"
          ? raw.detail
          : typeof raw.error === "string"
            ? raw.error
            : `fal.ai request failed with status ${res.status}`,
        raw,
      };
    }

    return {
      provider: "fal.ai",
      model: cleanModel,
      jobId,
      status: falStatusToNormalized(raw.status, videoUrl),
      ...(videoUrl ? { videoUrl } : {}),
      raw,
    };
  } catch (err) {
    return {
      provider: "fal.ai",
      model: cleanModel,
      jobId,
      status: "failed",
      error: safeErrorMessage(err),
    };
  }
}

export function defaultVideoModel(): string {
  return WAN_TEXT_TO_VIDEO_MODEL;
}

export async function getVideoJobStatus({
  jobId,
  model = WAN_TEXT_TO_VIDEO_MODEL,
}: {
  jobId: string;
  model?: string;
}): Promise<VideoJobResult> {
  return falGet(model, jobId, "/status");
}

export async function getVideoJobResult({
  jobId,
  model = WAN_TEXT_TO_VIDEO_MODEL,
}: {
  jobId: string;
  model?: string;
}): Promise<VideoJobResult> {
  const result = await falGet(model, jobId, "");
  return {
    ...result,
    status: result.videoUrl ? "completed" : result.status,
  };
}

export async function generateVideo(input: GenerateVideoInput): Promise<GenerateVideoResult> {
  const prompt = input.prompt.trim();
  const model = input.imageUrl ? WAN_IMAGE_TO_VIDEO_MODEL : WAN_TEXT_TO_VIDEO_MODEL;

  if (!prompt) {
    return { provider: "fal.ai", model, status: "failed", error: "prompt is required" };
  }

  const key = process.env.FAL_KEY;
  if (!key) {
    return { provider: "fal.ai", model, status: "failed", error: "FAL_KEY is not configured" };
  }

  const body: Record<string, unknown> = {
    prompt: prompt.slice(0, 800),
    duration: durationForFal(input.durationSeconds),
    resolution: resolutionForQuality(input.qualityMode),
    negative_prompt: "low resolution, blurry, distorted faces, unreadable text, watermark, logo artifacts",
    enable_prompt_expansion: true,
    enable_safety_checker: true,
  };

  if (!input.imageUrl) {
    body.aspect_ratio = input.aspectRatio ?? "9:16";
  } else {
    body.image_url = input.imageUrl;
  }

  try {
    const res = await fetch(`${FAL_QUEUE_BASE}/${modelPath(model)}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      return {
        provider: "fal.ai",
        model,
        status: "failed",
        error: typeof data.detail === "string"
          ? data.detail
          : typeof data.error === "string"
            ? data.error
            : `fal.ai request failed with status ${res.status}`,
      };
    }

    const jobId = typeof data.request_id === "string" ? data.request_id : undefined;
    const videoUrl = videoUrlFromResponse(data);

    return {
      provider: "fal.ai",
      model,
      status: videoUrl ? "completed" : "queued",
      ...(videoUrl ? { videoUrl } : {}),
      ...(jobId ? { jobId } : {}),
    };
  } catch (err) {
    return {
      provider: "fal.ai",
      model,
      status: "failed",
      error: safeErrorMessage(err),
    };
  }
}
