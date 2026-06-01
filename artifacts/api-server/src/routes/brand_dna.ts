import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
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
import { createClientNotification } from "../lib/notifications.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

type BrandWebsiteAnalysis = {
  brandName: string;
  brandTone: string;
  targetAudience: string;
  productsServices: string;
  usp: string;
  contentPillars: string;
  colorStyleHints: string;
  keywords: string;
  seoKeywords: string;
  defaultHashtags: string;
  primaryCTA: string;
  secondaryCTA: string;
  preferredPlatforms: string;
  serviceAreas: string;
  visualStyle: string;
  imageStyle: string;
  fontStyle: string;
  designNotes: string;
  imageStyleNotes: string;
  confidenceNotes: string;
};

type DirectContactData = {
  phone: string;
  email: string;
  whatsappNumber: string;
  whatsappLink: string;
  address: string;
  city: string;
  country: string;
};

type WebsiteImageCandidate = {
  url: string;
  previewUrl?: string;
  alt: string;
  sourcePage: string;
  reason: string;
  contentType?: string;
};

type WebsiteColorCandidate = {
  hex: string;
  count: number;
  score: number;
  source?: "css" | "screenshot";
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
  visibleColors: WebsiteColorCandidate[];
  cssColors: WebsiteColorCandidate[];
  fontFamilies: string[];
  cssFetched: number;
  rendered?: RenderedWebsiteAnalysis;
};

type RenderedWebsiteAnalysis = {
  screenshotCaptured: boolean;
  screenshotNote: string;
  colors: WebsiteColorCandidate[];
  imageCandidates: WebsiteImageCandidate[];
  logoCandidates: WebsiteImageCandidate[];
};

type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

const IMAGE_PROXY_PATH = "/api/brand-assets/proxy-image";
const IMAGE_FETCH_HEADERS = {
  "user-agent": "AI Marketing Studio Brand Importer/2.0",
  "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};
const BASIC_HTML_FETCH_HEADERS = {
  "user-agent": "AI Marketing Studio Brand Importer/2.0",
  "accept": "text/html,application/xhtml+xml",
};
const BROWSER_HTML_FETCH_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "upgrade-insecure-requests": "1",
};
const MAX_PROXY_IMAGE_BYTES = 8 * 1024 * 1024;

type FetchHtmlResult = {
  url: URL;
  html: string;
  warning?: string;
  status?: number;
  attempt?: "normal_fetch" | "browser_header_fetch" | "playwright_rendered_html";
  failureType?: "timeout" | "dns" | "blocked" | "http_status" | "content_type" | "network" | "unknown";
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

function parseSafePublicUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Missing image URL.");
  const url = new URL(raw);
  if (!isSafePublicUrl(url)) throw new Error("Only public http and https image URLs are supported.");
  return url;
}

function imageProxyUrl(url: string): string {
  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(url)}`;
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

function fetchFailureType(err: unknown): FetchHtmlResult["failureType"] {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  if (name.includes("abort") || message.includes("abort") || message.includes("timeout")) return "timeout";
  if (message.includes("enotfound") || message.includes("dns") || message.includes("getaddrinfo")) return "dns";
  if (message.includes("econnreset") || message.includes("socket") || message.includes("network")) return "network";
  if (message.includes("forbidden") || message.includes("blocked")) return "blocked";
  return "unknown";
}

async function fetchHtmlAttempt(
  url: URL,
  timeoutMs: number,
  attempt: FetchHtmlResult["attempt"],
  headers: Record<string, string>,
): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const page = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers,
    });
    if (!page.ok) {
      return {
        url,
        html: "",
        warning: `${attempt} could not read ${url.toString()} (HTTP ${page.status}).`,
        status: page.status,
        attempt,
        failureType: page.status === 403 || page.status === 401 ? "blocked" : "http_status",
      };
    }
    const contentType = page.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        url,
        html: "",
        warning: `${attempt} reached ${url.toString()} but it did not return readable HTML (${contentType || "unknown content type"}).`,
        status: page.status,
        attempt,
        failureType: "content_type",
      };
    }
    return { url: new URL(page.url), html: await page.text(), status: page.status, attempt };
  } catch (err) {
    const failureType = fetchFailureType(err);
    return {
      url,
      html: "",
      warning: `${attempt} could not read ${url.toString()} (${failureType}).`,
      attempt,
      failureType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtml(url: URL, timeoutMs = 8000, retryWithBrowserHeaders = false): Promise<FetchHtmlResult> {
  const first = await fetchHtmlAttempt(url, timeoutMs, "normal_fetch", BASIC_HTML_FETCH_HEADERS);
  if (first.html || !retryWithBrowserHeaders) return first;

  const retryHeaders: Record<string, string> = {
    ...BROWSER_HTML_FETCH_HEADERS,
    "referer": `${url.protocol}//${url.hostname}/`,
  };
  const second = await fetchHtmlAttempt(url, Math.max(timeoutMs + 4000, 12000), "browser_header_fetch", retryHeaders);
  if (second.html) return second;

  return {
    ...second,
    warning: `Homepage fetch failed after normal_fetch and browser_header_fetch. ${first.warning ?? ""} ${second.warning ?? ""}`.trim(),
  };
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

