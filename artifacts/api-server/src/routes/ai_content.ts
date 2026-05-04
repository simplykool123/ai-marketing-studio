import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { postsTable, campaignsTable, userSettingsTable, imagesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { buildClientContext, buildImagePrompt } from "../lib/context-engine.js";

const router = Router();

function getAnthropicClient(): Anthropic {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) throw new Error("ANTHROPIC_KEY not set");
  return new Anthropic({ apiKey: key });
}

function getOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_KEY;
  if (!key) throw new Error("OPENAI_KEY not set");
  return new OpenAI({ apiKey: key });
}

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return settings ?? null;
}

async function generateTextWithClaude(prompt: string, maxTokens = 2000): Promise<string> {
  const anthropic = getAnthropicClient();
  const msg = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
}

async function generateTextWithProvider(provider: string, model: string, prompt: string, maxTokens = 2000): Promise<string> {
  if (provider === "openai") {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: model || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }
  return generateTextWithClaude(prompt, maxTokens);
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON found in AI response");
  return JSON.parse(match[0]);
}

// Background: generate a DALL-E 3 image for each post, save to posts + images table
async function triggerBackgroundImageGen(
  posts: Array<{ id: string; caption: string | null; imagePrompt: string | null }>,
  clientId: string
): Promise<void> {
  for (const post of posts) {
    try {
      const openai = getOpenAIClient();
      const prompt = post.imagePrompt?.trim()
        ? post.imagePrompt
        : await buildImagePrompt(clientId, post.caption ?? "");

      const result = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "url",
      });

      const imageUrl = result.data?.[0]?.url ?? "";

      await db
        .update(postsTable)
        .set({ selectedImageUrl: imageUrl, generationStatus: "ready", imagePrompt: prompt, updatedAt: new Date() })
        .where(eq(postsTable.id, post.id));

      await db.insert(imagesTable).values({
        clientId,
        postId: post.id,
        url: imageUrl,
        provider: "openai",
        status: "ready",
        prompt,
      });
    } catch {
      await db
        .update(postsTable)
        .set({ generationStatus: "failed", updatedAt: new Date() })
        .where(eq(postsTable.id, post.id))
        .catch(() => {});
    }
  }
}

// POST /clients/:clientId/campaigns/:campaignId/generate-plan
router.post("/clients/:clientId/campaigns/:campaignId/generate-plan", async (req: any, res): Promise<void> => {
  try {
    const { clientId, campaignId } = req.params;
    const { postsCount = 7, platforms = ["instagram", "facebook", "linkedin"] } = req.body;

    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.clientId, clientId)))
      .limit(1);

    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const context = await buildClientContext(clientId);
    const settings = await getUserSettings(req.userId);
    const provider = settings?.aiProvider ?? "anthropic";
    const model = settings?.aiModel ?? "claude-opus-4-5";
    const platformList = Array.isArray(platforms) ? platforms.join(", ") : platforms;

    const prompt = `You are a professional content strategist. Using the brand context below, generate exactly ${postsCount} distinct post ideas for this campaign.

Campaign: "${campaign.name}"
Goal: ${campaign.goal ?? "Brand awareness and engagement"}
Description: ${campaign.description ?? ""}

${context}

Target platforms: ${platformList}

For each post, provide:
- A specific topic (1 sentence)
- The target platform from the list above
- A brief caption (2-3 sentences that match the brand voice)
- Relevant hashtags (6-10)
- A DALL-E image prompt (1-2 sentences describing the ideal visual: composition, style, mood, brand colors)

Vary the post types: mix product showcases, educational content, behind-the-scenes, customer-focused, and storytelling posts.

Respond with ONLY valid JSON:
{
  "posts": [
    {
      "topic": "Specific topic for this post",
      "platform": "instagram",
      "caption": "Full caption text here...",
      "hashtags": "#tag1 #tag2 #tag3",
      "imagePrompt": "A photorealistic image of..."
    }
  ]
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 3000);
    const parsed = extractJson(responseText) as { posts: Array<{ topic: string; platform: string; caption: string; hashtags: string; imagePrompt?: string }> };

    if (!parsed || !Array.isArray((parsed as any).posts)) {
      throw new Error("Invalid plan structure from AI");
    }

    const insertValues = (parsed as any).posts.map((p: any) => ({
      clientId,
      campaignId,
      topic: p.topic ?? "Untitled post",
      caption: p.caption ?? "",
      hashtags: p.hashtags ?? "",
      platform: p.platform ?? "instagram",
      status: "draft" as const,
      postType: "social" as const,
      generationStatus: "generating",
      imagePrompt: p.imagePrompt ?? null,
    }));

    const created = await db.insert(postsTable).values(insertValues).returning();

    // Fire-and-forget background image generation
    triggerBackgroundImageGen(created, clientId).catch(() => {});

    res.json({ posts: created, generatedCount: created.length });
  } catch (err) {
    console.error("generate-plan error:", err);
    res.status(500).json({ error: "Failed to generate campaign plan" });
  }
});

// POST /clients/:clientId/posts/:postId/regenerate-copy
router.post("/clients/:clientId/posts/:postId/regenerate-copy", async (req: any, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;

    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }

    const context = await buildClientContext(clientId);
    const settings = await getUserSettings(req.userId);
    const provider = settings?.aiProvider ?? "anthropic";
    const model = settings?.aiModel ?? "claude-opus-4-5";

    const prompt = `You are a professional social media copywriter. Using the brand context and post topic below, generate a fresh, engaging caption with hashtags.

