import { db } from "@workspace/db";
import {
  aiIdeasTable,
  brandDnaTable,
  campaignsTable,
  clientsTable,
  contentMemoryTable,
  postsTable,
  storylinesTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export type ClientMemoryPacket = Awaited<ReturnType<typeof buildClientMemoryPacket>>;

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function memoryIncludes(key: string, value: string, terms: string[]): boolean {
  const text = `${key} ${value}`.toLowerCase();
  return terms.some((term) => text.includes(term));
}

export async function writeClientMemory(clientId: string, key: string, value: string): Promise<void> {
  const cleanKey = key.trim();
  const cleanValue = value.trim();
  if (!cleanKey || !cleanValue) return;
  await db.insert(contentMemoryTable).values({ clientId, key: cleanKey, value: cleanValue });
}

export async function buildClientMemoryPacket(clientId: string) {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .limit(1);

  const [brandDna] = await db
    .select()
    .from(brandDnaTable)
    .where(eq(brandDnaTable.clientId, clientId))
    .limit(1);

  const [activeStoryline] = await db
    .select()
    .from(storylinesTable)
    .where(and(eq(storylinesTable.clientId, clientId), eq(storylinesTable.isActive, true)))
    .limit(1);

  const [latestCampaigns, recentPosts, aiIdeas, memoryEntries] = await Promise.all([
    db.select().from(campaignsTable).where(eq(campaignsTable.clientId, clientId)).orderBy(desc(campaignsTable.createdAt)).limit(5),
    db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.clientId, clientId), inArray(postsTable.status, ["approved", "export_ready", "scheduled", "posted", "published"])))
      .orderBy(desc(postsTable.updatedAt))
      .limit(10),
    db.select().from(aiIdeasTable).where(eq(aiIdeasTable.clientId, clientId)).orderBy(desc(aiIdeasTable.createdAt)).limit(50),
    db.select().from(contentMemoryTable).where(eq(contentMemoryTable.clientId, clientId)).orderBy(desc(contentMemoryTable.createdAt)),
  ]);

  const savedIdeas = aiIdeas.filter((idea) => idea.status === "saved");
  const dismissedIdeas = aiIdeas.filter((idea) => idea.status === "dismissed");
  const usedIdeas = aiIdeas.filter((idea) => idea.status === "used");
  const bestPerformingPosts = memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["best performing", "worked", "winning", "approved"]));
  const weakPosts = memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["weak", "did not work", "didn't work", "rejected", "too generic"]));
  const imageStyleLearnings = memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["image", "visual", "photo", "prompt", "style"]));
  const seoLearnings = memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["seo", "keyword", "blog", "competitor", "internal link"]));
  const growthRuleEntries = memoryEntries.filter((m) => memoryIncludes(m.key, m.value, [
    "content growth rule",
    "default cta",
    "whatsapp",
    "website link",
    "preferred hashtag",
    "seo keyword",
    "location keyword",
    "service keyword",
    "avoid phrase",
    "platform cta",
  ]));

  return {
    client: client
      ? {
          id: client.id,
          name: client.name,
          industry: client.industry,
          logoUrl: client.logoUrl,
        }
      : null,
    brandDna: brandDna
      ? {
          brandName: brandDna.brandName,
          tone: brandDna.voiceTone,
          audience: brandDna.targetAudience || brandDna.audiencePersonas,
          language: brandDna.voiceTone,
          usp: brandDna.additionalContext || brandDna.campaignGoals || brandDna.industry,
          contentPillars: parseList(brandDna.contentThemes),
          visualColors: [brandDna.primaryColor, brandDna.secondaryColor, brandDna.accentColor].filter(Boolean),
          visualStyle: brandDna.visualStyle,
          designNotes: brandDna.designNotes,
        }
      : null,
    storyMemory: {
      activeStoryline,
      currentMonthTheme: memoryEntries.find((m) => memoryIncludes(m.key, m.value, ["current month theme"]))?.value ?? null,
      currentChapter: memoryEntries.find((m) => memoryIncludes(m.key, m.value, ["current chapter"]))?.value ?? null,
      pastStorylineNotes: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["storyline", "chapter", "theme"])),
    },
    contentRules: {
      alwaysFollow: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["always", "must", "follow"])),
      avoid: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["avoid", "never", "banned", "generic"])),
      approvedPhrases: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["approved phrase", "liked phrase"])),
      bannedPhrases: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["banned phrase", "generic phrase"])),
    },
    performanceMemory: {
      bestPerformingPosts,
      weakPosts,
      whatWorked: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["worked", "liked", "approved"])),
      whatDidNotWork: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["did not work", "rejected", "weak"])),
    },
    rejectionMemory: {
      dismissedIdeas,
      avoidRepeating: dismissedIdeas.map((idea) => ({
        title: idea.title,
        idea: idea.idea,
        dismissReason: idea.dismissReason,
      })),
    },
    imageStyleMemory: {
      entries: imageStyleLearnings,
      preferredImageStyle: imageStyleLearnings.find((m) => memoryIncludes(m.key, m.value, ["preferred", "liked", "winning"]))?.value ?? brandDna?.visualStyle ?? null,
      winningPrompts: imageStyleLearnings.filter((m) => memoryIncludes(m.key, m.value, ["winning prompt", "liked prompt"])),
      rejectedImageStyles: imageStyleLearnings.filter((m) => memoryIncludes(m.key, m.value, ["rejected", "avoid"])),
      brandVisualRules: [brandDna?.visualStyle, brandDna?.designNotes].filter(Boolean),
    },
    videoStyleMemory: {
      entries: memoryEntries.filter((m) => memoryIncludes(m.key, m.value, ["video", "hook", "scene", "subtitle", "voice"])),
    },
    seoMemory: {
      entries: seoLearnings,
      targetKeywords: seoLearnings.filter((m) => memoryIncludes(m.key, m.value, ["keyword"])),
      blogTopics: seoLearnings.filter((m) => memoryIncludes(m.key, m.value, ["blog topic"])),
      competitorAngles: seoLearnings.filter((m) => memoryIncludes(m.key, m.value, ["competitor"])),
      internalLinkIdeas: seoLearnings.filter((m) => memoryIncludes(m.key, m.value, ["internal link"])),
    },
    growthRules: {
      entries: growthRuleEntries,
      websiteLinks: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["website", "link"])),
      whatsappNumbers: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["whatsapp"])),
      defaultCtas: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["cta", "call to action"])),
      preferredHashtags: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["hashtag"])),
      seoKeywords: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["seo", "keyword"])),
      locationServiceKeywords: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["location", "service"])),
      avoidWords: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["avoid", "phrase", "word"])),
      platformCtaRules: growthRuleEntries.filter((m) => memoryIncludes(m.key, m.value, ["platform", "instagram", "linkedin", "facebook", "twitter", "x", "blog"])),
    },
    latestCampaigns,
    recentApprovedOrPublishedPosts: recentPosts,
    aiIdeas: {
      saved: savedIdeas,
      dismissed: dismissedIdeas,
      used: usedIdeas,
    },
    memoryEntries,
  };
}

