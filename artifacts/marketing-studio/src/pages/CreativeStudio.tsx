import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles, Video, Newspaper, Zap, Image as ImageIcon, Palette,
  ArrowRight, TrendingUp, BookOpen, ChevronRight, Layers, Circle,
  Wand2, MessageSquareText, PanelsTopLeft, CheckCircle2, AlertTriangle, Loader2,
  RefreshCw, Brain, ChevronDown, ChevronUp, Target, BarChart2, AlertOctagon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Format = "social" | "carousel" | "image" | "video" | "blog" | "bulk";

type DashboardBrief = {
  hasBrandDna: boolean;
  activeStoryline: { id: string; title: string; narrative: string } | null;
  aiProviderConfigured: boolean;
};

type BrandDnaContext = {
  brandName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  industry?: string;
  voiceTone?: string;
};

type URLParams = {
  topic: string;
  platform: string;
  format: Format;
  imageUrl?: string;
  postId?: string;
};

type ActionCard = {
  id: string;
  format: Format | "assets";
  title: string;
  description: string;
  whenToUse: string;
  nextStep: string;
  icon: React.ElementType;
  colorClass: string;
  getHref: (clientId: string, p: URLParams) => string;
};

type SkillGenerateResult = {
  post?: { id: string; topic: string; caption: string; platform?: string; contentType?: string };
  metadata?: {
    skillId?: string;
    skillVersion?: string;
    provider?: string;
    model?: string;
    fallbackUsed?: boolean;
    qualityScore?: number;
    qualityBadge?: "Good" | "Needs Review" | "Weak Brand Match";
  };
  skill?: { skillId: string; displayName: string; version?: string; category?: string };
};

type SkillConnectivity = {
  status: "green" | "yellow" | "red";
  checks: Array<{
    id: string;
    label: string;
    status: "green" | "yellow" | "red";
    message: string;
  }>;
  skills: Array<{ skillId: string; displayName: string; active: boolean }>;
  providerRoute?: { provider: string; model: string; label: string } | null;
};

type MiniCampaignResult = {
  campaign?: { id: string; name: string };
  summary: {
    createdCount: number;
    failedCount: number;
    skippedCount?: number;
    partialSuccess?: boolean;
  };
  createdDrafts: Array<{
    id: string;
    label: string;
    skillId?: string;
    topic: string;
    platform?: string | null;
    qualityBadge?: string;
  }>;
  failures: Array<{ label: string; skillId?: string; error: string }>;
  skipped?: string[];
};

type AiProviderHealth = {
  status: "green" | "yellow" | "red";
  warning: string;
  recommendedProviderRoute?: { provider: string; model: string; label: string } | null;
  providers: Array<{
    provider: string;
    keyExists: boolean;
    source: string;
    lastKnownSuccessAt?: string | null;
    lastKnownFailure?: { category: string; reason: string; at: string } | null;
  }>;
};

type GrowthOpportunity = {
  title: string;
  whyItMatters: string;
  recommendedPlatforms: string[];
  contentAngle: string;
  suggestedFormats: string[];
  reachPotential: "high" | "medium" | "low";
  confidence: number;
};

type ContentGap = {
  gap: string;
  impact: "high" | "medium" | "low";
  suggestion: string;
};

type GrowthBrief = {
  summary: string;
  growthOpportunities: GrowthOpportunity[];
  contentGaps: ContentGap[];
  avoid: string[];
  recommendedNextCampaign: {
    topic: string;
    goal: string;
    platforms: string[];
    reason: string;
  };
};

type GrowthBriefResult = {
  brief: GrowthBrief;
  meta: {
    provider: string;
    model: string;
    fallbackUsed: boolean;
    analyzedPosts: number;
    rejectedPosts: number;
    detectedGaps: number;
    trendTopicsUsed: number;
  };
};

type RealtimeTrend = {
  title: string;
  source: string;
  market: string;
  platformHint: string;
  whyItMatters: string;
  suggestedAngle: string;
  contentFormats: string[];
  suggestedFormats?: string[];
  confidence: "high" | "medium" | "low";
  freshness: string;
  keywords: string[];
  clientFitScore?: number;
  sourceUrl?: string;
};

type RealtimeTrendResult = {
  mode?: "free" | "paid-enhanced";
  sourcesUsed?: string[];
  trends: RealtimeTrend[];
  sourceStatus: Record<string, string>;
  liveTrendApiConnected: boolean;
  meta?: { signalCount?: number; window?: string };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X / Twitter" },
  { value: "instagram_reels", label: "Instagram Reels" },
  { value: "youtube", label: "YouTube" },
];

// VideoStudio uses different platform values for Reels
const VIDEO_PLATFORM_MAP: Record<string, string> = {
  instagram: "instagram_reels",
  instagram_reels: "instagram_reels",
  youtube: "youtube",
  facebook: "facebook",
  linkedin: "linkedin",
  twitter: "twitter",
};