function colorChannels(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`;
}

function colorMetrics(hex: string): { r: number; g: number; b: number; max: number; min: number; lightness: number; saturation: number; hue: number } {
  const { r, g, b } = colorChannels(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { r, g, b, max: Math.round(max * 255), min: Math.round(min * 255), lightness, saturation, hue };
}

function colorIsNeutral(hex: string): boolean {
  const metrics = colorMetrics(hex);
  return metrics.max > 238 || metrics.max < 24 || metrics.max - metrics.min < 14;
}

function isVeryGenericPixel(hex: string): boolean {
  const metrics = colorMetrics(hex);
  return (metrics.lightness > 0.97 && metrics.saturation < 0.08) || (metrics.lightness < 0.04 && metrics.saturation < 0.08);
}

function extractColors(cssText: string): WebsiteColorCandidate[] {
  const counts = new Map<string, { count: number; score: number }>();
  const socialColors = new Set(["#1877f2", "#1da1f2", "#000000", "#e4405f", "#ff0000", "#bd081c", "#0077b5"]);
  const utilityContext = /elementor|woocommerce|swiper|slick|jetpack|cookie|captcha|recaptcha|facebook|twitter|linkedin|instagram|youtube|social|--tw-/i;
  const brandContext = /logo|brand|primary|secondary|accent|theme|header|navbar|nav-|button|btn|cta|hero|banner|menu|root|:root|--/i;
  const strongContext = /logo|brand|primary|accent|button|btn|cta|hero|header|navbar|:root|--/i;
  const patterns = [
    /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi,
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi,
    /hsla?\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+)?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of cssText.matchAll(pattern)) {
      const hex = normalizeHexColor(match[0]);
      if (!hex) continue;
      const index = match.index ?? 0;
      const context = cssText.slice(Math.max(0, index - 180), Math.min(cssText.length, index + 180));
      const neutral = colorIsNeutral(hex);
      let score = 1;
      if (brandContext.test(context)) score += 4;
      if (strongContext.test(context)) score += 6;
      if (/--[\w-]*(brand|primary|secondary|accent|theme|button|cta|header|nav)[\w-]*\s*:/i.test(context)) score += 14;
      if (/<svg|fill=|stroke=|logo/i.test(context)) score += 10;
      if (/background(?:-color)?\s*:[^;}]*$/i.test(context.slice(0, 90))) score += 3;
      if (utilityContext.test(context)) score -= 8;
      if (neutral) score -= 10;
      if (socialColors.has(hex)) score -= 8;
      const current = counts.get(hex) ?? { count: 0, score: 0 };
      counts.set(hex, { count: current.count + 1, score: current.score + Math.max(0.1, score) });
    }
  }
  const entries = [...counts.entries()].map(([hex, value]) => ({ hex, count: value.count, score: value.score, source: "css" as const }));
  const nonNeutral = entries.filter((item) => !colorIsNeutral(item.hex));
  return (nonNeutral.length ? nonNeutral : entries)
    .sort((a, b) => (b.score - a.score) || (b.count - a.count))
    .slice(0, 10);
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
      const res = await fetch(cssUrl, { signal: controller.signal, redirect: "follow", headers: { "user-agent": IMAGE_FETCH_HEADERS["user-agent"], "accept": "text/css,*/*;q=0.8" } }).finally(() => clearTimeout(timeout));
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

async function validateImageUrl(url: string): Promise<{ ok: true; contentType: string } | { ok: false; warning: string }> {
  const parsed = parseSafePublicUrl(url);
  const tryFetch = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      return await fetch(parsed, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: method === "GET" ? { ...IMAGE_FETCH_HEADERS, "range": "bytes=0-2047" } : IMAGE_FETCH_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    let response = await tryFetch("HEAD");
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) {
      response = await tryFetch("GET");
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok) return { ok: false, warning: `Image could not be read (HTTP ${response.status}).` };
    if (!contentType.startsWith("image/")) return { ok: false, warning: "URL did not return an image." };
    if (contentLength > MAX_PROXY_IMAGE_BYTES) return { ok: false, warning: "Image was too large to preview safely." };
    return { ok: true, contentType };
  } catch {
    return { ok: false, warning: "Website blocks preview for this image." };
  }
}

async function validateImageCandidates(
  candidates: WebsiteImageCandidate[],
  limit: number,
  warnings: string[],
  label: "logo" | "image",
): Promise<WebsiteImageCandidate[]> {
  const valid: WebsiteImageCandidate[] = [];
  for (const candidate of candidates) {
    if (valid.length >= limit) break;
    const validation = await validateImageUrl(candidate.url);
    if (validation.ok) {
      valid.push({
        ...candidate,
        contentType: validation.contentType,
        previewUrl: imageProxyUrl(candidate.url),
      });
    }
  }
  if (!valid.length && candidates.length) {
    warnings.push(
      label === "logo"
        ? "Logo found but website blocks preview. Upload manually or save via import later."
        : "Some website images were found but could not be previewed safely.",
    );
  }
  return valid;
}

async function fetchLogoColorText(candidates: WebsiteImageCandidate[], warnings: string[]): Promise<string> {
  const chunks: string[] = [];
  for (const candidate of candidates.slice(0, 2)) {
    if (!/\.svg(?:$|\?)/i.test(candidate.url)) continue;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(candidate.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": IMAGE_FETCH_HEADERS["user-agent"], "accept": "image/svg+xml,text/xml,*/*;q=0.8" },
      }).finally(() => clearTimeout(timeout));
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && (contentType.includes("svg") || /\.svg(?:$|\?)/i.test(candidate.url))) {
        chunks.push(`/* logo svg ${candidate.url} */\n${await response.text()}`);
      }
    } catch {
      warnings.push(`Could not read logo SVG colors from ${candidate.url}.`);
    }
  }
  return chunks.join("\n");
}

function selectVisiblePalette(colors: WebsiteColorCandidate[]): WebsiteColorCandidate[] {
  const sorted = colors
    .filter((color) => !isVeryGenericPixel(color.hex))
    .sort((a, b) => (b.score - a.score) || (b.count - a.count));
  const selected: WebsiteColorCandidate[] = [];
  const isWarm = (hex: string) => {
    const metrics = colorMetrics(hex);
    return metrics.hue >= 15 && metrics.hue <= 65 && metrics.saturation > 0.08;
  };
  const buckets = [
    (hex: string) => isWarm(hex) && colorMetrics(hex).lightness < 0.38,
    (hex: string) => isWarm(hex) && colorMetrics(hex).lightness >= 0.74,
    (hex: string) => isWarm(hex) && colorMetrics(hex).lightness >= 0.38 && colorMetrics(hex).lightness < 0.74,
    (hex: string) => {
      const metrics = colorMetrics(hex);
      return metrics.lightness < 0.32 && metrics.saturation < 0.16;
    },
  ];
  for (const bucket of buckets) {
    const found = sorted.find((color) => bucket(color.hex) && !selected.some((item) => item.hex === color.hex));
    if (found) selected.push(found);
  }
  for (const color of sorted) {
    if (selected.length >= 6) break;
    const tooClose = selected.some((item) => {
      const a = colorChannels(item.hex);
      const b = colorChannels(color.hex);
      return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 58;
    });
    if (!tooClose) selected.push(color);
  }
  return selected.slice(0, 6);
}

async function extractScreenshotColors(screenshot: Buffer): Promise<WebsiteColorCandidate[]> {
  const { data, info } = await sharp(screenshot)
    .resize({ width: 180, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, { count: number; score: number }>();
  const channels = info.channels;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const index = (y * info.width + x) * channels;
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      const hex = rgbToHex(Math.round(r / 8) * 8, Math.round(g / 8) * 8, Math.round(b / 8) * 8);
      if (isVeryGenericPixel(hex)) continue;
      const metrics = colorMetrics(hex);
      let regionWeight = 1;
      const yRatio = y / info.height;
      if (yRatio < 0.12) regionWeight += 3;
      else if (yRatio < 0.58) regionWeight += 2.5;
      else if (yRatio > 0.86) regionWeight += 1.5;
      const warmth = metrics.hue >= 15 && metrics.hue <= 65 ? 1.6 : 1;
      const saturation = Math.max(0.5, metrics.saturation * 2.2);
      const current = counts.get(hex) ?? { count: 0, score: 0 };
      counts.set(hex, { count: current.count + 1, score: current.score + regionWeight * warmth * saturation });
    }
  }
  return selectVisiblePalette([...counts.entries()].map(([hex, value]) => ({
    hex,
    count: value.count,
    score: value.score,
    source: "screenshot" as const,
  })));
}

type OptionalPlaywrightBrowser = {
  newPage(options?: unknown): Promise<{
    goto(url: string, options?: unknown): Promise<unknown>;
    waitForLoadState(state: string, options?: unknown): Promise<unknown>;
    waitForTimeout(ms: number): Promise<unknown>;
    content(): Promise<string>;
    screenshot(options?: unknown): Promise<Buffer>;
    evaluate<T>(fn: () => T): Promise<T>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
};

async function loadPlaywrightChromium(): Promise<{ launch(options?: unknown): Promise<OptionalPlaywrightBrowser> } | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const mod = await importer("playwright") as { chromium?: { launch(options?: unknown): Promise<OptionalPlaywrightBrowser> } };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

async function fetchRenderedHtml(url: URL): Promise<FetchHtmlResult> {
  const chromium = await loadPlaywrightChromium();
  if (!chromium) {
    return {
      url,
      html: "",
      warning: "Playwright rendered HTML fallback skipped because Playwright is not installed in this runtime.",
      attempt: "playwright_rendered_html",
      failureType: "unknown",
    };
  }
  let browser: OptionalPlaywrightBrowser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 16000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(500);
    const html = await page.content();
    return { url, html, attempt: "playwright_rendered_html" };
  } catch (err) {
    return {
      url,
      html: "",
      warning: `Playwright rendered HTML fallback failed (${fetchFailureType(err)}).`,
      attempt: "playwright_rendered_html",
      failureType: fetchFailureType(err),
    };
  } finally {
    await browser?.close().catch(() => null);
  }
}

async function captureRenderedWebsite(url: URL, warnings: string[]): Promise<RenderedWebsiteAnalysis | null> {
  const chromium = await loadPlaywrightChromium();
  if (!chromium) {
    warnings.push("Rendered screenshot analysis skipped because Playwright is not installed in this runtime. Falling back to HTML/CSS extraction.");
    return null;
  }
  let browser: OptionalPlaywrightBrowser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 1 });
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(800);
    const rendered = await page.evaluate<{
      imageCandidates: WebsiteImageCandidate[];
      logoCandidates: WebsiteImageCandidate[];
    }>(() => {
      const w = globalThis as unknown as { location: { href: string }; getComputedStyle(el: unknown): { backgroundImage: string } };
      const d = (globalThis as unknown as { document: { querySelectorAll(selector: string): unknown[] } }).document;
      const absolute = (value: string | null | undefined) => {
        if (!value || value.startsWith("data:") || value.startsWith("blob:")) return "";
        try { return new URL(value, w.location.href).toString(); } catch { return ""; }
      };
      const visible = (rect: { width: number; height: number; bottom: number; top: number }) => rect.width >= 80 && rect.height >= 40 && rect.bottom > 0 && rect.top < 2200;
      const imageCandidates: WebsiteImageCandidate[] = [];
      const logoCandidates: WebsiteImageCandidate[] = [];
      const add = (list: WebsiteImageCandidate[], item: WebsiteImageCandidate) => {
        if (item.url && !list.some((existing) => existing.url === item.url)) list.push(item);
      };
      d.querySelectorAll("img").forEach((node) => {
        const img = node as {
          getBoundingClientRect(): { width: number; height: number; bottom: number; top: number };
          currentSrc?: string;
          src?: string;
          id?: string;
          className?: string;
          getAttribute(name: string): string | null;
        };
        const rect = img.getBoundingClientRect();
        const url = absolute(img.currentSrc || img.src);
        if (!url || !visible(rect)) return;
        const alt = img.getAttribute("alt") || "";
        const signal = `${alt} ${img.id} ${img.className} ${url}`.toLowerCase();
        if (rect.top < 220 && (signal.includes("logo") || rect.width <= 360)) {
          add(logoCandidates, { url, alt, sourcePage: w.location.href, reason: "rendered header logo" });
        }
        if (rect.width >= 260 && rect.height >= 150) {
          add(imageCandidates, { url, alt, sourcePage: w.location.href, reason: rect.top < 850 ? "rendered hero image" : "rendered brand image" });
        }
      });
      d.querySelectorAll("header, nav, main, section, div, a").forEach((node) => {
        const el = node as {
          getBoundingClientRect(): { width: number; height: number; bottom: number; top: number };
          getAttribute(name: string): string | null;
        };
        const rect = el.getBoundingClientRect();
        if (rect.width < 280 || rect.height < 150 || rect.top > 1800 || rect.bottom < 0) return;
        const bg = w.getComputedStyle(el).backgroundImage;
        const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
        const url = absolute(match?.[1]);
        if (url) add(imageCandidates, { url, alt: el.getAttribute("aria-label") || "", sourcePage: w.location.href, reason: rect.top < 850 ? "rendered hero background" : "rendered section background" });
      });
      return {
        imageCandidates: imageCandidates.slice(0, 10),
        logoCandidates: logoCandidates.slice(0, 4),
      };
    });
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    const colors = await extractScreenshotColors(screenshot);
    return {
      screenshotCaptured: true,
      screenshotNote: "Palette detected from rendered screenshot at 1440px desktop width.",
      colors,
      imageCandidates: rendered.imageCandidates,
      logoCandidates: rendered.logoCandidates,
    };
  } catch (err) {
    warnings.push(`Rendered screenshot analysis failed; using HTML/CSS fallback. ${safeErrorMessage(err)}`);
    return null;
  } finally {
    await browser?.close().catch(() => null);
  }
}

async function crawlWebsite(startUrl: URL): Promise<WebsiteExtraction> {
  const warnings: string[] = [];
  const pages: WebsitePageSnapshot[] = [];
  let first = await fetchHtml(startUrl, 10000, true);
  if (first.warning || !first.html) {
    if (first.warning) warnings.push(first.warning);
    logger.warn({
      url: startUrl.toString(),
      stage: "homepage_fetch_failed",
      attempt: first.attempt,
      status: first.status,
      failureType: first.failureType,
      warning: first.warning,
    }, "Brand importer homepage fetch failed; trying Playwright rendered HTML fallback");
    const renderedHtml = await fetchRenderedHtml(startUrl);
    if (renderedHtml.warning) warnings.push(renderedHtml.warning);
    if (renderedHtml.html) {
      first = renderedHtml;
      warnings.push("Homepage HTML was read using rendered browser fallback because backend fetch was blocked or timed out.");
    } else {
      throw new Error(
        [
          "Website could not be fetched from the local backend. It may be blocking server requests. Try again or paste a specific page URL.",
          `Last attempt: ${renderedHtml.attempt ?? first.attempt ?? "unknown"}.`,
          `Failure: ${renderedHtml.failureType ?? first.failureType ?? "unknown"}.`,
          first.status ? `HTTP status: ${first.status}.` : "",
        ].filter(Boolean).join(" ")
      );
    }
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
  const rendered = await captureRenderedWebsite(homeUrl, warnings);
  rendered?.logoCandidates.forEach((candidate) => addImageCandidate(logoCandidates, candidate));
  rendered?.imageCandidates.forEach((candidate) => addImageCandidate(imageCandidates, candidate));
  for (const page of pages) {
    const extracted = extractImagesFromHtml(page.html, new URL(page.url), "");
    extracted.logoCandidates.forEach((candidate) => addImageCandidate(logoCandidates, candidate));
    extracted.imageCandidates.forEach((candidate) => addImageCandidate(imageCandidates, candidate));
  }

  const cssUrls = [...new Set(pages.flatMap((page) => extractStylesheetUrls(page.html, new URL(page.url))))];
  const { cssText, fetched } = await fetchCss(cssUrls, warnings);
  const logoColorText = await fetchLogoColorText(logoCandidates, warnings);
  const inlineCss = pages.map((page) => page.html).join("\n");
  const cssColors = extractColors(`${logoColorText}\n${inlineCss}\n${cssText}`);
  const visibleColors = rendered?.colors ?? [];
  const colors = visibleColors.length ? visibleColors : cssColors;
  const fontFamilies = extractFontFamilies(`${inlineCss}\n${cssText}`);
  const validLogoCandidates = await validateImageCandidates(logoCandidates, 5, warnings, "logo");
  const validImageCandidates = await validateImageCandidates(imageCandidates, 8, warnings, "image");

  if (fetched === 0 && cssUrls.length) warnings.push("Stylesheets could not be read; colors may be inferred from inline page styles only.");
  if (!validLogoCandidates.length && !logoCandidates.length) warnings.push("No clear logo candidate was found.");
  if (!colors.length) warnings.push("No strong CSS color palette was found.");
  if (colors.length < 3) warnings.push("Color confidence is limited; only a partial palette could be detected.");

  return {
    pages,
    warnings,
    logoCandidates: validLogoCandidates,
    imageCandidates: validImageCandidates,
    colors,
    visibleColors,
    cssColors,
    fontFamilies,
    cssFetched: fetched,
    rendered: rendered ?? undefined,
  };
}

function extractDirectContacts(pages: WebsitePageSnapshot[]): DirectContactData {
  const allHtml = pages.map((p) => p.html).join("\n");

  let phone = "";
  const telMatch = allHtml.match(/href=["']tel:([+\d\s\-().]{6,20})["']/i);
  if (telMatch) phone = telMatch[1].trim();

  let email = "";
  const emailMatch = allHtml.match(/href=["']mailto:([^\s"'>@]{1,64}@[^\s"'>]{1,64}\.[a-z]{2,8})["']/i);
  if (emailMatch) {
    const found = emailMatch[1].toLowerCase().trim();
    if (!/privacy|noreply|no-reply|donotreply|unsubscribe/i.test(found)) email = found;
  }

  let whatsappNumber = "";
  let whatsappLink = "";
  const waMatch = allHtml.match(/href=["'](https?:\/\/wa\.me\/(\d+)[^"']*)["']/i);
  if (waMatch) {
    whatsappLink = `https://wa.me/${waMatch[2]}`;
    whatsappNumber = `+${waMatch[2]}`;
  }

  let address = "";
  let city = "";
  let country = "";
  for (const match of allHtml.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? "");
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (typeof entry !== "object" || !entry) continue;
        const e = entry as Record<string, unknown>;
        const addrRaw = e["address"];
        if (!addrRaw || typeof addrRaw !== "object") continue;
        const addr = addrRaw as Record<string, unknown>;
        const parts = [addr["streetAddress"], addr["addressLocality"], addr["addressRegion"], addr["postalCode"]]
          .filter((v): v is string => typeof v === "string" && v.length > 0);
        if (parts.length) {
          address = parts.join(", ");
          city = typeof addr["addressLocality"] === "string" ? addr["addressLocality"] : "";
          country = typeof addr["addressCountry"] === "string" ? addr["addressCountry"] : "";
          break;
        }
      }
      if (address) break;
    } catch {
      // malformed JSON-LD — skip
    }
  }

  return { phone, email, whatsappNumber, whatsappLink, address, city, country };
}

