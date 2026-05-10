import { db } from "@workspace/db";
import { brandDnaTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { buildClientMemoryPacket, formatClientMemoryPacket } from "./client-memory-packet.js";

export async function buildClientContext(clientId: string): Promise<string> {
  return formatClientMemoryPacket(await buildClientMemoryPacket(clientId));
}

export async function buildImagePrompt(
  clientId: string,
  caption: string,
  overrideVisualStyle?: string,
  options: { useBrandDna?: boolean; useBrandColors?: boolean } = {},
): Promise<string> {
  const [brandDna] = await db
    .select()
    .from(brandDnaTable)
    .where(eq(brandDnaTable.clientId, clientId))
    .limit(1);

  const useBrandDna = options.useBrandDna !== false;
  const useBrandColors = useBrandDna && options.useBrandColors !== false;
  const visualStyle = overrideVisualStyle ?? (useBrandDna ? brandDna?.visualStyle : "") ?? "";
  const primaryColor = useBrandColors ? brandDna?.primaryColor : undefined;
  const secondaryColor = useBrandColors ? brandDna?.secondaryColor : undefined;
  const accentColor = useBrandColors ? brandDna?.accentColor : undefined;
  const designNotes = useBrandDna ? brandDna?.designNotes : undefined;

  const colorDesc = [primaryColor, secondaryColor, accentColor].filter(Boolean).join(", ");

  let prompt = caption;
  if (visualStyle) prompt += `. Visual style: ${visualStyle}`;
  if (colorDesc) prompt += `. Brand color palette: ${colorDesc}`;
  if (designNotes) prompt += `. Design notes: ${designNotes}`;
  prompt += ". High quality, professional social media image, clean composition, square format.";

  return prompt;
}