const ACTION_CARDS: ActionCard[] = [
  {
    id: "social-post",
    format: "social",
    title: "Social Post",
    description: "Generate a brand-ready caption, CTA, hashtags, and image prompt using reusable marketing skills.",
    whenToUse: "You need one polished post ready for Review.",
    nextStep: "AI → Review",
    icon: MessageSquareText,
    colorClass: "text-indigo-600 bg-indigo-50 border-indigo-100",
    getHref: (clientId) => `/clients/${clientId}/drafts?tab=pending`,
  },
  {
    id: "carousel",
    format: "carousel",
    title: "Instagram Carousel",
    description: "Generate a structured carousel with cover headline, slide copy, caption, CTA, and visual direction.",
    whenToUse: "You need a swipeable educational or product story.",
    nextStep: "AI → Review",
    icon: PanelsTopLeft,
    colorClass: "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-100",
    getHref: (clientId) => `/clients/${clientId}/drafts?tab=pending`,
  },
  {
    id: "generate-image",
    format: "image",
    title: "Generate Image",
    description: "Create brand-aligned visuals from a text description. Reference your own photos or brand assets for style guidance.",
    whenToUse: "You need a new image for a post, campaign, or ad.",
    nextStep: "Image Studio → Send to Review",
    icon: Palette,
    colorClass: "text-violet-600 bg-violet-50 border-violet-100",
    getHref: (clientId, p) => {
      const qs = new URLSearchParams({ idea: p.topic, platform: p.platform });
      if (p.imageUrl) qs.set("imageUrl", p.imageUrl);
      if (p.postId) qs.set("postId", p.postId);
      return `/clients/${clientId}/image-studio?${qs.toString()}`;
    },
  },
  {
    id: "create-video",
    format: "video",
    title: "Create Video Script",
    description: "AI writes a full video brief: hook, 5 scenes, voiceover, CTA, music direction, and caption.",
    whenToUse: "You need a Reel, TikTok, YouTube Short, or any short-form video.",
    nextStep: "Video Studio → Save to Review",
    icon: Video,
    colorClass: "text-rose-600 bg-rose-50 border-rose-100",
    getHref: (clientId, p) => {
      const qs = new URLSearchParams({
        idea: p.topic,
        platform: VIDEO_PLATFORM_MAP[p.platform] ?? p.platform,
      });
      return `/clients/${clientId}/video-studio?${qs.toString()}`;
    },
  },
  {
    id: "write-blog",
    format: "blog",
    title: "Write Blog Post",
    description: "AI writes a structured long-form post with SEO headings, keyword focus, and a CTA.",
    whenToUse: "You need website content, a LinkedIn article, or an email newsletter draft.",
    nextStep: "Blog Studio → Save to Drafts",
    icon: Newspaper,
    colorClass: "text-sky-600 bg-sky-50 border-sky-100",
    getHref: (clientId, p) => {
      const qs = new URLSearchParams({ topic: p.topic });
      return `/clients/${clientId}/blog?${qs.toString()}`;
    },
  },
  {
    id: "bulk-generate",
    format: "bulk",
    title: "Bulk Generate",
    description: "Generate a full week or month of post captions, platforms, and image prompts at once.",
    whenToUse: "You need to fill an entire content calendar quickly.",
    nextStep: "Bulk Generate → Review all drafts",
    icon: Zap,
    colorClass: "text-amber-600 bg-amber-50 border-amber-100",
    getHref: (clientId) => `/clients/${clientId}/bulk-generate`,
  },
  {
    id: "brand-assets",
    format: "assets",
    title: "Browse Brand Assets",
    description: "View all logos, generated images, and uploaded visuals saved for this client.",
    whenToUse: "You need an existing image as a reference or starting point in Image Studio.",
    nextStep: "Assets → copy URL → Image Studio reference",
    icon: ImageIcon,
    colorClass: "text-emerald-600 bg-emerald-50 border-emerald-100",
    getHref: (clientId) => `/clients/${clientId}/assets`,
  },
];

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchDashboardBrief(clientId: string): Promise<DashboardBrief> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/dashboard`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function fetchBrandDnaContext(clientId: string): Promise<BrandDnaContext | null> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/brand-dna`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({})) as { brandDna?: BrandDnaContext };
  return data.brandDna ?? null;
}

async function fetchSkillConnectivity(clientId: string): Promise<SkillConnectivity> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/skills/connectivity`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to check AI skill connectivity");
  return data as SkillConnectivity;
}

async function fetchProviderHealth(): Promise<AiProviderHealth> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/ai/provider-health`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to check AI provider health");
  return data as AiProviderHealth;
}

