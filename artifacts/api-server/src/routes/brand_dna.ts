import { Router } from "express";
import { db } from "@workspace/db";
import { brandDnaTable, userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { UpsertBrandDnaBody } from "@workspace/api-zod";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import {
  generateTextWithProvider,
  resolveProviderAndModel,
  safeErrorMessage,
  toAiErrorResponse,
} from "../lib/ai-provider.js";
import { logger } from "../lib/logger.js";

const router = Router();

type BrandWebsiteAnalysis = {
  brandTone: string;
  targetAudience: string;
  productsServices: string;
  usp: string;
  contentPillars: string;
  colorStyleHints: string;
  keywords: string;
  imageStyleNotes: string;
  confidenceNotes: string;
};

async function getUserSettings(userId?: string) {
  if (!userId) return null;
  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return settings ?? null;
}

function normalizeWebsiteUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Enter a website URL.");
  const withProtocol = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are supported.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("Private or local network URLs are not supported.");
  }
  return url;
}

function extractReadableWebsiteText(html: string): string {
  const meta: string[] = [];
  for (const match of html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description|keywords)["'][^>]*content=["']([^"']+)["'][^>]*>/gi)) {
    meta.push(match[1] ?? "");
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return [title, ...meta, clean].filter(Boolean).join("\n").slice(0, 12000);
}

function emptyAnalysis(): BrandWebsiteAnalysis {
  return {
    brandTone: "",
    targetAudience: "",
    productsServices: "",
    usp: "",
    contentPillars: "",
    colorStyleHints: "",
    keywords: "",
    imageStyleNotes: "",
    confidenceNotes: "",
  };
}

function parseAnalysisResponse(text: string): BrandWebsiteAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response was not valid JSON.");
  return { ...emptyAnalysis(), ...JSON.parse(jsonMatch[0]) };
}

router.get("/clients/:clientId/brand-dna", async (req, res): Promise<void> => {
  try {
    const [dna] = await db
      .select()
      .from(brandDnaTable)
      .where(eq(brandDnaTable.clientId, req.params.clientId))
      .limit(1);
    if (!dna) { res.json(null); return; }
    res.json(dna);
  } catch (err) {
    res.status(500).json({ error: "Failed to get brand DNA" });
  }
});

router.put("/clients/:clientId/brand-dna", requireClientRole(EDIT_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const body = UpsertBrandDnaBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(brandDnaTable)
      .where(eq(brandDnaTable.clientId, req.params.clientId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(brandDnaTable)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(brandDnaTable.clientId, req.params.clientId))
        .returning();
      res.json(updated); return;
    }

    const [created] = await db
      .insert(brandDnaTable)
      .values({ clientId: req.params.clientId, ...body })
      .returning();
    res.status(200).json(created);
  } catch (err) {
    res.status(400).json({ error: "Failed to upsert brand DNA" });
  }
});

router.post("/clients/:clientId/brand-dna/analyze-website", requireClientRole(EDIT_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const url = normalizeWebsiteUrl((req.body as { websiteUrl?: string }).websiteUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const page = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "AI Marketing Studio Brand Importer/1.0",
        "accept": "text/html,application/xhtml+xml",
      },
    }).finally(() => clearTimeout(timeout));

    if (!page.ok) {
      res.status(422).json({ error: `Could not fetch website. The server returned HTTP ${page.status}.` });
      return;
    }
    const contentType = page.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      res.status(422).json({ error: "The URL did not return a readable website page." });
      return;
    }

    const html = await page.text();
    const websiteText = extractReadableWebsiteText(html);
    if (websiteText.length < 120) {
      res.status(422).json({ error: "The page did not contain enough readable text to analyze." });
      return;
    }

    const settings = await getUserSettings(req.userId);
    const { provider, model } = await resolveProviderAndModel(settings, req.userId);
    const prompt = `You are a senior brand strategist for an AI digital agency. Extract Brand Setup suggestions from the website text below.

Return ONLY valid JSON with this shape:
{
  "brandTone": "short tone description",
  "targetAudience": "who the brand appears to serve",
  "productsServices": "main products or services",
  "usp": "differentiator or promise",
  "contentPillars": "comma-separated content pillar suggestions",
  "colorStyleHints": "visual/color/style hints detectable from copy",
  "keywords": "comma-separated keyword ideas",
  "imageStyleNotes": "image/art direction notes for future AI artwork",
  "confidenceNotes": "what is inferred vs clearly stated"
}

If something is not detectable, say "Not clear from the page" rather than inventing.

Website URL: ${url.toString()}
Website text:
${websiteText}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 1200, req.userId);
    res.json({
      websiteUrl: url.toString(),
      analysis: parseAnalysisResponse(responseText),
    });
  } catch (err) {
    if (err instanceof Error && /website url|private|local|http/i.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    const { status, message } = toAiErrorResponse(err, "Failed to analyze website. Check the URL and AI provider settings.");
    logger.error({ error: safeErrorMessage(err) }, "Website brand analysis error");
    res.status(status).json({ error: message });
  }
});

export default router;
