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
  visualStyle: string;
  imageStyle: string;
  fontStyle: string;
  designNotes: string;
  imageStyleNotes: string;
  confidenceNotes: string;
};

type WebsiteImageCandidate = {
  url: string;
  alt: string;
  sourcePage: string;
  reason: string;
};

type WebsiteColorCandidate = {
  hex: string;
  count: number;
};

type WebsitePageSnapshot = {
  url: string;
  title: string;
  text: string;
  html: string;
};

type WebsiteExtraction = {
  pages: WebsitePageSnapshot[];
  warnings: string[];
  logoCandidates: WebsiteImageCandidate[];
  imageCandidates: WebsiteImageCandidate[];
  colors: WebsiteColorCandidate[];
  fontFamilies: string[];
  cssFetched: number;
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

function isSafePublicUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return ["http:", "https:"].includes(url.protocol) && !(
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function absoluteUrl(value: string | undefined, base: URL): string | null {
  if (!value?.trim()) return null;
  const first = value.split(",")[0]?.trim().split(/\s+/)[0];
  if (!first || first.startsWith("data:") || first.startsWith("blob:") || first.startsWith("mailto:") || first.startsWith("tel:")) return null;
  try {
    const url = new URL(first, base);
    return isSafePublicUrl(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

function getAttr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1]?.trim() ?? "";
}

function extractMetaContent(html: string, names: string[]): string[] {
  const values: string[] = [];
  const wanted = names.map((name) => name.toLowerCase());
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (getAttr(tag, "property") || getAttr(tag, "name")).toLowerCase();
    if (wanted.includes(key)) {
      const content = getAttr(tag, "content");
      if (content) values.push(content);
    }
  }
  return values;
}

function extractReadableWebsiteText(html: string): string {
  const meta: string[] = [];
  meta.push(...extractMetaContent(html, ["description", "og:description", "twitter:description", "keywords"]));
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

function pageTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

async function fetchHtml(url: URL, timeoutMs = 8000): Promise<{ url: URL; html: string; warning?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const page = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "AI Marketing Studio Brand Importer/2.0",
        "accept": "text/html,application/xhtml+xml",
      },
    });
    if (!page.ok) return { url, html: "", warning: `Could not read ${url.toString()} (HTTP ${page.status}).` };
    const contentType = page.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { url, html: "", warning: `${url.toString()} did not return readable HTML.` };
    }
    return { url: new URL(page.url), html: await page.text() };
  } catch {
    return { url, html: "", warning: `Could not read ${url.toString()}.` };
  } finally {
    clearTimeout(timeout);
  }
}

function scoreLink(url: URL): number {
  const text = `${url.pathname} ${url.search}`.toLowerCase();
  if (/about|company|story|who-we-are/.test(text)) return 100;
  if (/service|services|product|products|solutions|shop|work/.test(text)) return 90;
  if (/contact|get-in-touch|book|demo/.test(text)) return 80;
  if (/pricing|case|portfolio|menu/.test(text)) return 55;
  if (/blog|news|privacy|terms|login|cart|account/.test(text)) return -20;
  return 20;
}

function extractInternalLinks(html: string, base: URL): URL[] {
  const urls = new Map<string, URL>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const absolute = absoluteUrl(match[1], base);
    if (!absolute) continue;
    const url = new URL(absolute);
    if (url.hostname !== base.hostname) continue;
    url.hash = "";
    urls.set(url.toString(), url);
  }
  return [...urls.values()].sort((a, b) => scoreLink(b) - scoreLink(a));
}

function addImageCandidate(list: WebsiteImageCandidate[], candidate: WebsiteImageCandidate) {
  if (!candidate.url || list.some((item) => item.url === candidate.url)) return;
  list.push(candidate);
}