async function fetchGrowthBrief(
  clientId: string,
  params: { goal?: string; platformFocus?: string; trendTopics?: string[]; timeframe?: string }
): Promise<GrowthBriefResult> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/growth-advisor/brief`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "Could not generate growth brief.");
  return data as GrowthBriefResult;
}

async function fetchRealtimeTrends(clientId: string): Promise<RealtimeTrendResult> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/trends/realtime?window=24h&market=india&platform=instagram`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "Could not load live trends.");
  return data as RealtimeTrendResult;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreativeStudio() {
  const { clientId } = useParams<{ clientId: string }>();
  const [location] = useLocation();
  const qs = new URLSearchParams(location.split("?")[1] ?? "");

  // Read all inbound query params
  const initialTopic  = qs.get("topic") ?? qs.get("idea") ?? qs.get("prompt") ?? "";
  const initialPlat   = qs.get("platform") ?? "instagram";
  const initialFormat = (["social", "carousel", "image", "video", "blog", "bulk"].includes(qs.get("format") ?? "")
    ? qs.get("format")
    : "social") as Format;
  const trendTopic = qs.get("trendTopic") ?? "";
  const postId     = qs.get("postId") ?? "";
  const imageUrl   = qs.get("imageUrl") ?? "";
  const fromSource = qs.get("from") ?? "";

  const [topic, setTopic]     = useState(initialTopic);
  const [platform, setPlatform] = useState(initialPlat);
  const [format, setFormat]   = useState<Format>(initialFormat);
  const [lastSkillResult, setLastSkillResult] = useState<SkillGenerateResult | null>(null);
  const [campaignGoal, setCampaignGoal] = useState("awareness");
  const [campaignPlatforms, setCampaignPlatforms] = useState("instagram, facebook, linkedin");
  const [campaignStartDate, setCampaignStartDate] = useState("");
  const [lastCampaignResult, setLastCampaignResult] = useState<MiniCampaignResult | null>(null);
  const [growthBrief, setGrowthBrief] = useState<GrowthBriefResult | null>(null);
  const [advisorTrendInput, setAdvisorTrendInput] = useState(trendTopic);
  const [advisorExpanded, setAdvisorExpanded] = useState(false);
  const { toast } = useToast();

  const { data: dashboard } = useQuery({
    queryKey: ["creative-studio-dash", clientId],
    queryFn:  () => fetchDashboardBrief(clientId!),
    enabled:  !!clientId,
    staleTime: 60_000,
  });

  const { data: brandDna } = useQuery({
    queryKey: ["creative-studio-dna", clientId],
    queryFn:  () => fetchBrandDnaContext(clientId!),
    enabled:  !!clientId,
    staleTime: 60_000,
  });

  const { data: skillConnectivity } = useQuery({
    queryKey: ["creative-studio-skill-connectivity", clientId],
    queryFn:  () => fetchSkillConnectivity(clientId!),
    enabled:  !!clientId,
    staleTime: 60_000,
  });

  const { data: providerHealth } = useQuery({
    queryKey: ["ai-provider-health", clientId],
    queryFn:  fetchProviderHealth,
    enabled:  !!clientId,
    staleTime: 30_000,
  });

  const { data: realtimeTrends, isFetching: trendsLoading, refetch: refetchRealtimeTrends } = useQuery({
    queryKey: ["creative-studio-realtime-trends", clientId],
    queryFn: () => fetchRealtimeTrends(clientId!),
    enabled: !!clientId,
    staleTime: 10 * 60_000,
  });

  const urlParams: URLParams = {
    topic,
    platform,
    format,
    imageUrl: imageUrl || undefined,
    postId:   postId   || undefined,
  };

  const primaryCard = ACTION_CARDS.find(c => c.format === format) ?? ACTION_CARDS[0];
  const secondaryCards = ACTION_CARDS.filter(c => c.format !== format);

  const continueHref = primaryCard.getHref(clientId ?? "", urlParams);
  const skillIdByFormat: Partial<Record<Format, string>> = {
    social: "social_post_creator",
    carousel: "instagram_carousel_builder",
    blog: "seo_blog_writer",
    video: "short_video_reel_script",
  };
  const selectedSkillId = skillIdByFormat[format];
  const canGenerateWithSkill = Boolean(selectedSkillId);

  const brandColors = [brandDna?.primaryColor, brandDna?.secondaryColor, brandDna?.accentColor].filter(Boolean);
  const blockingConnectivity = skillConnectivity?.checks.find((check) => check.status === "red");
  const warningConnectivity = skillConnectivity?.checks.find((check) => check.status === "yellow");
  const readinessStatus = providerHealth?.status ?? skillConnectivity?.status;
  const readinessMessage = providerHealth?.warning
    ?? (blockingConnectivity ?? warningConnectivity)?.message
    ?? skillConnectivity?.providerRoute?.label
    ?? "Skill configs, provider routing, and memory packet are ready.";

  const generateSkillDraft = useMutation({
    mutationFn: async () => {
      if (!clientId || !selectedSkillId) throw new Error("Choose a skill-backed format first.");
      const token = localStorage.getItem("ams_token");
      const trendContext = trendTopic
        ? `Trend topic: ${trendTopic}. Source: ${fromSource || "creative_studio"}.`
        : fromSource
          ? `Source: ${fromSource}.`
          : "";
      const res = await fetch(`${BASE}/api/clients/${clientId}/skills/${selectedSkillId}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          input: {
            topic,
            platform: format === "carousel" ? "instagram" : platform,
            format,
            trendContext,
            source: fromSource || "creative_studio",
            notes: imageUrl ? `Reference image URL: ${imageUrl}` : "",
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not generate draft.");
      return data as SkillGenerateResult;
    },
    onSuccess: (data) => {
      setLastSkillResult(data);
      toast({
        title: "Draft saved to Review",
        description: data.skill?.displayName ? `${data.skill.displayName} created a Review draft.` : "Creative Studio created a Review draft.",
      });
    },
    onError: (err) => {
      toast({
        title: "AI generation failed",
        description: err instanceof Error ? err.message : "Check AI provider settings and try again.",
        variant: "destructive",
      });
    },
  });

  const generateMiniCampaign = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Select a client first.");
      if (!topic.trim()) throw new Error("Add a campaign topic first.");
      const token = localStorage.getItem("ams_token");
      const res = await fetch(`${BASE}/api/clients/${clientId}/campaigns/mini-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          topic,
          goal: campaignGoal,
          platforms: campaignPlatforms.split(",").map((item) => item.trim()).filter(Boolean),
          startDate: campaignStartDate || undefined,
          postCount: 3,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !Array.isArray(data.failures)) throw new Error(data.error || "Could not generate campaign drafts.");
      return data as MiniCampaignResult;
    },
    onSuccess: (data) => {
      setLastCampaignResult(data);
      toast({
        title: data.summary.createdCount === 0
          ? "Campaign drafts need attention"
          : data.summary.partialSuccess
            ? "Campaign partially generated"
            : "Campaign drafts saved",
        description: `${data.summary.createdCount} draft${data.summary.createdCount === 1 ? "" : "s"} saved to Review.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Campaign generation failed",
        description: err instanceof Error ? err.message : "Check AI provider settings and try again.",
        variant: "destructive",
      });
    },
  });

  const retryMiniCampaignFailures = useMutation({
    mutationFn: async () => {
      if (!clientId || !lastCampaignResult?.campaign?.id) throw new Error("No failed campaign is selected.");
      const token = localStorage.getItem("ams_token");
      const res = await fetch(`${BASE}/api/clients/${clientId}/campaigns/${lastCampaignResult.campaign.id}/mini-retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          failures: lastCampaignResult.failures.map((failure) => ({
            label: failure.label,
            skillId: failure.skillId,
          })),
          startDate: campaignStartDate || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !Array.isArray(data.failures)) throw new Error(data.error || "Could not retry failed campaign items.");
      return data as MiniCampaignResult;
    },
    onSuccess: (data) => {
      setLastCampaignResult((current) => ({
        ...data,
        campaign: data.campaign ?? current?.campaign,
        createdDrafts: [...(current?.createdDrafts ?? []), ...data.createdDrafts],
      }));
      toast({
        title: data.summary.createdCount ? "Retry created drafts" : "Retry still needs attention",
        description: `Created: ${data.summary.createdCount}. Failed: ${data.summary.failedCount}.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : "Check AI provider settings and try again.",
        variant: "destructive",
      });
    },
  });

  const generateGrowthBrief = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("No client selected.");
      const trendTopics = advisorTrendInput.trim()
        ? advisorTrendInput.split(/[,\n]+/).map(t => t.trim()).filter(Boolean)
        : [];
      return fetchGrowthBrief(clientId, { trendTopics, timeframe: "weekly" });
    },
    onSuccess: (data) => {
      setGrowthBrief(data);
      setAdvisorExpanded(true);
    },
    onError: (err) => {
      toast({
        title: "Growth brief failed",
        description: err instanceof Error ? err.message : "Check AI provider settings and try again.",
        variant: "destructive",
      });
    },
  });

  const applyOpportunityToCampaign = (opp: GrowthOpportunity) => {
    setTopic(opp.contentAngle || opp.title);
    setCampaignGoal(["awareness", "engagement", "leads", "sales"].includes(growthBrief?.brief.recommendedNextCampaign.goal ?? "") ? (growthBrief?.brief.recommendedNextCampaign.goal ?? "awareness") : "awareness");
    setCampaignPlatforms(opp.recommendedPlatforms.join(", "));
    setFormat("social");
    // Scroll to top area where the brief input is
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: "Campaign pre-filled", description: "Review the topic and platforms, then generate campaign drafts." });
  };

  const useRealtimeTrendInBrief = (trend: RealtimeTrend) => {
    setAdvisorTrendInput((current) => {
      const existing = current.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
      return [...new Set([...existing, `${trend.title}: ${trend.suggestedAngle}`])].join("\n");
    });
    setAdvisorExpanded(true);
    toast({ title: "Trend added to Growth Brief" });
  };

  const createCampaignFromTrend = (trend: RealtimeTrend) => {
    setTopic(trend.suggestedAngle || trend.title);
    setCampaignPlatforms(trend.platformHint === "linkedin" ? "linkedin" : trend.platformHint === "youtube" ? "youtube" : "instagram, linkedin");
    setCampaignGoal("engagement");
    setFormat("social");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: "Campaign pre-filled from trend" });
  };

  const qualityBadge = lastSkillResult?.metadata?.qualityBadge;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-primary" />
          Creative Studio
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          One place to start any creative task. Choose a format, describe what you need, generate, then review.
        </p>
      </div>

      {/* ── Context banner (only when arriving from another page) ─── */}
      {(trendTopic || postId) && (
        <div className={cn(
          "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
          trendTopic
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : "bg-blue-50 border-blue-200 text-blue-800",
        )}>
          {trendTopic
            ? <TrendingUp className="w-4 h-4 shrink-0" />
            : <Layers className="w-4 h-4 shrink-0" />}
          <span>
            {trendTopic
              ? <><strong>Trend pre-loaded:</strong> {trendTopic}. Topic and platform are pre-filled below.</>
              : <><strong>Post context loaded.</strong> Image Studio is pre-selected for this post's artwork.</>}
          </span>
          {fromSource && (
            <Badge variant="outline" className="ml-auto shrink-0 capitalize text-[10px]">
              from {fromSource}
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Brief + Actions ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          <Card className="border-amber-200/70 bg-amber-50/40">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-amber-600" />
                    Today's Opportunities
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Live signals stay compact and feed directly into Growth Advisor or campaign drafts.
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => refetchRealtimeTrends()} disabled={trendsLoading}>
                  {trendsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Refresh
                </Button>
              </div>

              {realtimeTrends && !realtimeTrends.liveTrendApiConnected && (
                <div className="rounded-md border border-amber-200 bg-white/60 px-3 py-2 text-xs text-amber-800">
                  Free trend mode active. Showing Google News, RSS-style public signals, and AI Memory.
                </div>
              )}
              {realtimeTrends?.liveTrendApiConnected && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Paid-enhanced trend mode active. Connected providers are layered on top of free sources.
                </div>
              )}

              <div className="grid gap-2">
                {(realtimeTrends?.trends ?? []).slice(0, 3).map((trend) => (
                  <div key={`${trend.source}-${trend.title}`} className="rounded-lg border bg-white/80 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold line-clamp-1">{trend.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{trend.suggestedAngle || trend.whyItMatters}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{trend.confidence}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">{trend.source}</Badge>
                      <Badge variant="outline" className="text-[10px]">{trend.platformHint}</Badge>
                      {typeof trend.clientFitScore === "number" && (
                        <Badge variant="outline" className="text-[10px]">{trend.clientFitScore}% fit</Badge>
                      )}
                      {trend.keywords.slice(0, 2).map((keyword) => (
                        <Badge key={keyword} variant="outline" className="text-[10px]">{keyword}</Badge>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => useRealtimeTrendInBrief(trend)}>
                        Use in Growth Brief
                      </Button>
                      <Button size="sm" className="h-7 text-xs" onClick={() => createCampaignFromTrend(trend)}>
                        Create Campaign
                      </Button>
                    </div>
                  </div>
                ))}
                {realtimeTrends && realtimeTrends.trends.length === 0 && (
                  <div className="rounded-lg border border-dashed bg-white/50 py-6 text-center text-xs text-muted-foreground">
                    No current trend signals found. Refresh later or add Serper in Settings → AI Keys.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── AI Growth Advisor ─────────────────────────────────── */}
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    AI Growth Advisor
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    AI studies your brand history, past drafts, rejections, and market trends — then tells you exactly what to create next.
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 bg-primary/5 border-primary/20 text-primary text-[10px]">
                  Weekly Brief
                </Badge>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Trend topics to include (optional — comma-separated)
                </label>
                <Textarea
                  className="min-h-[52px] text-xs resize-none"
                  placeholder="e.g. AI in manufacturing, sustainable packaging, festive season demand"
                  value={advisorTrendInput}
                  onChange={e => setAdvisorTrendInput(e.target.value)}
                />
              </div>

              <Button
                variant="outline"
                className="w-full gap-2 border-primary/30 hover:bg-primary/5"
                disabled={generateGrowthBrief.isPending}
                onClick={() => generateGrowthBrief.mutate()}
              >
                {generateGrowthBrief.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Sparkles className="w-4 h-4 text-primary" />}
                {generateGrowthBrief.isPending ? "Analyzing your brand and market…" : "Generate Weekly Growth Brief"}
              </Button>

              {growthBrief && (
                <div className="space-y-4">
                  <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2.5">
                    <p className="text-xs text-primary/90 leading-relaxed">{growthBrief.brief.summary}</p>
                    <div className="flex flex-wrap gap-2 mt-1.5 text-[10px] text-muted-foreground">
                      <span>{growthBrief.meta.analyzedPosts} posts analyzed</span>
                      {growthBrief.meta.rejectedPosts > 0 && <span>· {growthBrief.meta.rejectedPosts} rejections reviewed</span>}
                      {growthBrief.meta.trendTopicsUsed > 0 && <span>· {growthBrief.meta.trendTopicsUsed} trend{growthBrief.meta.trendTopicsUsed > 1 ? "s" : ""} used</span>}
                      {growthBrief.meta.fallbackUsed && <span>· AI backup used</span>}
                    </div>
                  </div>

                  <button
                    onClick={() => setAdvisorExpanded(v => !v)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>{growthBrief.brief.growthOpportunities.length} growth opportunities</span>
                    {advisorExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {advisorExpanded && (
                    <div className="space-y-3">
                      {growthBrief.brief.growthOpportunities.map((opp, i) => (
                        <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug">{opp.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 h-4",
                                  opp.reachPotential === "high" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                  opp.reachPotential === "medium" ? "bg-amber-50 text-amber-700 border-amber-200" :
                                  "bg-muted text-muted-foreground"
                                )}
                              >
                                {opp.reachPotential} reach
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">{opp.confidence}%</span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{opp.whyItMatters}</p>
                          <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                            <span className="font-medium">Angle: </span>{opp.contentAngle}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {opp.recommendedPlatforms.map(p => (
                              <Badge key={p} variant="outline" className="text-[10px] px-1.5 h-4 capitalize">{p}</Badge>
                            ))}
                            {opp.suggestedFormats.map(f => (
                              <Badge key={f} variant="secondary" className="text-[10px] px-1.5 h-4">{f}</Badge>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs w-full gap-1.5 border-primary/30 hover:bg-primary/5"
                            onClick={() => applyOpportunityToCampaign(opp)}
                          >
                            <Target className="w-3 h-3" />
                            Create Campaign from this
                          </Button>
                        </div>
                      ))}

                      {growthBrief.brief.contentGaps.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                            <BarChart2 className="w-3 h-3" /> Content Gaps
                          </p>
                          {growthBrief.brief.contentGaps.map((gap, i) => (
                            <div key={i} className="rounded-md border border-amber-200/70 bg-amber-50/50 px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] px-1 h-3.5 shrink-0",
                                    gap.impact === "high" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}
                                >
                                  {gap.impact}
                                </Badge>
                                <span className="text-xs font-medium">{gap.gap}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{gap.suggestion}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {growthBrief.brief.avoid.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                            <AlertOctagon className="w-3 h-3" /> Avoid
                          </p>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {growthBrief.brief.avoid.map((item, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {growthBrief.brief.recommendedNextCampaign?.topic && (
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                            Recommended Next Campaign
                          </p>
                          <p className="text-sm font-medium">{growthBrief.brief.recommendedNextCampaign.topic}</p>
                          <p className="text-xs text-muted-foreground">{growthBrief.brief.recommendedNextCampaign.reason}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {growthBrief.brief.recommendedNextCampaign.platforms.map(p => (
                              <Badge key={p} variant="outline" className="text-[10px] px-1.5 h-4 capitalize">{p}</Badge>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            className="h-7 text-xs w-full gap-1.5"
                            onClick={() => {
                              const rec = growthBrief.brief.recommendedNextCampaign;
                              setTopic(rec.topic);
                              setCampaignGoal(["awareness", "engagement", "leads", "sales"].includes(rec.goal) ? rec.goal : "awareness");
                              setCampaignPlatforms(rec.platforms.join(", "));
                              window.scrollTo({ top: 0, behavior: "smooth" });
                              toast({ title: "Campaign pre-filled", description: "Scroll up to generate campaign drafts." });
                            }}
                          >
                            <Zap className="w-3 h-3" />
                            Start this campaign
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Mini Campaign ──────────────────────────────────────── */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-start gap-3">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-600" />
                    Generate Campaign Drafts
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create a full set of posts, carousel, reel, and blog from one topic — all saved to Review.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Goal</label>
                  <Select value={campaignGoal} onValueChange={setCampaignGoal}>
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
                  <label className="text-sm font-medium">Platforms</label>
                  <Input
                    value={campaignPlatforms}
                    onChange={(event) => setCampaignPlatforms(event.target.value)}
                    placeholder="instagram, facebook, linkedin"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Start date</label>
                  <Input
                    type="date"
                    value={campaignStartDate}
                    onChange={(event) => setCampaignStartDate(event.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                disabled={!topic.trim() || generateMiniCampaign.isPending}
                onClick={() => generateMiniCampaign.mutate()}
              >
                {generateMiniCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {generateMiniCampaign.isPending ? "Generating campaign drafts..." : "Generate Campaign Drafts"}
              </Button>
              {lastCampaignResult && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        Created: {lastCampaignResult.createdDrafts.length} · Failed: {lastCampaignResult.failures.length}
                      </p>
                      {lastCampaignResult.summary.skippedCount ? (
                        <p className="text-xs text-muted-foreground">{lastCampaignResult.summary.skippedCount} existing item{lastCampaignResult.summary.skippedCount === 1 ? "" : "s"} skipped.</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                    {lastCampaignResult.failures.length > 0 && lastCampaignResult.campaign?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        disabled={retryMiniCampaignFailures.isPending}
                        onClick={() => retryMiniCampaignFailures.mutate()}
                      >
                        {retryMiniCampaignFailures.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Retry Failed Items
                      </Button>
                    )}
                    {lastCampaignResult.createdDrafts.length > 0 && lastCampaignResult.campaign?.id && (
                      <Link href={`/clients/${clientId}/drafts?tab=pending&campaignId=${lastCampaignResult.campaign.id}`}>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5">
                          Open Review <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    )}
                    </div>
                  </div>
                  <div className="grid gap-1.5 text-xs">
                    {lastCampaignResult.createdDrafts.map((draft) => (
                      <div key={draft.id} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5">
                        <span>{draft.label}</span>
                        <span className="text-muted-foreground">{draft.platform ?? "draft"}{draft.qualityBadge ? ` · AI quality: ${draft.qualityBadge}` : ""}</span>
                      </div>
                    ))}
                    {lastCampaignResult.failures.map((failure, index) => (
                      <div key={`${failure.label}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
                        {failure.label} failed: {failure.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Single Content (Creative Brief) ───────────────────── */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div>
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-indigo-600" />
                  Create Single Post
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  AI generates one polished draft and saves it to Review.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">What would you like to create?</label>
                <textarea
                  className="min-h-[84px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  placeholder="e.g. A product announcement for our new summer collection, warm and confident tone"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Platform</label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Format</label>
                  <Select value={format} onValueChange={v => setFormat(v as Format)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="social">Social Post</SelectItem>
                      <SelectItem value="carousel">Instagram Carousel</SelectItem>
                      <SelectItem value="image">Image / Visual</SelectItem>
                      <SelectItem value="video">Video Script</SelectItem>
                      <SelectItem value="blog">Blog / Article</SelectItem>
                      <SelectItem value="bulk">Bulk Posts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {canGenerateWithSkill ? (
                <Button
                  className="w-full gap-2"
                  disabled={!topic.trim() || generateSkillDraft.isPending}
                  onClick={() => generateSkillDraft.mutate()}
                >
                  <primaryCard.icon className="w-4 h-4" />
                  {generateSkillDraft.isPending ? "Generating..." : `Generate ${primaryCard.title}`}
                  <ArrowRight className="w-4 h-4 ml-auto" />
                </Button>
              ) : (
                <Link href={topic.trim() ? continueHref : "#"}>
                  <Button className="w-full gap-2" disabled={!topic.trim()}>
                    <primaryCard.icon className="w-4 h-4" />
                    Continue to {primaryCard.title}
                    <ArrowRight className="w-4 h-4 ml-auto" />
                  </Button>
                </Link>
              )}
              {!topic.trim() && (
                <p className="text-xs text-muted-foreground text-center -mt-1">
                  Describe what you want to create to continue
                </p>
              )}
              {canGenerateWithSkill && (skillConnectivity || providerHealth) && (
                <div className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  readinessStatus === "green" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                  readinessStatus === "yellow" && "border-amber-200 bg-amber-50 text-amber-800",
                  readinessStatus === "red" && "border-red-200 bg-red-50 text-red-800",
                )}>
                  <div className="flex items-start gap-2">
                    {readinessStatus === "green"
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {readinessStatus === "green" ? "AI ready" : readinessStatus === "yellow" ? "AI checking..." : "AI needs attention"}
                      </p>
                      <p className="mt-0.5">{readinessMessage}</p>
                      {readinessStatus !== "green" && (
                        <Link href="/settings">
                          <span className="mt-1 inline-flex font-medium underline underline-offset-2">Open Settings → AI Keys</span>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {lastSkillResult?.post && (
                <div className="rounded-lg border bg-emerald-50/60 border-emerald-100 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-emerald-900">Ready for review</p>
                      <p className="text-xs text-emerald-800 line-clamp-2">{lastSkillResult.post.topic}</p>
                    </div>
                    {qualityBadge && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0",
                          qualityBadge === "Good" && "bg-green-50 text-green-700 border-green-200",
                          qualityBadge === "Needs Review" && "bg-amber-50 text-amber-700 border-amber-200",
                          qualityBadge === "Weak Brand Match" && "bg-red-50 text-red-700 border-red-200",
                        )}
                      >
                        {qualityBadge}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-800">
                    <span>AI mode: {lastSkillResult.skill?.displayName ?? lastSkillResult.metadata?.skillId}</span>
                    {lastSkillResult.metadata?.model && <span>· {lastSkillResult.metadata.model}</span>}
                    {lastSkillResult.metadata?.fallbackUsed && <span>· AI backup used</span>}
                  </div>
                  <Link href={`/clients/${clientId}/drafts?tab=pending&postId=${lastSkillResult.post.id}`}>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5">
                      Open in Review <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* What happens next */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              What happens next
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className={cn(
                "font-medium px-2 py-0.5 rounded text-xs",
                primaryCard.colorClass,
              )}>
                {primaryCard.title}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground text-xs">Send to Review</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground text-xs">Approve</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground text-xs">Publish Queue</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{primaryCard.description}</p>
            {canGenerateWithSkill && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                AI uses Brand DNA, Memory, and AI quality scoring on every draft.
              </p>
            )}
          </div>

          {/* Other modes */}
          <div>
            <p className="text-sm font-semibold mb-3">Other creation modes</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {secondaryCards.map(card => {
                const href = card.getHref(clientId ?? "", urlParams);
                return (
                  <Link href={href} key={card.id}>
                    <div className="group flex items-start gap-3 rounded-lg border bg-card p-3 hover:border-primary/30 hover:bg-muted/20 transition-colors cursor-pointer">
                      <div className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                        card.colorClass,
                      )}>
                        <card.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{card.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {card.whenToUse}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          → {card.nextStep}
                        </p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary mt-1 shrink-0 transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Brand Context Panel ─────────────────────────── */}
        <div className="space-y-4">
          {/* Brand DNA context */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Brand Context
              </p>
              {!dashboard?.hasBrandDna ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Brand DNA not set up yet. AI will use generic defaults.
                  </p>
                  <Link href={`/clients/${clientId}/brand-dna`}>
                    <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-7">
                      Set up Brand DNA <ArrowRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {brandDna?.voiceTone && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Voice</p>
                      <p className="text-xs mt-0.5">{brandDna.voiceTone}</p>
                    </div>
                  )}
                  {brandDna?.industry && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Industry</p>
                      <p className="text-xs mt-0.5">{brandDna.industry}</p>
                    </div>
                  )}
                  {brandColors.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1.5">
                        Brand Colors
                      </p>
                      <div className="flex gap-1.5">
                        {brandColors.map((color, i) => (
                          <div
                            key={i}
                            title={color}
                            className="h-6 w-6 rounded-full border border-border shadow-sm"
                            style={{ backgroundColor: color ?? "" }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 pt-1">
                    <Circle className="w-2 h-2 fill-emerald-400 stroke-none shrink-0" />
                    Brand context active — AI will apply it
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Storyline */}
          {dashboard?.activeStoryline && (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Active Storyline
                  </p>
                </div>
                <p className="text-sm font-medium">{dashboard.activeStoryline.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {dashboard.activeStoryline.narrative}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  AI will align content to this narrative arc.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Trend context (only when arriving from Trend Intelligence) */}
          {trendTopic && (
            <Card className="bg-amber-50/60 border-amber-100">
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Trend Context
                  </p>
                </div>
                <p className="text-sm font-medium text-amber-900">{trendTopic}</p>
                <p className="text-xs text-amber-700">
                  AI will use this trend as context while staying brand-safe.
                </p>
              </CardContent>
            </Card>
          )}

          {/* AI provider warning */}
          {dashboard && !dashboard.aiProviderConfigured && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">AI not configured</p>
              <p className="text-xs text-amber-700">
                Add an API key in Settings before generating content.
              </p>
              <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                AI generation will show a clear error until a key is configured.
              </div>
              <Link href="/settings">
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs gap-1.5 w-full">
                  Open Settings <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          )}

          {/* Workflow reminder */}
          <div className="rounded-lg border bg-muted/20 px-4 py-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Workflow reminder
            </p>
            <p className="text-xs text-muted-foreground">
              Create visual or copy here, then send to Review to finalise text and artwork before publishing.
            </p>
            <Link
              href={`/clients/${clientId}/drafts?tab=pending`}
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open Review <ArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
