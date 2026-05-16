import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  FileText,
  Lightbulb,
  Loader2,
  Radar,
  Sparkles,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Confidence = "high" | "medium" | "low";

type TrendSignal = {
  source: "google" | "youtube" | "social_memory" | "manual" | "web";
  topic: string;
  whyItMatters: string;
  confidence: Confidence;
  platformFit: string[];
  brandFit: "strong" | "moderate" | "weak";
  riskNotes: string;
};

type ContentOpportunity = {
  idea: string;
  format: "image_post" | "reel" | "carousel" | "linkedin_post" | "story" | "video";
  platform: string;
  hook: string;
  visualDirection: string;
  captionAngle: string;
  cta: string;
  whyItCouldWork: string;
  trendSource: string;
  brandFitNotes: string;
};

type TrendResearch = {
  trendSummary: string;
  trendSignals: TrendSignal[];
  contentOpportunities: ContentOpportunity[];
  nextWeekPlan: string[];
  avoidThese: string[];
  recommendedAudiosOrStyles: Array<{
    name: string;
    platform: string;
    confidence: Confidence;
    note: string;
  }>;
  sourceStatus?: Record<string, string>;
  meta?: {
    sourcesUsed?: string[];
    signalCount?: number;
  };
};

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "youtube", label: "YouTube" },
  { value: "google", label: "Google" },
];

