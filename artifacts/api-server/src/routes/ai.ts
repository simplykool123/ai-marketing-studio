import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildClientContext, buildImagePrompt } from "../lib/context-engine.js";
import { GenerateCaptionsBody, GenerateImagesBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

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

function getGeminiClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_KEY;
  if (!key) throw new Error("GEMINI_KEY not set");
  return new GoogleGenerativeAI(key);
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

async function generateTextWithProvider(
  provider: string,
  model: string,
  prompt: string
): Promise<string> {
  if (provider === "openai") {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: model || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    });
    return res.choices[0]?.message?.content ?? "";
  }
  if (provider === "gemini") {
    const genai = getGeminiClient();
    const geminiModel = genai.getGenerativeModel({ model: model || "gemini-1.5-pro" });
    const res = await geminiModel.generateContent(prompt);
    return res.response.text();
  }
  // Default: anthropic
  const anthropic = getAnthropicClient();
  const msg = await anthropic.messages.create({
    model: model || "claude-opus-4-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
}

router.post("/ai/generate-captions", async (req: any, res) => {
  try {
    const body = GenerateCaptionsBody.parse(req.body);
    const context = await buildClientContext(body.clientId);
    const settings = await getUserSettings(req.userId);
    const provider = settings?.aiProvider ?? "anthropic";
    const model = settings?.aiModel ?? "claude-opus-4-5";

    const prompt = `You are a professional social media content strategist. Using the brand context below, generate exactly 3 distinct caption options for a post about the given topic. Each caption must match the brand's voice and tone.

${context}

## Post Topic
${body.topic}

## Instructions
- Generate exactly 3 caption options
- Each caption should be distinct in approach and style
- Include relevant hashtags for each caption (5-10 hashtags)
- Keep captions engaging and platform-appropriate
- Do NOT number the captions in the text itself

Respond with ONLY valid JSON in this exact format:
{
  "options": [
    { "id": 1, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" },
    { "id": 2, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" },
    { "id": 3, "caption": "...", "hashtags": "#tag1 #tag2 #tag3" }
  ]
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response format");
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error("Caption generation error:", err);
    res.status(500).json({ error: "Failed to generate captions" });
  }
});

type ImagePanel = "left" | "right";
type ImageProvider = "openai" | "google";

interface GeneratedImage {
  provider: ImageProvider;
  panel: ImagePanel;
  url: string;
  prompt: string;
  error?: string;
}

router.post("/ai/generate-images", async (req, res) => {
  try {
    const body = GenerateImagesBody.parse(req.body);
    const basePrompt = await buildImagePrompt(body.clientId, body.caption, body.visualStyle);
    const altPrompt = `${basePrompt} Alternative artistic interpretation with a different visual angle.`;
    const openai = getOpenAIClient();

    const [leftResult, rightResult] = await Promise.allSettled([
      openai.images.generate({
        model: "dall-e-3",
        prompt: basePrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "url",
      }),
      openai.images.generate({
        model: "dall-e-3",
        prompt: altPrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "url",
      }),
    ]);

    const images: GeneratedImage[] = [];
    const leftUrl = leftResult.status === "fulfilled" ? (leftResult.value.data?.[0]?.url ?? "") : "";
    const rightUrl = rightResult.status === "fulfilled" ? (rightResult.value.data?.[0]?.url ?? "") : "";

    images.push({
      provider: "openai",
      panel: "left",
      url: leftUrl,
      prompt: basePrompt,
      ...(leftResult.status === "rejected" ? { error: String((leftResult.reason as Error)?.message ?? "Generation failed") } : {}),
    });
    images.push({
      provider: "openai",
      panel: "right",
      url: rightUrl,
      prompt: altPrompt,
      ...(rightResult.status === "rejected" ? { error: String((rightResult.reason as Error)?.message ?? "Generation failed") } : {}),
    });

    res.json({ images });
  } catch (err) {
    console.error("Image generation error:", err);
    res.status(500).json({ error: "Failed to generate images" });
  }
});

// POST /clients/:clientId/suggestions — AI Brain content ideas
router.post("/clients/:clientId/suggestions", async (req: any, res) => {
  try {
    const { clientId } = req.params;
    const context = await buildClientContext(clientId);
    const settings = await getUserSettings(req.userId);
    const provider = settings?.aiProvider ?? "anthropic";
    const model = settings?.aiModel ?? "claude-opus-4-5";
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    const prompt = `You are a senior content strategist. Based on the brand context below, suggest 5 specific content ideas for the next 7 days of posts.

${context}

Today's date: ${today}

Rules:
- Each idea must be specific (not generic like "share a tip")
- Mix platforms and post types
- Consider current season and timing
- Make the hook irresistible

Respond with ONLY valid JSON:
{
  "suggestions": [
    {
      "topic": "Specific post idea in 1 sentence",
      "platform": "instagram",
      "postType": "social",
      "rationale": "Why this fits the brand right now (1 sentence)",
      "hook": "Opening line or visual concept"
    }
  ]
}`;

    const responseText = await generateTextWithProvider(provider, model, prompt);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response");
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json({ error: "Failed to generate suggestions" });
  }
});

export default router;
