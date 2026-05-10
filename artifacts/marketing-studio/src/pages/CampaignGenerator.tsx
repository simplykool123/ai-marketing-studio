import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  Flag, Sparkles, Calendar, ChevronDown, ChevronRight,
  Newspaper, Mail, Image as ImageIcon, Video, List,
  Clock, Download, ExternalLink, RefreshCw, CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocialPost {
  platform: string;
  topic: string;
  captionAngle: string;
  imagePrompt: string;
  suggestedWeek: number;
  suggestedDay: string;
}

interface BlogOutline {
  seoTitle: string;
  metaDescription: string;
  slug: string;
  sections: string[];
  faq: { q: string; a: string }[];
}

interface NewsletterOutline {
  subject: string;
  preheader: string;
  sections: string[];
}

interface ImagePrompt {
  variation: number;
  style: string;
  prompt: string;
  rationale: string;
}

interface VideoConcept {
  platform: string;
  hook: string;
  estimatedDuration: string;
  scenes: { order: number; duration: string; visual: string; text: string; voiceover: string }[];
  subtitleStyle: string;
  cta: string;
  recommendedProvider: string;
}

interface ScheduleEntry {
  week: number;
  day: string;
  date: string;
  platform: string;
  contentType: string;
  topic: string;
}

interface CampaignOutput {
  id: string;
  campaignName: string;
  brief: string | null;
  status: string;
  socialPostsJson: string | null;
  blogOutlinesJson: string | null;
  newsletterOutlinesJson: string | null;
  imagePromptsJson: string | null;
  videoConceptsJson: string | null;
  scheduleJson: string | null;
}

interface Storyline {
  id: string;
  title: string;
  isActive?: boolean;
}

interface CampaignDraft {
  id: string;
  topic: string;
  caption: string;
  platform?: string | null;
  contentType?: string | null;
  contentSchemaVersion?: number | null;
  campaignId?: string | null;
  storylineId?: string | null;
  postType?: string | null;
  status: string;
  createdAt: string;
}

interface GenerateResponse {
  output: CampaignOutput;
  campaignId: string;
  createdPostsCount: number;
  blogDraftsCount: number;
  newsletterDraftsCount: number;
  imagePromptDraftsCount: number;
  videoScriptsCount: number;
  createdDrafts: CampaignDraft[];
}

// ---------------------------------------------------------------------------
// Platform options
// ---------------------------------------------------------------------------

const PLATFORM_OPTIONS = [
  { value: "instagram",        label: "Instagram" },
  { value: "linkedin",         label: "LinkedIn" },
  { value: "facebook",         label: "Facebook" },
  { value: "twitter",          label: "X / Twitter" },
  { value: "youtube_shorts",   label: "YouTube Shorts" },
  { value: "instagram_reels",  label: "Instagram Reels" },
  { value: "tiktok",           label: "TikTok" },
  { value: "blog",             label: "Blog" },
  { value: "newsletter",       label: "Newsletter" },
];