const confidenceClass: Record<Confidence, string> = {
  high: "border-green-200 bg-green-50 text-green-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

function platformForPost(platform: string): string {
  if (platform === "x") return "twitter";
  if (platform === "google") return "linkedin";
  return ["instagram", "facebook", "linkedin", "twitter", "youtube"].includes(platform) ? platform : "instagram";
}

function firstSentence(text: string): string {
  return text.split(/[.!?]/).map((part) => part.trim()).find(Boolean) ?? text;
}

function trendIdeaParam(opportunity: ContentOpportunity): string {
  return encodeURIComponent(`${opportunity.idea}. Hook: ${opportunity.hook}. Visual: ${opportunity.visualDirection}`);
}

function opportunityFormat(format: string): "image" | "video" | "blog" {
  if (format === "reel" || format === "video") return "video";
  return "image";
}

function creativeStudioHref(clientId: string, opportunity: ContentOpportunity): string {
  const qs = new URLSearchParams({
    topic: `${opportunity.idea}. Hook: ${opportunity.hook}`,
    trendTopic: opportunity.trendSource ?? opportunity.idea,
    platform: opportunity.platform,
    format: opportunityFormat(opportunity.format),
    from: "trends",
  });
  return `/clients/${clientId}/creative-studio?${qs.toString()}`;
}

export default function TrendIntelligence() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("US");
  const [timeWindow, setTimeWindow] = useState<"today" | "this_week" | "next_week">("this_week");
  const [contentGoal, setContentGoal] = useState<"awareness" | "engagement" | "leads" | "sales">("awareness");
  const [topicHint, setTopicHint] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["instagram", "linkedin", "google"]);
  const [result, setResult] = useState<TrendResearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const socialSignals = useMemo(
    () => result?.trendSignals.filter((signal) => signal.source === "social_memory") ?? [],
    [result]
  );

  function togglePlatform(platform: string) {
    setPlatforms((current) => {
      if (current.includes(platform)) return current.filter((item) => item !== platform);
      return [...current, platform];
    });
  }

  async function researchTrends() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/trends/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, region, platforms, timeWindow, contentGoal, topicHint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Trend research failed");
      setResult(data);
      toast({ title: "Trend research ready", description: "Review brand fit before creating drafts." });
    } catch (err) {
      toast({
        title: "Trend research failed",
        description: err instanceof Error ? err.message : "Could not research trends.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveInsight(signal: TrendSignal) {
    const id = `memory-${signal.topic}`;
    setBusyId(id);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/trends/save-memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: signal.topic,
          whyItFits: signal.whyItMatters,
          avoidNotes: signal.riskNotes,
          recommendedAngle: `Adapt for ${signal.platformFit.join(", ") || "social"} with ${signal.brandFit} brand fit.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save insight");
      toast({ title: "Saved to AI Memory", description: "This trend can now inform AI Ideas, campaigns, Image Studio, and Video Studio." });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not save to AI Memory.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function createDraft(opportunity: ContentOpportunity, index: number) {
    const id = `draft-${index}`;
    setBusyId(id);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: opportunity.idea,
          caption: `${opportunity.hook}\n\n${opportunity.captionAngle}\n\n${opportunity.cta}`,
          hashtags: "",
          platform: platformForPost(opportunity.platform),
          contentType: "social_post",
          postType: "social",
          contentSchema: {
            source: "trend_intelligence",
            format: opportunity.format,
            hook: opportunity.hook,
            visualDirection: opportunity.visualDirection,
            trendSource: opportunity.trendSource,
            brandFitNotes: opportunity.brandFitNotes,
            whyItCouldWork: opportunity.whyItCouldWork,
          },
          contentSchemaVersion: 1,
          generationMetadata: {
            route: "trend_intelligence.create_draft",
            trendSource: opportunity.trendSource,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create draft");
      toast({
        title: "Draft created",
        description: "Open Review to edit, improve, and approve it.",
      });
    } catch (err) {
      toast({
        title: "Draft creation failed",
        description: err instanceof Error ? err.message : "Could not create draft.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Radar className="h-6 w-6 text-primary" />
            Trend Intelligence
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Research current public signals, historical client learning, and brand fit before turning a trend into content.
          </p>
        </div>
        <Link href={`/clients/${clientId}/brain`}>
          <Button variant="outline" className="gap-2">
            AI Ideas
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Research setup</CardTitle>
          <CardDescription>Google News RSS is used as a current web signal. Platform-native trends must be verified before publishing.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr]">
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Furniture, interior design, wellness..." />
          </div>
          <div className="space-y-1.5">
            <Label>Region</Label>
            <Input value={region} onChange={(event) => setRegion(event.target.value.toUpperCase())} placeholder="US, IN, GB" />
          </div>
          <div className="space-y-1.5">
            <Label>Topic hint</Label>
            <Input value={topicHint} onChange={(event) => setTopicHint(event.target.value)} placeholder="Optional: sofas, festive interiors, small spaces..." />
          </div>
          <div className="space-y-1.5">
            <Label>Time window</Label>
            <Select value={timeWindow} onValueChange={(value) => setTimeWindow(value as typeof timeWindow)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="this_week">This week</SelectItem>
                <SelectItem value="next_week">Next week</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Content goal</Label>
            <Select value={contentGoal} onValueChange={(value) => setContentGoal(value as typeof contentGoal)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="awareness">Awareness</SelectItem>
                <SelectItem value="engagement">Engagement</SelectItem>
                <SelectItem value="leads">Leads</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((platform) => {
                const selected = platforms.includes(platform.value);
                return (
                  <button
                    key={platform.value}
                    type="button"
                    onClick={() => togglePlatform(platform.value)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted"
                    )}
                  >
                    {platform.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="lg:col-span-3">
            <Button onClick={researchTrends} disabled={loading || platforms.length === 0} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Research trends
            </Button>
          </div>
        </CardContent>
      </Card>

      {!result ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Run research to see current signals and brand-safe content opportunities.</p>
          <p className="mt-1 text-xs text-muted-foreground">No trends are invented. Missing platform sources are shown honestly.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Trend summary</CardTitle>
                <CardDescription>{result.meta?.signalCount ?? 0} directional signals reviewed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed">{result.trendSummary}</p>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  Trending audio and meme formats change quickly. Verify inside Instagram or TikTok before publishing.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historical view</CardTitle>
                <CardDescription>From Social Intelligence and saved AI Memory when available.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {socialSignals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No saved Social Intelligence trend memory yet.</p>
                ) : socialSignals.map((signal) => (
                  <div key={`${signal.source}-${signal.topic}`} className="rounded-md border p-3">
                    <p className="text-sm font-medium">{signal.topic}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{signal.whyItMatters}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(result.sourceStatus ?? {}).map(([source, status]) => (
                  <div key={source} className="flex gap-2 text-xs">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span><span className="font-medium">{source}:</span> {status}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Current trend signals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.trendSignals.map((signal) => (
                  <div key={`${signal.source}-${signal.topic}`} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{signal.topic}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="outline">{signal.source}</Badge>
                          <Badge variant="outline" className={confidenceClass[signal.confidence]}>{signal.confidence}</Badge>
                          <Badge variant="outline">Brand fit: {signal.brandFit}</Badge>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => saveInsight(signal)} disabled={busyId === `memory-${signal.topic}`}>
                        {busyId === `memory-${signal.topic}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
                        Save
                      </Button>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{signal.whyItMatters}</p>
                    {signal.riskNotes && <p className="mt-2 text-xs text-amber-700">{signal.riskNotes}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Content opportunities</CardTitle>
                <CardDescription>Create a draft only after the idea passes brand fit.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.contentOpportunities.map((opportunity, index) => (
                  <div key={`${opportunity.idea}-${index}`} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-xl">
                        <p className="font-medium">{opportunity.idea}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{opportunity.whyItCouldWork}</p>
                      </div>
                      <Badge variant="secondary">{opportunity.platform} / {opportunity.format}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <p><span className="font-medium">Hook:</span> {opportunity.hook}</p>
                      <p><span className="font-medium">CTA:</span> {opportunity.cta}</p>
                      <p><span className="font-medium">Visual:</span> {opportunity.visualDirection}</p>
                      <p><span className="font-medium">Brand fit:</span> {opportunity.brandFitNotes}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={creativeStudioHref(clientId ?? "", opportunity)}>
                        <Button size="sm" className="gap-1.5">
                          <Wand2 className="h-3.5 w-3.5" />
                          Create in Creative Studio
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => createDraft(opportunity, index)} disabled={busyId === `draft-${index}`}>
                        {busyId === `draft-${index}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        Create text draft
                      </Button>
                      <Link href={`/clients/${clientId}/campaigns/generate?campaignName=${encodeURIComponent(`Trend: ${opportunity.idea.slice(0, 46)}`)}&theme=${encodeURIComponent(opportunity.idea)}`}>
                        <Button size="sm" variant="outline">Send to Campaign Planner</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Next week</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.nextWeekPlan.map((item) => (
                    <div key={item} className="flex gap-2 text-sm">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Avoid</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.avoidThese.map((item) => (
                    <div key={item} className="flex gap-2 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>{firstSentence(item)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
