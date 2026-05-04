import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

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
