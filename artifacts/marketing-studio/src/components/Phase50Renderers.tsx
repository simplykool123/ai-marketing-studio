// Phase 50 — Review renderers for new content types.
// Drop-in components that Drafts.tsx switches to via `reviewRendererFor(post.contentType)`.
// Each renderer is read-only display + edit hooks; the existing
// Drafts.tsx card chrome (approve / reject / schedule buttons) wraps them.

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Copy, Download, AlertCircle, MapPin, MessageCircleMore } from "lucide-react";
import { useState } from "react";

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

type RendererPost = {
  id: string;
  contentType?: string | null;
  topic?: string | null;
  caption?: string | null;
  hashtags?: string | null;
  longFormBody?: string | null;
  selectedImageUrl?: string | null;
  contentSchema?: unknown;
};

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 text-xs ${className}`}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" /> : <Copy className="w-3 h-3 mr-1" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// WhatsApp Status renderer
// ──────────────────────────────────────────────────────────────────────────
export function WhatsAppStatusRenderer({ post }: { post: RendererPost }) {
  const schema = asRecord(post.contentSchema);
  const onImageText = String(schema.onImageText ?? "");
  const broadcastCopy = String(schema.broadcastCopy ?? "");
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageCircleMore className="w-3.5 h-3.5" />
          <span>9:16 · 1080x1920 · Export only (WhatsApp has no public Status API)</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">On-image text</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-semibold">{onImageText || "—"}</div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Share caption</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{post.caption || "—"}</div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Broadcast / DM copy</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{broadcastCopy || "—"}</div>
        </div>
        <div className="flex gap-2">
          <CopyButton text={[onImageText, post.caption, broadcastCopy].filter(Boolean).join("\n\n")} />
          {post.selectedImageUrl && (
            <a href={post.selectedImageUrl} download className="inline-flex items-center text-xs underline">
              <Download className="w-3 h-3 mr-1" /> Download image
            </a>
          )}
        </div>
        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
          After downloading the artwork, post to WhatsApp Status manually.
        </Badge>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Google Business Profile renderer
// ──────────────────────────────────────────────────────────────────────────
export function GbpPostRenderer({ post, gbpConnected = false }: { post: RendererPost; gbpConnected?: boolean }) {
  const schema = asRecord(post.contentSchema);
  const action = String(schema.actionButton ?? "LEARN_MORE");
  const actionUrl = String(schema.actionUrl ?? "");
  const captionLen = (post.caption ?? "").length;
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          <span>Google Business Profile · {captionLen}/1500 chars</span>
          {!gbpConnected && (
            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
              GBP not connected — export / manual
            </Badge>
          )}
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{post.caption || "—"}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Action button</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">{action}</div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Action URL</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">{actionUrl || "—"}</div>
          </div>
        </div>
        {(schema.offerTitle || schema.eventTitle) && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs space-y-1">
            {schema.offerTitle && <div><strong>Offer:</strong> {String(schema.offerTitle)}</div>}
            {schema.eventTitle && <div><strong>Event:</strong> {String(schema.eventTitle)} ({String(schema.eventStart ?? "?")} → {String(schema.eventEnd ?? "?")})</div>}
          </div>
        )}
        <div className="flex gap-2">
          <CopyButton text={post.caption ?? ""} />
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Newsletter snippet renderer
// ──────────────────────────────────────────────────────────────────────────
export function NewsletterSnippetRenderer({ post }: { post: RendererPost }) {
  const schema = asRecord(post.contentSchema);
  const subject = String(schema.subject ?? post.topic ?? "");
  const preheader = String(schema.preheader ?? "");
  const body = post.longFormBody ?? post.caption ?? "";
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="text-xs text-muted-foreground">Newsletter / email snippet · export-only</div>
        <div className="space-y-1.5">
          <Label className="text-xs">Subject line</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-semibold">{subject || "—"}</div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Preheader</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{preheader || "—"}</div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Body</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{body || "—"}</div>
        </div>
        <CopyButton text={`Subject: ${subject}\nPreheader: ${preheader}\n\n${body}`} />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Website banner renderer
// ──────────────────────────────────────────────────────────────────────────
export function WebsiteBannerRenderer({ post }: { post: RendererPost }) {
  const schema = asRecord(post.contentSchema);
  const headline = String(schema.headline ?? post.topic ?? "");
  const subHeadline = String(schema.subHeadline ?? "");
  const ctaCopy = String(schema.ctaCopy ?? schema.cta ?? "");
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="text-xs text-muted-foreground">Website banner / hero · 1920x800 · export-only</div>
        <div className="rounded-md border bg-gradient-to-r from-slate-100 to-white px-4 py-6 text-center">
          <div className="text-2xl font-bold">{headline || "—"}</div>
          {subHeadline && <div className="text-sm text-muted-foreground mt-1">{subHeadline}</div>}
          {ctaCopy && (
            <div className="mt-3 inline-block rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium">
              {ctaCopy}
            </div>
          )}
        </div>
        <CopyButton text={`Headline: ${headline}\nSub-headline: ${subHeadline}\nCTA: ${ctaCopy}`} />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Local SEO content renderer
// ──────────────────────────────────────────────────────────────────────────
export function LocalSeoRenderer({ post }: { post: RendererPost }) {
  const schema = asRecord(post.contentSchema);
  const localKeywords = Array.isArray(schema.localKeywords) ? schema.localKeywords as string[] : [];
  const aiAnswer = String(schema.aiAnswerSummary ?? "");
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="text-xs text-muted-foreground">Local service / near-me content · export-only</div>
        <div className="space-y-1.5">
          <Label className="text-xs">Title</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-semibold">{post.topic ?? "—"}</div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Body</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{post.caption ?? "—"}</div>
        </div>
        {aiAnswer && (
          <div className="space-y-1.5">
            <Label className="text-xs">AI-answer-ready summary (for Google AI Overviews / ChatGPT / Perplexity)</Label>
            <div className="rounded-md border border-sky-200 bg-sky-50/40 px-3 py-2 text-sm whitespace-pre-wrap">{aiAnswer}</div>
          </div>
        )}
        {localKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {localKeywords.map((kw, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">{kw}</Badge>
            ))}
          </div>
        )}
        <CopyButton text={`${post.topic}\n\n${post.caption}\n\n${aiAnswer}`} />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Review request message renderer
// ──────────────────────────────────────────────────────────────────────────
export function ReviewRequestRenderer({ post }: { post: RendererPost }) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="text-xs text-muted-foreground">Review request message · WhatsApp / email · export-only</div>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{post.caption ?? "—"}</div>
        <div className="flex items-start gap-2 text-[11px] rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-700" />
          <span>Replace <code>{"{{review_link}}"}</code> with the client's real Google review link before sending.</span>
        </div>
        <CopyButton text={post.caption ?? ""} />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// FAQ pack renderer
// ──────────────────────────────────────────────────────────────────────────
export function FaqPackRenderer({ post }: { post: RendererPost }) {
  const schema = asRecord(post.contentSchema);
  const rawFaq = Array.isArray(schema.faq) ? schema.faq : Array.isArray(schema.faqs) ? schema.faqs : [];
  const faq = rawFaq as Array<{ question?: string; answer?: string; answerDirection?: string }>;
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="text-xs text-muted-foreground">FAQ pack · export-only</div>
        <div className="space-y-2">
          {faq.length === 0 ? <div className="text-sm text-muted-foreground">No FAQ entries.</div> :
            faq.map((item, i) => (
              <div key={i} className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="text-sm font-semibold">{item.question}</div>
                <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{item.answer ?? item.answerDirection}</div>
              </div>
            ))}
        </div>
        <CopyButton text={faq.map((q) => `Q: ${q.question}\nA: ${q.answer ?? q.answerDirection ?? ""}`).join("\n\n")} />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Switcher: picks the right renderer for a content type.
// Returns null if none of the new renderers apply — the caller (Drafts.tsx)
// should then fall back to its existing inline renderer.
// ──────────────────────────────────────────────────────────────────────────
export function Phase50RendererSwitch({ post, gbpConnected }: { post: RendererPost; gbpConnected?: boolean }) {
  switch (post.contentType) {
    case "whatsapp_status_image":
    case "whatsapp_status_video":
    case "festival_status":
      return <WhatsAppStatusRenderer post={post} />;
    case "gbp_post":
    case "gbp_offer":
      return <GbpPostRenderer post={post} gbpConnected={gbpConnected} />;
    case "newsletter_snippet":
      return <NewsletterSnippetRenderer post={post} />;
    case "website_banner":
      return <WebsiteBannerRenderer post={post} />;
    case "local_seo_content":
      return <LocalSeoRenderer post={post} />;
    case "review_request":
    case "whatsapp_broadcast":
      return <ReviewRequestRenderer post={post} />;
    case "faq":
    case "faq_pack":
      return <FaqPackRenderer post={post} />;
    default:
      return null;
  }
}
