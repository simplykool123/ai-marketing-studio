import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Network / DNS error classifier
// Used by auth middleware and any Supabase call site to tell apart
// "network is unreachable" from "credentials are wrong".
// ---------------------------------------------------------------------------

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? "";
  const msg  = err.message.toLowerCase();
  return (
    code === "ENOTFOUND"    ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET"   ||
    code === "ETIMEDOUT"    ||
    code === "EAI_AGAIN"    ||
    code === "EADDRNOTAVAIL" ||
    msg.includes("fetch failed")       ||
    msg.includes("network error")      ||
    msg.includes("timed out")          ||
    msg.includes("dns")                ||
    msg.includes("enotfound")          ||
    msg.includes("econnrefused")       ||
    msg.includes("socket hang up")     ||
    msg.includes("connect econnrefused")
  );
}

// ---------------------------------------------------------------------------
// Promise timeout wrapper
// Rejects with a descriptive Error if the wrapped promise takes longer than ms.
// ---------------------------------------------------------------------------

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const race = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms
    );
  });
  return Promise.race([promise, race]).finally(() => clearTimeout(timer));
}

export async function uploadImageToSupabase(
  imageData: string | Buffer,
  filename: string,
  contentType: string = "image/png"
): Promise<string> {
  const bucket = "post-images";
  const path = `images/${Date.now()}-${filename}`;

  const buffer =
    typeof imageData === "string" ? Buffer.from(imageData, "base64") : imageData;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