export function formatClientMemoryPacket(packet: ClientMemoryPacket): string {
  const lines: string[] = [];
  lines.push(`## Client\n${packet.client?.name ?? "Unknown client"}${packet.client?.industry ? ` (${packet.client.industry})` : ""}`);
  if (packet.brandDna) {
    lines.push(`## Brand DNA
Tone: ${packet.brandDna.tone ?? "Not specified"}
Audience: ${packet.brandDna.audience ?? "Not specified"}
Language: ${packet.brandDna.language ?? "Not specified"}
USP: ${packet.brandDna.usp ?? "Not specified"}
Content pillars: ${packet.brandDna.contentPillars.join(", ") || "Not specified"}
Visual colors/style: ${[...packet.brandDna.visualColors, packet.brandDna.visualStyle, packet.brandDna.designNotes].filter(Boolean).join(" | ") || "Not specified"}`);
  }
  if (packet.storyMemory.activeStoryline) {
    lines.push(`## Story Memory
Active storyline: ${packet.storyMemory.activeStoryline.title}
Narrative: ${packet.storyMemory.activeStoryline.narrative}
Current month theme: ${packet.storyMemory.currentMonthTheme ?? "Not specified"}
Current chapter: ${packet.storyMemory.currentChapter ?? "Not specified"}`);
  }
  if (packet.latestCampaigns.length) {
    lines.push(`## Latest Campaigns\n${packet.latestCampaigns.map((c) => `- ${c.name}: ${c.goal ?? ""} ${c.description ?? ""}`.trim()).join("\n")}`);
  }
  if (packet.recentApprovedOrPublishedPosts.length) {
    lines.push(`## Last Approved/Published Posts\n${packet.recentApprovedOrPublishedPosts.map((p) => `- ${p.platform ?? "social"} | ${p.topic}: ${p.caption.slice(0, 140)}`).join("\n")}`);
  }
  if (packet.aiIdeas.dismissed.length) {
    lines.push(`## Dismissed Ideas To Avoid\n${packet.aiIdeas.dismissed.map((i) => `- ${i.title}: ${i.dismissReason ?? "dismissed"}`).join("\n")}`);
  }
  if (packet.memoryEntries.length) {
    lines.push(`## Saved Memory\n${packet.memoryEntries.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`);
  }
  if (packet.growthRules.entries.length) {
    lines.push(`## Content Growth Rules
Use these when they fit naturally. Do not force links, WhatsApp, CTAs, hashtags, or keywords into every post.
Platform guidance: Instagram can use CTA plus hashtags; LinkedIn should use a professional CTA and fewer hashtags; Facebook can use friendly CTA plus link/WhatsApp; X needs a short CTA; Blog should use SEO keywords and meta focus.
${packet.growthRules.entries.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`);
  }
  return lines.join("\n\n");
}
