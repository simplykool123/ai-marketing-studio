import { db } from "@workspace/db";
import {
  brandDnaTable,
  postsTable,
  storylinesTable,
  contentMemoryTable,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";

export async function buildClientContext(clientId: string): Promise<string> {
  const [brandDna] = await db
    .select()
    .from(brandDnaTable)
    .where(eq(brandDnaTable.clientId, clientId))
    .limit(1);

  const recentPosts = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.clientId, clientId))
    .orderBy(desc(postsTable.createdAt))
    .limit(10);

  const [activeStoryline] = await db
    .select()
    .from(storylinesTable)
    .where(
      and(
        eq(storylinesTable.clientId, clientId),
        eq(storylinesTable.isActive, true)
      )
    )
    .limit(1);

  const memoryEntries = await db
    .select()
    .from(contentMemoryTable)
    .where(eq(contentMemoryTable.clientId, clientId));

  const parts: string[] = [];

  if (brandDna) {
    const colorInfo = [
      brandDna.primaryColor ? `Primary Color: ${brandDna.primaryColor}` : null,
      brandDna.secondaryColor ? `Secondary Color: ${brandDna.secondaryColor}` : null,
      brandDna.accentColor ? `Accent Color: ${brandDna.accentColor}` : null,
    ].filter(Boolean).join("\n");

    parts.push(`## Brand Identity
Brand Name: ${brandDna.brandName}
Voice & Tone: ${brandDna.voiceTone ?? "Not specified"}
Target Audience: ${brandDna.targetAudience ?? "Not specified"}
Industry: ${brandDna.industry ?? "Not specified"}
Brand Values: ${brandDna.brandValues ?? "Not specified"}
Visual Style: ${brandDna.visualStyle ?? "Not specified"}
${colorInfo ? `Brand Colors:\n${colorInfo}` : ""}
Font Style: ${brandDna.fontStyle ?? "Not specified"}
Design Notes: ${brandDna.designNotes ?? "None"}
Competitors: ${brandDna.competitors ?? "Not specified"}
Additional Context: ${brandDna.additionalContext ?? "None"}`);

    const strategyParts = [
      brandDna.contentThemes ? `Content Themes/Pillars: ${brandDna.contentThemes}` : null,
      brandDna.postingCadence ? `Posting Cadence: ${brandDna.postingCadence}` : null,
      brandDna.audiencePersonas ? `Audience Personas: ${brandDna.audiencePersonas}` : null,
      brandDna.campaignGoals ? `Campaign Goals: ${brandDna.campaignGoals}` : null,
    ].filter(Boolean);

    if (strategyParts.length > 0) {
      parts.push(`## Content Strategy\n${strategyParts.join("\n")}`);
    }
  } else {
    parts.push("## Brand Identity\nNo brand DNA set yet.");
  }

  if (activeStoryline) {
    parts.push(`## Active Content Storyline
Title: ${activeStoryline.title}
Narrative: ${activeStoryline.narrative}`);
  }

  if (recentPosts.length > 0) {
    const postSummaries = recentPosts
      .map((p) => `- Topic: "${p.topic}" | Caption: "${p.caption.slice(0, 100)}..."`)
      .join("\n");
    parts.push(`## Recent Posts (last ${recentPosts.length})\n${postSummaries}`);
  }

  if (memoryEntries.length > 0) {
    const memoryStr = memoryEntries
      .map((m) => `- ${m.key}: ${m.value}`)
      .join("\n");
    parts.push(`## Content Memory\n${memoryStr}`);
  }

  return parts.join("\n\n");
}

export async function buildImagePrompt(
  clientId: string,
  caption: string,
  overrideVisualStyle?: string
): Promise<string> {
  const [brandDna] = await db
    .select()
    .from(brandDnaTable)
    .where(eq(brandDnaTable.clientId, clientId))
    .limit(1);

  const visualStyle = overrideVisualStyle ?? brandDna?.visualStyle ?? "";
  const primaryColor = brandDna?.primaryColor;
  const secondaryColor = brandDna?.secondaryColor;
  const accentColor = brandDna?.accentColor;
  const designNotes = brandDna?.designNotes;

  const colorDesc = [primaryColor, secondaryColor, accentColor].filter(Boolean).join(", ");

  let prompt = caption;
  if (visualStyle) prompt += `. Visual style: ${visualStyle}`;
  if (colorDesc) prompt += `. Brand color palette: ${colorDesc}`;
  if (designNotes) prompt += `. Design notes: ${designNotes}`;
  prompt += ". High quality, professional social media image, clean composition, square format.";

  return prompt;
}