function emptyAnalysis(): BrandWebsiteAnalysis {
  return {
    brandName: "",
    brandTone: "",
    targetAudience: "",
    productsServices: "",
    usp: "",
    contentPillars: "",
    colorStyleHints: "",
    keywords: "",
    seoKeywords: "",
    defaultHashtags: "",
    primaryCTA: "",
    secondaryCTA: "",
    preferredPlatforms: "",
    serviceAreas: "",
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

function firstMeaningfulLine(text: string): string {
  return text
    .split(/[.\n]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line.length > 28 && line.length < 240) ?? "";
}

function buildExtractionFallbackAnalysis(extraction: WebsiteExtraction, url: URL, warning: string): BrandWebsiteAnalysis {
  const text = extraction.pages.map((page) => page.text).join("\n").slice(0, 8000);
  const title = extraction.pages.find((page) => page.title)?.title || url.hostname.replace(/^www\./, "");
  const metaLine = firstMeaningfulLine(text);
  const palette = extraction.colors.slice(0, 3).map((color) => color.hex).join(", ");
  const imageNotes = extraction.imageCandidates
    .slice(0, 4)
    .map((image) => image.alt || image.reason)
    .filter(Boolean)
    .join(", ");

  return {
    brandName: title,
    brandTone: "Use the website copy as directional tone; AI extraction was unavailable.",
    targetAudience: metaLine || "Not clear from the page",
    productsServices: title,
    usp: metaLine || "Not clear from the page",
    contentPillars: "Product/service highlights, brand story, customer education, seasonal campaigns",
    colorStyleHints: palette || "Not clear from the page",
    keywords: text.match(/\b[A-Za-z][A-Za-z -]{3,24}\b/g)?.slice(0, 12).join(", ") || "Not clear from the page",
    seoKeywords: "",
    defaultHashtags: "",
    primaryCTA: "",
    secondaryCTA: "",
    preferredPlatforms: "",
    serviceAreas: "",
    visualStyle: [palette ? `Palette: ${palette}` : "", imageNotes ? `Images: ${imageNotes}` : ""].filter(Boolean).join(" | ") || "Not clear from the page",
    imageStyle: imageNotes || "Not clear from the page",
    fontStyle: extraction.fontFamilies.join(", ") || "Not clear from the page",
    designNotes: [palette ? `Use detected colors: ${palette}.` : "", extraction.rendered?.screenshotNote || ""].filter(Boolean).join(" "),
    imageStyleNotes: imageNotes || "Use website imagery as reference; image extraction was partial.",
    confidenceNotes: `${warning} These suggestions are based on website text/assets only and should be reviewed before saving.`,
  };
}

function buildManualFallbackAnalysis(params: {
  text: string;
  colors: WebsiteColorCandidate[];
  warning?: string;
}): BrandWebsiteAnalysis {
  const palette = params.colors.slice(0, 3).map((color) => color.hex).join(", ");
  const firstLine = firstMeaningfulLine(params.text);
  return {
    brandName: "",
    brandTone: firstLine ? "Derived from pasted website text." : "Not clear from the page",
    targetAudience: firstLine || "Not clear from the page",
    productsServices: firstLine || "Not clear from the page",
    usp: firstLine || "Not clear from the page",
    contentPillars: "Product/service highlights, brand story, customer education, seasonal campaigns",
    colorStyleHints: palette || "Not clear from the page",
    keywords: params.text.match(/\b[A-Za-z][A-Za-z -]{3,24}\b/g)?.slice(0, 12).join(", ") || "Not clear from the page",
    seoKeywords: "",
    defaultHashtags: "",
    primaryCTA: "",
    secondaryCTA: "",
    preferredPlatforms: "",
    serviceAreas: "",
    visualStyle: palette ? `Visible screenshot palette: ${palette}` : "Not clear from the page",
    imageStyle: params.colors.length ? "Use uploaded homepage screenshot as the visual reference." : "Not clear from the page",
    fontStyle: "Not clear from the page",
    designNotes: palette ? `Use detected colors: ${palette}.` : "Review manually; no screenshot palette was detected.",
    imageStyleNotes: params.colors.length ? "Base artwork direction on the uploaded homepage screenshot." : "Not clear from the page",
    confidenceNotes: params.warning || "Fallback suggestions are based on user-provided text and/or screenshot only.",
  };
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value.trim() : "";
}

function appendLines(existing: unknown, lines: string[]): string {
  const parts = [stringValue(existing), ...lines.map((line) => line.trim()).filter(Boolean)];
  return Array.from(new Set(parts.filter(Boolean))).join("\n");
}

function normalizeBrandDnaBody(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw };
  const colors = raw.colors;

  if (!normalized.voiceTone) normalized.voiceTone = raw.tone || raw.language || raw.brandTone;
  if (!normalized.contentThemes) normalized.contentThemes = raw.contentPillars;
  if (!normalized.industry) normalized.industry = raw.productsServices;
  if (!normalized.brandValues) normalized.brandValues = raw.usp;
  if (!normalized.visualStyle) normalized.visualStyle = raw.imageStyle || raw.colorStyleHints;

  if (colors && typeof colors === "object") {
    const colorRecord = colors as Record<string, unknown>;
    if (!normalized.primaryColor) normalized.primaryColor = colorRecord.primary || colorRecord.primaryColor;
    if (!normalized.secondaryColor) normalized.secondaryColor = colorRecord.secondary || colorRecord.secondaryColor;
    if (!normalized.accentColor) normalized.accentColor = colorRecord.accent || colorRecord.accentColor;
  } else if (Array.isArray(colors)) {
    if (!normalized.primaryColor) normalized.primaryColor = colors[0];
    if (!normalized.secondaryColor) normalized.secondaryColor = colors[1];
    if (!normalized.accentColor) normalized.accentColor = colors[2];
  }

  normalized.designNotes = appendLines(normalized.designNotes, [
    raw.imageStyle ? `Image style: ${stringValue(raw.imageStyle)}` : "",
    raw.designNotes ? stringValue(raw.designNotes) : "",
  ]);
  normalized.additionalContext = appendLines(normalized.additionalContext, [
    raw.productsServices ? `Products/services: ${stringValue(raw.productsServices)}` : "",
    raw.usp ? `USP: ${stringValue(raw.usp)}` : "",
    raw.keywords ? `Keywords: ${stringValue(raw.keywords)}` : "",
    raw.platforms ? `Platforms: ${stringValue(raw.platforms)}` : "",
  ]);

  return normalized;
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
    const parsed = UpsertBrandDnaBody.safeParse(normalizeBrandDnaBody(req.body as Record<string, unknown>));
    if (!parsed.success) {
      res.status(400).json({
        error: "Failed to upsert Brand DNA",
        details: parsed.error.message,
      });
      return;
    }
    const body = parsed.data;
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
    logger.error({ error: safeErrorMessage(err), clientId: req.params.clientId }, "Brand DNA upsert error");
    res.status(400).json({ error: "Failed to upsert Brand DNA" });
  }
});

