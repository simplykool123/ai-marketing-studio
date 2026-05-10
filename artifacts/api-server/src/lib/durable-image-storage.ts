import { uploadToSupabase } from "../routes/upload.js";

function extensionForContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "png";
}

export async function persistRemoteImageUrl(
  providerUrl: string,
  clientId: string,
  filenamePrefix: string,
): Promise<{ durableUrl: string; providerUrl: string; contentType: string }> {
  const response = await fetch(providerUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch generated image before storage: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Generated image response was not an image: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionForContentType(contentType);
  const safePrefix = filenamePrefix.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const path = `generated/${clientId}/${safePrefix}-${Date.now()}.${ext}`;
  const durableUrl = await uploadToSupabase(buffer, path, contentType);

  return { durableUrl, providerUrl, contentType };
}