${context}

## Post Topic
${post.topic}

Platform: ${post.platform ?? "instagram"}

Requirements:
- Write a compelling caption that matches the brand's voice and tone
- Include 6-10 relevant hashtags
- Keep it engaging and platform-appropriate
- Do NOT reuse the exact previous caption

Respond with ONLY valid JSON:
{
  "caption": "The new caption text...",
  "hashtags": "#tag1 #tag2 #tag3"
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 1000);
    const parsed = extractJson(responseText) as { caption: string; hashtags: string };

    const [updated] = await db
      .update(postsTable)
      .set({
        caption: (parsed as any).caption ?? post.caption,
        hashtags: (parsed as any).hashtags ?? post.hashtags,
        generationStatus: "ready",
        updatedAt: new Date(),
      })
      .where(eq(postsTable.id, postId))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("regenerate-copy error:", err);
    res.status(500).json({ error: "Failed to regenerate copy" });
  }
});

// POST /clients/:clientId/posts/:postId/generate-image
router.post("/clients/:clientId/posts/:postId/generate-image", async (req: any, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;

    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }

    await db
      .update(postsTable)
      .set({ generationStatus: "generating", updatedAt: new Date() })
      .where(eq(postsTable.id, postId));

    const imagePrompt = post.imagePrompt?.trim()
      ? post.imagePrompt
      : await buildImagePrompt(clientId, post.caption ?? "");
    const openai = getOpenAIClient();

    const result = await openai.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "url",
    });

    const imageUrl = result.data?.[0]?.url ?? "";

    const [updated] = await db
      .update(postsTable)
      .set({
        selectedImageUrl: imageUrl,
        imagePrompt,
        generationStatus: "ready",
        updatedAt: new Date(),
      })
      .where(eq(postsTable.id, postId))
      .returning();

    // Persist image as an asset
    await db.insert(imagesTable).values({
      clientId,
      postId,
      url: imageUrl,
      provider: "openai",
      status: "ready",
      prompt: imagePrompt,
    });

    res.json(updated);
  } catch (err) {
    console.error("generate-image error:", err);
    await db
      .update(postsTable)
      .set({ generationStatus: "failed", updatedAt: new Date() })
      .where(eq(postsTable.id, req.params.postId))
      .catch(() => {});
    res.status(500).json({ error: "Failed to generate image" });
  }
});

// POST /clients/:clientId/generate-bulk
router.post("/clients/:clientId/generate-bulk", async (req: any, res) => {
  try {
    const { clientId } = req.params;
    const { weeks = 1, postsPerWeek = 5, platforms = ["instagram", "facebook", "linkedin"], campaignId } = req.body;

    const totalPosts = Math.min(weeks * postsPerWeek, 28);
    const context = await buildClientContext(clientId);
    const settings = await getUserSettings(req.userId);
    const provider = settings?.aiProvider ?? "anthropic";
    const model = settings?.aiModel ?? "claude-opus-4-5";
    const platformList = Array.isArray(platforms) ? platforms.join(", ") : platforms;

    const prompt = `You are a senior content strategist for a digital marketing agency. Using the brand context below, create a complete ${weeks}-week content calendar with exactly ${totalPosts} posts.

${context}

Target platforms: ${platformList}
Timeline: ${weeks} week${weeks > 1 ? "s" : ""} of content, ${postsPerWeek} posts per week

Requirements:
- Distribute posts evenly across the specified platforms
- Mix content types: product/service showcases, educational tips, behind-the-scenes, storytelling, calls-to-action
- Each post must have a unique, specific topic (not generic)
- Captions should match the brand's exact tone and voice
- Include 6-10 relevant hashtags per post
- Build a content narrative arc across the ${weeks} week${weeks > 1 ? "s" : ""}
- For each post include a DALL-E image prompt (1-2 sentences describing the ideal visual: composition, style, mood, brand colors)

Respond with ONLY valid JSON:
{
  "posts": [
    {
      "topic": "Specific, unique topic for this post",
      "platform": "instagram",
      "caption": "Full caption that matches brand voice...",
      "hashtags": "#tag1 #tag2 #tag3",
      "imagePrompt": "A photorealistic image of..."
    }
  ]
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 4000);
    const parsed = extractJson(responseText) as { posts: any[] };

    if (!parsed || !Array.isArray((parsed as any).posts)) {
      throw new Error("Invalid bulk generation response");
    }

    const insertValues = (parsed as any).posts.slice(0, totalPosts).map((p: any) => ({
      clientId,
      campaignId: campaignId || null,
      topic: p.topic ?? "Untitled post",
      caption: p.caption ?? "",
      hashtags: p.hashtags ?? "",
      platform: p.platform ?? "instagram",
      status: "draft" as const,
      postType: "social" as const,
      generationStatus: "generating",
      imagePrompt: p.imagePrompt ?? null,
    }));

    const created = await db.insert(postsTable).values(insertValues).returning();

    // Fire-and-forget background image generation
    triggerBackgroundImageGen(created, clientId).catch(() => {});

    res.json({ posts: created, generatedCount: created.length });
  } catch (err) {
    console.error("bulk-generate error:", err);
    res.status(500).json({ error: "Failed to bulk generate posts" });
  }
});

export default router;