router.get("/brand-assets/proxy-image", async (req, res): Promise<void> => {
  try {
    const url = parseSafePublicUrl(req.query.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: IMAGE_FETCH_HEADERS,
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
      res.status(502).json({ error: "Image could not be read from the website." });
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      res.status(415).json({ error: "URL did not return an image." });
      return;
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PROXY_IMAGE_BYTES) {
      res.status(413).json({ error: "Image is too large to preview safely." });
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_PROXY_IMAGE_BYTES) {
      res.status(413).json({ error: "Image is too large to preview safely." });
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch {
    res.status(400).json({ error: "Could not preview this image URL." });
  }
});

router.post("/clients/:clientId/brand-dna/analyze-website", requireClientRole(EDIT_CONTENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  let stage = "start";
  let normalizedUrl = "";
  try {
    stage = "url_normalization";
    const url = normalizeWebsiteUrl((req.body as { websiteUrl?: string }).websiteUrl);
    normalizedUrl = url.toString();
    logger.info({ clientId: req.params.clientId, stage, url: normalizedUrl }, "Brand importer step");

    stage = "website_fetch_and_extraction";
    const extraction = await crawlWebsite(url);
    logger.info({
      clientId: req.params.clientId,
      stage,
      url: normalizedUrl,
      pages: extraction.pages.length,
      screenshotCaptured: extraction.rendered?.screenshotCaptured ?? false,
      logoCandidates: extraction.logoCandidates.length,
      imageCandidates: extraction.imageCandidates.length,
      colors: extraction.colors.length,
      cssFetched: extraction.cssFetched,
      warnings: extraction.warnings.length,
    }, "Brand importer step");

    stage = "website_text_prepare";
    const websiteText = extraction.pages.map((page) => `PAGE: ${page.title || page.url}\nURL: ${page.url}\n${page.text}`).join("\n\n---\n\n").slice(0, 30000);
    if (websiteText.length < 120) {
      logger.warn({ clientId: req.params.clientId, stage, url: normalizedUrl, textLength: websiteText.length }, "Brand importer readable text too short");
      res.status(422).json({
        error: "Website fetch succeeded, but the page did not contain enough readable text to analyze.",
        warnings: extraction.warnings,
      });
      return;
    }

    stage = "ai_provider_resolve";
    const settings = await getUserSettings(req.userId);
    const { provider, model } = await resolveProviderAndModel(settings, req.userId);
    logger.info({ clientId: req.params.clientId, stage, provider, model }, "Brand importer step");

    stage = "ai_prompt_build";
    const prompt = `You are a senior brand strategist for an AI digital agency. Extract Brand Setup suggestions from the website text below.

Return ONLY valid JSON with this shape:
{
  "brandName": "the brand or business name",
  "brandTone": "short tone description",
  "targetAudience": "who the brand appears to serve",
  "productsServices": "main products or services",
  "usp": "differentiator or promise",
  "contentPillars": "comma-separated content pillar suggestions",
  "colorStyleHints": "visual/color/style hints detectable from copy",
  "keywords": "comma-separated general keyword ideas",
  "seoKeywords": "comma-separated SEO keyword phrases (2-4 words each, as found or inferred from page headings and copy)",
  "defaultHashtags": "comma-separated hashtag suggestions without # symbol",
  "primaryCTA": "the main call-to-action phrase used on the site (e.g. 'Book a Free Consultation')",
  "secondaryCTA": "a secondary call-to-action if present (e.g. 'View Our Portfolio')",
  "preferredPlatforms": "comma-separated social platforms mentioned or implied (e.g. Instagram, Facebook)",
  "serviceAreas": "geographic service areas if mentioned (cities, regions, or 'Not clear from the page')",
  "visualStyle": "overall visual identity in plain language",
  "imageStyle": "image/art direction notes from image alt text and page copy",
  "fontStyle": "font style notes from detected fonts and headings",
  "designNotes": "practical design guidance for future artwork",
  "imageStyleNotes": "image/art direction notes for future AI artwork",
  "confidenceNotes": "what is inferred vs clearly stated"
}

CRITICAL RULES:
- Do NOT include phone numbers, email addresses, or WhatsApp numbers in any field — those are extracted separately from HTML links and must never be invented.
- If something is not detectable, use "Not clear from the page" rather than inventing.
- Never fabricate contact details, URLs, or specific claims not present in the text.

Website URL: ${url.toString()}
Pages analyzed: ${extraction.pages.map((page) => page.url).join(", ")}
Detected colors: ${extraction.colors.map((color) => `${color.hex} (${color.count})`).join(", ") || "None"}
Visible screenshot colors: ${extraction.visibleColors.map((color) => color.hex).join(", ") || "Screenshot unavailable"}
CSS fallback colors: ${extraction.cssColors.map((color) => color.hex).join(", ") || "None"}
Detected fonts: ${extraction.fontFamilies.join(", ") || "None"}
Logo candidates: ${extraction.logoCandidates.map((image) => image.url).join(", ") || "None"}
Image candidates: ${extraction.imageCandidates.slice(0, 4).map((image) => `${image.url} (${image.alt || image.reason})`).join(", ") || "None"}
Website text:
${websiteText}`;

    let analysis: BrandWebsiteAnalysis;
    try {
      stage = "ai_generation";
      logger.info({ clientId: req.params.clientId, stage, provider, model }, "Brand importer step");
      const responseText = await generateTextWithProvider(provider, model, prompt, 1200, req.userId);
      logger.info({ clientId: req.params.clientId, stage: "ai_generation_success", provider, model, responseLength: responseText.length }, "Brand importer step");

      stage = "ai_response_parse";
      analysis = parseAnalysisResponse(responseText);
      logger.info({ clientId: req.params.clientId, stage: "ai_response_parse_success" }, "Brand importer step");
    } catch (err) {
      const isParseFailure = stage === "ai_response_parse";
      const aiError = isParseFailure
        ? "AI response parse failed. Showing website extraction fallback."
        : `${toAiErrorResponse(err, "AI provider failed.").message} Showing website extraction fallback.`;
      extraction.warnings.push(aiError);
      logger.warn({
        clientId: req.params.clientId,
        stage,
        provider,
        model,
        error: safeErrorMessage(err),
        fallbackUsed: true,
      }, "Brand importer AI step failed; using extraction fallback");
      await createClientNotification({
        clientId: req.params.clientId,
        userId: req.userId,
        type: "brand_importer_fallback",
        title: "Brand Importer used fallback",
        message: aiError,
        severity: "warning",
        metadata: { websiteUrl: url.toString(), stage },
      });
      analysis = buildExtractionFallbackAnalysis(extraction, url, aiError);
    }

    stage = "response_prepare";
    const palette = extraction.colors.slice(0, 3).map((color) => color.hex);
    if (!analysis.colorStyleHints && palette.length) analysis.colorStyleHints = palette.join(", ");
    if (!analysis.fontStyle && extraction.fontFamilies.length) analysis.fontStyle = extraction.fontFamilies.join(", ");
    if (!analysis.imageStyleNotes && analysis.imageStyle) analysis.imageStyleNotes = analysis.imageStyle;
    const contactData = extractDirectContacts(extraction.pages);
    logger.info({ clientId: req.params.clientId, stage: "final_response_success", url: normalizedUrl, warnings: extraction.warnings.length }, "Brand importer step");
    res.json({
      websiteUrl: url.toString(),
      finalUrl: extraction.pages[0]?.url ?? url.toString(),
      analysis,
      contactData,
      pagesAnalyzed: extraction.pages.map((page) => ({ url: page.url, title: page.title })),
      logoCandidates: extraction.logoCandidates,
      imageCandidates: extraction.imageCandidates,
      colors: extraction.colors,
      visibleColors: extraction.visibleColors,
      cssColors: extraction.cssColors,
      palette: {
        primary: palette[0] ?? "",
        secondary: palette[1] ?? "",
        accent: palette[2] ?? "",
      },
      visualExtraction: {
        screenshotCaptured: extraction.rendered?.screenshotCaptured ?? false,
        note: extraction.rendered?.screenshotNote ?? "HTML/CSS fallback used because rendered screenshot analysis was unavailable.",
      },
      fontFamilies: extraction.fontFamilies,
      warnings: extraction.warnings,
      cssFetched: extraction.cssFetched,
    });
  } catch (err) {
    if (stage === "url_normalization" && err instanceof Error) {
      logger.warn({ clientId: req.params.clientId, stage, url: normalizedUrl, error: safeErrorMessage(err) }, "Brand importer URL validation failed");
      res.status(400).json({ error: err.message });
      return;
    }
    const fetchFailed = stage === "website_fetch_and_extraction";
    const { status, message } = fetchFailed
      ? { status: 422, message: "Website could not be fetched from the local backend. It may be blocking server requests. Try again or paste a specific page URL." }
      : toAiErrorResponse(err, `Brand importer failed during ${stage}.`);
    logger.error({ clientId: req.params.clientId, stage, url: normalizedUrl, error: safeErrorMessage(err) }, "Website brand analysis error");
    res.status(status).json({ error: message, stage });
  }
});

router.post(
  "/clients/:clientId/brand-dna/analyze-fallback",
  requireClientRole(EDIT_CONTENT_ROLES),
  upload.single("screenshot"),
  async (req: AuthRequest, res): Promise<void> => {
    const warnings: string[] = [];
    const uploaded = (req as AuthRequest & { file?: UploadedFile }).file;
    const pastedText = typeof req.body?.websiteText === "string" ? req.body.websiteText.trim() : "";
    const sourceUrl = typeof req.body?.websiteUrl === "string" && req.body.websiteUrl.trim()
      ? req.body.websiteUrl.trim()
      : "manual fallback";

    try {
      if (!uploaded && pastedText.length < 30) {
        res.status(400).json({ error: "Upload a homepage screenshot or paste at least a few sentences of website text." });
        return;
      }

      let colors: WebsiteColorCandidate[] = [];
      if (uploaded) {
        if (!uploaded.mimetype.toLowerCase().startsWith("image/")) {
          res.status(415).json({ error: "Screenshot must be an image file." });
          return;
        }
        try {
          colors = await extractScreenshotColors(uploaded.buffer);
        } catch (err) {
          warnings.push("Screenshot palette extraction failed. Text analysis can still be used.");
          logger.warn({ clientId: req.params.clientId, error: safeErrorMessage(err) }, "Brand fallback screenshot palette extraction failed");
        }
      }

      let analysis = buildManualFallbackAnalysis({
        text: pastedText,
        colors,
        warning: "Website blocked server-side reading, so this analysis used the uploaded screenshot and/or pasted website text.",
      });

      if (pastedText.length >= 30) {
        try {
          const settings = await getUserSettings(req.userId);
          const { provider, model } = await resolveProviderAndModel(settings, req.userId);
          logger.info({ clientId: req.params.clientId, stage: "fallback_ai_generation", provider, model, hasScreenshot: !!uploaded, textLength: pastedText.length }, "Brand importer fallback step");
          const prompt = `You are a senior brand strategist. Extract Brand Setup suggestions from user-provided website text and screenshot palette.

Return ONLY valid JSON with this shape:
{
  "brandTone": "short tone description",
  "targetAudience": "who the brand appears to serve",
  "productsServices": "main products or services",
  "usp": "differentiator or promise",
  "contentPillars": "comma-separated content pillar suggestions",
  "colorStyleHints": "visual/color/style hints",
  "keywords": "comma-separated keyword ideas",
  "visualStyle": "overall visual identity in plain language",
  "imageStyle": "image/art direction notes",
  "fontStyle": "font style notes if detectable",
  "designNotes": "practical design guidance for future artwork",
  "imageStyleNotes": "image/art direction notes for future AI artwork",
  "confidenceNotes": "what is inferred vs clearly stated"
}

If something is not detectable, say "Not clear from the page" rather than inventing.

Source URL: ${sourceUrl}
Detected screenshot colors: ${colors.map((color) => `${color.hex} (${color.count})`).join(", ") || "No screenshot colors provided"}
Website text:
${pastedText.slice(0, 16000)}`;
          const responseText = await generateTextWithProvider(provider, model, prompt, 1200, req.userId);
          analysis = { ...analysis, ...parseAnalysisResponse(responseText) };
        } catch (err) {
          const message = `${toAiErrorResponse(err, "AI provider failed.").message} Showing screenshot/text extraction fallback.`;
          warnings.push(message);
          await createClientNotification({
            clientId: req.params.clientId,
            userId: req.userId,
            type: "brand_importer_fallback",
            title: "Brand Importer fallback used",
            message,
            severity: "warning",
            metadata: { sourceUrl, mode: "manual_fallback" },
          });
          logger.warn({ clientId: req.params.clientId, error: safeErrorMessage(err) }, "Brand fallback AI analysis failed");
        }
      } else if (uploaded) {
        warnings.push("No website text was pasted, so fallback suggestions are based on screenshot palette only.");
      }

      const palette = colors.slice(0, 3).map((color) => color.hex);
      if (!analysis.colorStyleHints && palette.length) analysis.colorStyleHints = palette.join(", ");
      if (!analysis.designNotes && palette.length) analysis.designNotes = `Use detected colors: ${palette.join(", ")}.`;
      if (!analysis.imageStyleNotes && uploaded) analysis.imageStyleNotes = "Use uploaded homepage screenshot as the visual reference.";

      res.json({
        websiteUrl: sourceUrl,
        finalUrl: sourceUrl,
        analysis,
        pagesAnalyzed: pastedText ? [{ url: sourceUrl, title: "Pasted website text" }] : [],
        logoCandidates: [],
        imageCandidates: [],
        colors,
        visibleColors: colors,
        cssColors: [],
        palette: {
          primary: palette[0] ?? "",
          secondary: palette[1] ?? "",
          accent: palette[2] ?? "",
        },
        visualExtraction: {
          screenshotCaptured: !!uploaded,
          note: uploaded
            ? "Palette detected from uploaded homepage screenshot."
            : "No screenshot uploaded; visual palette was not detected.",
        },
        fontFamilies: [],
        warnings,
        cssFetched: 0,
      });
    } catch (err) {
      logger.error({ clientId: req.params.clientId, error: safeErrorMessage(err) }, "Brand fallback analysis error");
      res.status(500).json({ error: "Fallback analysis failed. Try a smaller screenshot or paste website text manually." });
    }
  }
);

export default router;