const PLATFORM_COLORS: Record<string, string> = {
  instagram:       "bg-pink-50 text-pink-700 border-pink-200",
  linkedin:        "bg-blue-50 text-blue-700 border-blue-200",
  facebook:        "bg-indigo-50 text-indigo-700 border-indigo-200",
  twitter:         "bg-sky-50 text-sky-700 border-sky-200",
  youtube_shorts:  "bg-red-50 text-red-700 border-red-200",
  instagram_reels: "bg-purple-50 text-purple-700 border-purple-200",
  tiktok:          "bg-gray-50 text-gray-700 border-gray-200",
  blog:            "bg-emerald-50 text-emerald-700 border-emerald-200",
  newsletter:      "bg-amber-50 text-amber-700 border-amber-200",
};

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
      PLATFORM_COLORS[platform] ?? "bg-gray-50 text-gray-600 border-gray-200"
    )}>
      {platform.replace("_", " ").toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Result sections
// ---------------------------------------------------------------------------

function BriefSection({ brief }: { brief: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flag className="w-4 h-4 text-primary" /> Campaign Strategy Brief
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{brief}</p>
      </CardContent>
    </Card>
  );
}

function SocialPostsSection({ posts }: { posts: SocialPost[] }) {
  const byPlatform = posts.reduce<Record<string, SocialPost[]>>((acc, p) => {
    (acc[p.platform] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(byPlatform).map(([platform, platformPosts]) => (
        <div key={platform}>
          <div className="flex items-center gap-2 mb-2">
            <PlatformBadge platform={platform} />
            <span className="text-xs text-muted-foreground">{platformPosts.length} posts</span>
          </div>
          <div className="grid gap-2">
            {platformPosts.map((post, i) => (
              <Card key={i} className="border-l-4" style={{ borderLeftColor: "hsl(var(--primary))" }}>
                <CardContent className="py-3 px-4">
                  <p className="font-medium text-sm mb-1">{post.topic}</p>
                  <p className="text-xs text-muted-foreground mb-2 italic">"{post.captionAngle}"</p>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Week {post.suggestedWeek} · {post.suggestedDay}</span>
                  </div>
                  {post.imagePrompt && (
                    <p className="text-[10px] text-muted-foreground mt-1 border-t pt-1 line-clamp-2">
                      🖼 {post.imagePrompt}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlogSection({ outlines }: { outlines: BlogOutline[] }) {
  return (
    <div className="space-y-4">
      {outlines.map((b, i) => (
        <Card key={i}>
          <CardContent className="py-4">
            <p className="font-semibold text-sm mb-1">{b.seoTitle}</p>
            <p className="text-xs text-muted-foreground mb-3">{b.metaDescription}</p>
            <p className="text-[10px] font-mono text-muted-foreground mb-3">/{b.slug}</p>
            <div className="space-y-1 mb-3">
              {b.sections.map((s, j) => (
                <div key={j} className="text-xs flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-muted text-[9px] flex items-center justify-center font-bold">{j + 1}</span>
                  {s}
                </div>
              ))}
            </div>
            {b.faq?.length > 0 && (
              <div className="border-t pt-2">
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">FAQ ({b.faq.length} questions)</p>
                {b.faq.slice(0, 2).map((f, j) => (
                  <p key={j} className="text-xs text-muted-foreground">• {f.q}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NewsletterSection({ outlines }: { outlines: NewsletterOutline[] }) {
  return (
    <div className="space-y-3">
      {outlines.map((n, i) => (
        <Card key={i}>
          <CardContent className="py-4">
            <p className="font-semibold text-sm mb-1">{n.subject}</p>
            <p className="text-xs text-muted-foreground italic mb-3">Preview: {n.preheader}</p>
            <div className="space-y-1">
              {n.sections.map((s, j) => (
                <div key={j} className="text-xs flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-muted text-[9px] flex items-center justify-center font-bold">{j + 1}</span>
                  {s}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ImagePromptsSection({ prompts }: { prompts: ImagePrompt[] }) {
  const styleColors: Record<string, string> = {
    photorealistic:   "bg-blue-50 text-blue-700",
    illustration:     "bg-purple-50 text-purple-700",
    "bold typography": "bg-orange-50 text-orange-700",
    minimalist:       "bg-gray-50 text-gray-700",
  };
  return (
    <div className="grid gap-3">
      {prompts.map((p, i) => (
        <Card key={i}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", styleColors[p.style] ?? "bg-muted text-muted-foreground")}>
                {p.style}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{p.prompt}</p>
            <p className="text-[10px] text-muted-foreground italic border-t pt-1">{p.rationale}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function VideoSection({ concepts }: { concepts: VideoConcept[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {concepts.map((v, i) => (
        <Card key={i}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <PlatformBadge platform={v.platform} />
              <span className="text-[10px] text-muted-foreground">{v.estimatedDuration}</span>
            </div>
            <p className="text-sm font-medium mb-1">Hook: <span className="font-normal text-muted-foreground">{v.hook}</span></p>
            <p className="text-xs text-muted-foreground mb-2">CTA: {v.cta}</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Provider: <strong>{v.recommendedProvider}</strong></span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setExpanded(expanded === i ? null : i)}>
                {expanded === i ? "Hide scenes" : `${v.scenes?.length ?? 0} scenes`}
                {expanded === i ? <ChevronDown className="w-3 h-3 ml-1" /> : <ChevronRight className="w-3 h-3 ml-1" />}
              </Button>
            </div>
            {expanded === i && (
              <div className="mt-3 space-y-2 border-t pt-2">
                {v.scenes?.map((scene, j) => (
                  <div key={j} className="text-xs bg-muted/50 rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold">Scene {scene.order}</span>
                      <span className="text-muted-foreground">{scene.duration}</span>
                    </div>
                    <p className="text-muted-foreground">📷 {scene.visual}</p>
                    {scene.text && <p className="text-muted-foreground">📝 {scene.text}</p>}
                    <p className="text-muted-foreground">🎙 {scene.voiceover}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ScheduleSection({ schedule }: { schedule: ScheduleEntry[] }) {
  const byWeek = schedule.reduce<Record<number, ScheduleEntry[]>>((acc, e) => {
    (acc[e.week] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(byWeek).map(([week, entries]) => (
        <div key={week}>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Week {week}</p>
          <div className="space-y-1.5">
            {entries.map((e, i) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-dashed last:border-0">
                <span className="w-20 text-muted-foreground shrink-0">{e.date || e.day}</span>
                <PlatformBadge platform={e.platform} />
                <span className="flex-1 truncate">{e.topic}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  social_post: "Social posts",
  blog: "Blog drafts",
  newsletter: "Newsletters",
  image_prompt: "Image prompts",
  video_script: "Video scripts",
};

function CampaignDraftGrid({ drafts, clientId }: { drafts: CampaignDraft[]; clientId: string }) {
  const grouped = drafts.reduce<Record<string, CampaignDraft[]>>((acc, draft) => {
    const key = draft.contentType ?? "social_post";
    (acc[key] ??= []).push(draft);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([contentType, items]) => (
        <div key={contentType}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">{CONTENT_TYPE_LABELS[contentType] ?? contentType}</h3>
            <Badge variant="outline">{items.length}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((draft) => (
              <Card key={draft.id}>
                <CardContent className="py-3 px-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <PlatformBadge platform={draft.platform ?? "draft"} />
                    <span className="text-[10px] text-muted-foreground">v{draft.contentSchemaVersion ?? 1}</span>
                  </div>
                  <p className="text-sm font-medium line-clamp-2">{draft.topic}</p>
                  {draft.caption && (
                    <p className="text-xs text-muted-foreground line-clamp-3">{draft.caption}</p>
                  )}
                  <div className="pt-1">
                    <Link href={`/clients/${clientId}/drafts?postId=${draft.id}`}>
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <ExternalLink className="w-3 h-3 mr-1" /> Open in Drafts
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CampaignGenerator() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();

  const [form, setForm] = useState({
    campaignName: "",
    goal: "awareness",
    monthTheme: "",
    storylineId: "none",
    platforms: ["instagram", "linkedin"] as string[],
    intensity: "standard",
    qualityMode: "balanced",
    startDate: "",
    endDate: "",
  });

  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<CampaignOutput | null>(null);
  const [generatedCampaignId, setGeneratedCampaignId] = useState<string | null>(null);
  const [createdDrafts, setCreatedDrafts] = useState<CampaignDraft[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [storylines, setStorylines] = useState<Storyline[]>([]);

  useEffect(() => {
    if (!clientId) return;
    fetch(`${BASE}/api/clients/${clientId}/storylines`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("ams_token")}` },
    })
      .then(res => res.ok ? res.json() : [])
      .then(data => setStorylines(Array.isArray(data) ? data : []))
      .catch(() => setStorylines([]));
  }, [clientId]);

  function togglePlatform(p: string) {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p)
        ? f.platforms.filter(x => x !== p)
        : [...f.platforms, p],
    }));
  }

  async function generate() {
    if (!form.campaignName.trim()) {
      toast({ title: "Campaign name required", variant: "destructive" });
      return;
    }
    if (form.platforms.length === 0) {
      toast({ title: "Select at least one platform", variant: "destructive" });
      return;
    }

    setLoading(true);
    setOutput(null);
    setGeneratedCampaignId(null);
    setCreatedDrafts([]);
    setGenerationError(null);
    try {
      const payload = {
        ...form,
        storylineId: form.storylineId === "none" ? undefined : form.storylineId,
      };
      const res = await fetch(`${BASE}/api/clients/${clientId}/campaigns/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as GenerateResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      setOutput(data.output);
      setGeneratedCampaignId(data.campaignId);
      setCreatedDrafts(data.createdDrafts ?? []);
      toast({
        title: "Campaign generated",
        description: `${data.createdDrafts?.length ?? 0} approval-ready drafts created`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const friendlyMessage = message.toLowerCase().includes("ai key invalid")
        ? "AI key invalid. Go to Settings → AI Keys and update provider key."
        : message;
      setGenerationError(friendlyMessage);
      toast({
        title: "Generation failed",
        description: friendlyMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const schedule: ScheduleEntry[]          = output?.scheduleJson            ? JSON.parse(output.scheduleJson)            : [];
  const countsByType = createdDrafts.reduce<Record<string, number>>((acc, draft) => {
    const key = draft.contentType ?? "social_post";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Flag className="w-6 h-6 text-primary" /> Campaign Planner
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Generate a full campaign of draft posts, images, blogs, and ideas for Review.
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardContent className="pt-5 space-y-5">
          {/* Row 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Campaign Name</Label>
              <Input
                placeholder="e.g. Summer Launch 2025"
                value={form.campaignName}
                onChange={e => setForm(f => ({ ...f, campaignName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Theme</Label>
              <Input
                placeholder="e.g. June – Sustainability Month"
                value={form.monthTheme}
                onChange={e => setForm(f => ({ ...f, monthTheme: e.target.value }))}
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Goal</Label>
              <Select value={form.goal} onValueChange={v => setForm(f => ({ ...f, goal: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="awareness">Brand Awareness</SelectItem>
                  <SelectItem value="engagement">Engagement</SelectItem>
                  <SelectItem value="lead_generation">Lead Generation</SelectItem>
                  <SelectItem value="trust_building">Trust Building</SelectItem>
                  <SelectItem value="product_education">Product Education</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Intensity</Label>
              <Select value={form.intensity} onValueChange={v => setForm(f => ({ ...f, intensity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light (8 posts)</SelectItem>
                  <SelectItem value="standard">Standard (12 posts)</SelectItem>
                  <SelectItem value="aggressive">Aggressive (18 posts)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>AI Quality</Label>
              <Select value={form.qualityMode} onValueChange={v => setForm(f => ({ ...f, qualityMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cheap">Cheap / Fast</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="best_quality">Best Quality</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Storyline</Label>
            <Select value={form.storylineId} onValueChange={v => setForm(f => ({ ...f, storylineId: v }))}>
              <SelectTrigger><SelectValue placeholder="Use active brand memory" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Use active brand memory</SelectItem>
                {storylines.map((storyline) => (
                  <SelectItem key={storyline.id} value={storyline.id}>
                    {storyline.title}{storyline.isActive ? " (active)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>

          {/* Platforms */}
          <div className="space-y-2">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map(p => (
                <button
                  key={p.value}
                  onClick={() => togglePlatform(p.value)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    form.platforms.includes(p.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={generate} disabled={loading} className="w-full">
            {loading ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating campaign…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate campaign drafts</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {generationError && !loading && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-800">Campaign generation needs an AI key update</p>
                <p className="text-sm text-red-700">{generationError}</p>
              </div>
            </div>
            <Link href={`/clients/${clientId}/settings`}>
              <Button size="sm" variant="outline" className="border-red-300 bg-white text-red-700 hover:bg-red-100">
                Settings → AI Keys
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {output && !loading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold">{output.campaignName}</h2>
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">Ready</Badge>
          </div>

          {output.brief && <BriefSection brief={output.brief} />}

          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-sm font-semibold">Drafts ready for Review</p>
                  <p className="text-xs text-muted-foreground">
                    Saved to posts under campaign {generatedCampaignId?.slice(0, 8) ?? ""}
                  </p>
                </div>
                <Link href={`/clients/${clientId}/drafts${generatedCampaignId ? `?campaignId=${generatedCampaignId}` : ""}`}>
                  <Button size="sm">
                    <ExternalLink className="w-4 h-4 mr-2" /> Open Review
                  </Button>
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {Object.entries(CONTENT_TYPE_LABELS).map(([type, label]) => (
                  <div key={type} className="border rounded-md p-3">
                    <p className="text-lg font-semibold">{countsByType[type] ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <CampaignDraftGrid drafts={createdDrafts} clientId={clientId ?? ""} />

          {schedule.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" /> Suggested Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScheduleSection schedule={schedule} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