function extractImagesFromHtml(html: string, pageUrl: URL, brandName = "") {
  const logoCandidates: WebsiteImageCandidate[] = [];
  const imageCandidates: WebsiteImageCandidate[] = [];
  const lowerBrand = brandName.toLowerCase();

  for (const imageUrl of extractMetaContent(html, ["og:image", "twitter:image"])) {
    const url = absoluteUrl(imageUrl, pageUrl);
    if (url) addImageCandidate(imageCandidates, { url, alt: "Social preview image", sourcePage: pageUrl.toString(), reason: "og:image" });
  }

  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        const logo = typeof entry?.logo === "string" ? entry.logo : entry?.logo?.url;
        const url = absoluteUrl(logo, pageUrl);
        if (url) addImageCandidate(logoCandidates, { url, alt: "Schema logo", sourcePage: pageUrl.toString(), reason: "schema.org logo" });
      }
    } catch {}
  }

  for (const match of html.matchAll(/<link\b[^>]*rel=["']([^"']*(?:icon|apple-touch-icon)[^"']*)["'][^>]*>/gi)) {
    const tag = match[0];
    const url = absoluteUrl(getAttr(tag, "href"), pageUrl);
    if (url) addImageCandidate(logoCandidates, { url, alt: "Site icon", sourcePage: pageUrl.toString(), reason: "favicon fallback" });
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = getAttr(tag, "src") || getAttr(tag, "data-src") || getAttr(tag, "data-lazy-src");
    const url = absoluteUrl(src, pageUrl);
    if (!url) continue;
    const alt = getAttr(tag, "alt");
    const className = getAttr(tag, "class");
    const id = getAttr(tag, "id");
    const width = Number(getAttr(tag, "width")) || 0;
    const height = Number(getAttr(tag, "height")) || 0;
    const signal = `${alt} ${className} ${id} ${url}`.toLowerCase();
    const candidate = { url, alt, sourcePage: pageUrl.toString(), reason: "image" };
    if (signal.includes("logo") || signal.includes("brand") || (lowerBrand && signal.includes(lowerBrand))) {
      addImageCandidate(logoCandidates, { ...candidate, reason: "logo-like image" });
    }
    if (width >= 300 || height >= 200 || /hero|product|service|feature|gallery|banner/.test(signal)) {
      addImageCandidate(imageCandidates, { ...candidate, reason: /hero/.test(signal) ? "hero image" : "large/product image" });
    }
  }

  for (const match of html.matchAll(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi)) {
    const raw = (match[1] ?? "").replace(/["']/g, "").trim();
    const url = absoluteUrl(raw, pageUrl);
    if (url) addImageCandidate(imageCandidates, { url, alt: "Background image", sourcePage: pageUrl.toString(), reason: "inline background image" });
  }

  return { logoCandidates, imageCandidates };
}

function normalizeHexColor(value: string): string | null {
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  const rgb = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
  }
  const hsl = hex.match(/^hsla?\(([\d.]+),\s*([\d.]+)%?,\s*([\d.]+)%?/);
  if (hsl) {
    const h = Number(hsl[1]) / 360;
    const s = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const hue = (p: number, q: number, t: number) => {
      let x = t;
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const rgb = s === 0
      ? [l, l, l]
      : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
    return `#${rgb.map((part) => Math.round(part * 255).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function colorIsNeutral(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 238 || max < 24 || max - min < 12;
}

function extractColors(cssText: string): WebsiteColorCandidate[] {
  const counts = new Map<string, number>();
  const patterns = [
    /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi,
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi,
    /hsla?\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+)?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of cssText.matchAll(pattern)) {
      const hex = normalizeHexColor(match[0]);
      if (!hex) continue;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()].map(([hex, count]) => ({ hex, count }));
  const nonNeutral = entries.filter((item) => !colorIsNeutral(item.hex));
  return (nonNeutral.length ? nonNeutral : entries).sort((a, b) => b.count - a.count).slice(0, 8);
}

function extractFontFamilies(cssText: string): string[] {
  const fonts = new Map<string, number>();
  for (const match of cssText.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const family = (match[1] ?? "").split(",")[0]?.replace(/["']/g, "").trim();
    if (family && !/inherit|initial|sans-serif|serif|monospace/i.test(family)) {
      fonts.set(family, (fonts.get(family) ?? 0) + 1);
    }
  }
  return [...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([font]) => font).slice(0, 5);
}

function extractStylesheetUrls(html: string, pageUrl: URL): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)) {
    const url = absoluteUrl(getAttr(match[0], "href"), pageUrl);
    if (url && new URL(url).hostname === pageUrl.hostname && !urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 6);
}

async function fetchCss(urls: string[], warnings: string[]): Promise<{ cssText: string; fetched: number }> {
  const chunks: string[] = [];
  let fetched = 0;
  for (const cssUrl of urls.slice(0, 6)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(cssUrl, { signal: controller.signal, redirect: "follow" }).finally(() => clearTimeout(timeout));
      if (res.ok && (res.headers.get("content-type") ?? "").includes("text/css")) {
        chunks.push(await res.text());
        fetched++;
      }
    } catch {
      warnings.push(`Could not read stylesheet ${cssUrl}.`);
    }
  }
  return { cssText: chunks.join("\n"), fetched };
}

async function crawlWebsite(startUrl: URL): Promise<WebsiteExtraction> {
  const warnings: string[] = [];
  const pages: WebsitePageSnapshot[] = [];
  const first = await fetchHtml(startUrl);
  if (first.warning || !first.html) {
    throw new Error("Website could not be fully read. Try another page URL or add details manually.");
  }
  const homeUrl = first.url;
  pages.push({ url: homeUrl.toString(), title: pageTitle(first.html), text: extractReadableWebsiteText(first.html), html: first.html });
  const links = extractInternalLinks(first.html, homeUrl).filter((url) => url.toString() !== homeUrl.toString()).slice(0, 12);
  const selected = links.slice(0, 4);
  for (const link of selected) {
    const result = await fetchHtml(link, 6500);
    if (result.warning || !result.html) {
      if (result.warning) warnings.push(result.warning);
      continue;
    }
    pages.push({ url: result.url.toString(), title: pageTitle(result.html), text: extractReadableWebsiteText(result.html), html: result.html });
    if (pages.length >= 5) break;
  }

  const logoCandidates: WebsiteImageCandidate[] = [];
  const imageCandidates: WebsiteImageCandidate[] = [];
  for (const page of pages) {
    const extracted = extractImagesFromHtml(page.html, new URL(page.url), "");
    extracted.logoCandidates.forEach((candidate) => addImageCandidate(logoCandidates, candidate));
    extracted.imageCandidates.forEach((candidate) => addImageCandidate(imageCandidates, candidate));
  }

  const cssUrls = [...new Set(pages.flatMap((page) => extractStylesheetUrls(page.html, new URL(page.url))))];
  const { cssText, fetched } = await fetchCss(cssUrls, warnings);
  const inlineCss = pages.map((page) => page.html).join("\n");
  const colors = extractColors(`${inlineCss}\n${cssText}`);
  const fontFamilies = extractFontFamilies(`${inlineCss}\n${cssText}`);

  if (fetched === 0 && cssUrls.length) warnings.push("Stylesheets could not be read; colors may be inferred from inline page styles only.");
  if (!logoCandidates.length) warnings.push("No clear logo candidate was found.");
  if (!colors.length) warnings.push("No strong CSS color palette was found.");

  return {
    pages,
    warnings,
    logoCandidates: logoCandidates.slice(0, 5),
    imageCandidates: imageCandidates.slice(0, 8),
    colors,
    fontFamilies,
    cssFetched: fetched,
  };
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
    visualStyle: "",
    imageStyle: "",
    fontStyle: "",
    designNotes: "",
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
    const extraction = await crawlWebsite(url);
    const websiteText = extraction.pages.map((page) => `PAGE: ${page.title || page.url}\nURL: ${page.url}\n${page.text}`).join("\n\n---\n\n").slice(0, 30000);
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
  "visualStyle": "overall visual identity in plain language",
  "imageStyle": "image/art direction notes from image alt text and page copy",
  "fontStyle": "font style notes from detected fonts and headings",
  "designNotes": "practical design guidance for future artwork",
  "imageStyleNotes": "image/art direction notes for future AI artwork",
  "confidenceNotes": "what is inferred vs clearly stated"
}

If something is not detectable, say "Not clear from the page" rather than inventing.

Website URL: ${url.toString()}
Pages analyzed: ${extraction.pages.map((page) => page.url).join(", ")}
Detected colors: ${extraction.colors.map((color) => `${color.hex} (${color.count})`).join(", ") || "None"}
Detected fonts: ${extraction.fontFamilies.join(", ") || "None"}
Logo candidates: ${extraction.logoCandidates.map((image) => image.url).join(", ") || "None"}
Image candidates: ${extraction.imageCandidates.slice(0, 4).map((image) => `${image.url} (${image.alt || image.reason})`).join(", ") || "None"}
Website text:
${websiteText}`;

    const responseText = await generateTextWithProvider(provider, model, prompt, 1200, req.userId);
    const analysis = parseAnalysisResponse(responseText);
    const palette = extraction.colors.slice(0, 3).map((color) => color.hex);
    if (!analysis.colorStyleHints && palette.length) analysis.colorStyleHints = palette.join(", ");
    if (!analysis.fontStyle && extraction.fontFamilies.length) analysis.fontStyle = extraction.fontFamilies.join(", ");
    if (!analysis.imageStyleNotes && analysis.imageStyle) analysis.imageStyleNotes = analysis.imageStyle;
    res.json({
      websiteUrl: url.toString(),
      finalUrl: extraction.pages[0]?.url ?? url.toString(),
      analysis,
      pagesAnalyzed: extraction.pages.map((page) => ({ url: page.url, title: page.title })),
      logoCandidates: extraction.logoCandidates,
      imageCandidates: extraction.imageCandidates,
      colors: extraction.colors,
      palette: {
        primary: palette[0] ?? "",
        secondary: palette[1] ?? "",
        accent: palette[2] ?? "",
      },
      fontFamilies: extraction.fontFamilies,
      warnings: extraction.warnings,
      cssFetched: extraction.cssFetched,
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
