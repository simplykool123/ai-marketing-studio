// Phase 50 — small renderer/hint components used by Drafts, Calendar, Queue
// to surface the omnichannel format matrix without touching the giant page
// files. Each component is a pure read of the post + format matrix.

import { Badge } from "@/components/ui/badge";
import {
  Instagram, Facebook, Linkedin, Twitter, Youtube, BookOpen, Mail,
  MessageCircleMore, MapPin, Globe, Megaphone, AlertCircle, CheckCircle2,
} from "lucide-react";
import { getFormat, publishLabel, type FormatDef } from "@/lib/format-matrix";

const PLATFORM_ICON: Record<string, typeof Instagram> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  twitter: Twitter,
  youtube: Youtube,
  blog: BookOpen,
  newsletter: Mail,
  whatsapp: MessageCircleMore,
  google_business: MapPin,
  website: Globe,
  ad: Megaphone,
};

export function PlatformIcon({ platform, className = "w-3.5 h-3.5" }: { platform?: string | null; className?: string }) {
  const Icon = (platform && PLATFORM_ICON[platform]) || Globe;
  return <Icon className={className} />;
}

// Compact badge that shows the format label + platform icon + publish mode.
// Designed to slot into the existing Drafts card header without restructuring.
export function FormatBadge({ contentType, platform }: { contentType?: string | null; platform?: string | null }) {
  const format: FormatDef | null = getFormat(contentType);
  const usedPlatform = platform ?? format?.platform ?? "";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] rounded-full border bg-muted/30 px-2 py-0.5">
      <PlatformIcon platform={usedPlatform} className="w-3 h-3 text-muted-foreground" />
      <span className="font-medium text-foreground">{format?.label ?? contentType ?? "Post"}</span>
      {format?.aspect && <span className="text-muted-foreground">· {format.aspect}</span>}
    </span>
  );
}

// "How does this publish" hint — used in Drafts editor and Queue rows so the
// user is never surprised by export-only formats.
export function PublishModeHint({ contentType }: { contentType?: string | null }) {
  const format = getFormat(contentType);
  if (!format) return null;
  const label = publishLabel(contentType);
  if (format.publish === "export_only") {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
        Export / manual only
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
      {label} (when account connected)
    </Badge>
  );
}

// Empty-state card: "no Brand DNA" / "no AI key" / "no image provider" /
// "no blog connection" / "no social account" / "no GBP" / "no Drive".
// Importable everywhere — pages choose which to show.
export function SetupEmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  severity = "info",
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  severity?: "info" | "warn" | "ok";
}) {
  const palette =
    severity === "warn"
      ? "border-amber-200 bg-amber-50/60 text-amber-900"
      : severity === "ok"
        ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
        : "border-sky-200 bg-sky-50/60 text-sky-900";
  const Icon = severity === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <div className={`rounded-md border ${palette} p-3 text-xs`}>
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 opacity-90">{description}</p>
          {actionLabel && actionHref && (
            <a href={actionHref} className="inline-block mt-2 underline decoration-dotted text-xs font-medium">
              {actionLabel} →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Hover-tooltip helper that's a plain title attribute under the hood —
// keeps Drafts.tsx untouched (no portal/popper required).
export function HelpHint({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <span title={hint} className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
      {children}
    </span>
  );
}
