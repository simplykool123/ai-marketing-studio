import { useState, type ElementType } from "react";
import { useParams, Link } from "wouter";
import { cn } from "@/lib/utils";
import { useGetClient, type Post } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  FileText,
  CheckCircle2,
  Send,
  ArrowRight,
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  Globe,
  Clock,
  CalendarDays,
  BarChart3,
  BookOpen,
  Image as ImageIcon,
  AlertCircle,
  RefreshCw,
  Radar,
  Sparkles,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ConnectedAccount = {
  id: string;
  platform: string;
  accountName: string;
  accountHandle?: string | null;
  followerCount?: number | null;
};

type EnhancedDashboard = {
  totalPosts: number;
  draftCount: number;
  approvedCount: number;
  publishedCount: number;
  scheduledCount: number;
  campaignDraftCount: number;
  brandAssetCount: number;
  imageAssetCount: number;
  artworkReadyCount: number;
  hasStoryline: boolean;
  activeStoryline: { id: string; title: string; narrative: string } | null;
  hasBrandDna: boolean;
  connectedAccounts: ConnectedAccount[];
  recentPosts: Array<{
    id: string;
    caption: string;
    topic: string;
    status: string;
    selectedImageUrl?: string | null;
    scheduledAt?: string | null;
    platform?: string | null;
    createdAt: string;
  }>;
  upcomingPosts: Array<{
    id: string;
    caption: string;
    topic: string;
    status: string;
    scheduledAt?: string | null;
    platform?: string | null;
  }>;
  todaysPosts: Array<{
    id: string;
    caption: string;
    status: string;
    scheduledAt?: string | null;
  }>;
  pendingApprovals: number;
  needsAttentionCount: number;
  recentlyPublished?: Post[];
  storageReady: boolean;
  storageStatusMessage?: string;
  aiProviderConfigured: boolean;
  aiProvider?: string | null;
  aiModel?: string | null;
  aiKeySource?: "database" | "env" | "none";
};

type OccasionSummary = {
  id: string;
  title: string;
  date: string;
  category: string;
  requiresYearlyUpdate: boolean;
};

type AnalyticsSummary = {
  publishedPosts: number;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number | null;
  posts: Array<{
    postId: string;
    platform: string;
    warning?: string;
    fetchedAt?: string;
  }>;
};

async function fetchDashboard(clientId: string): Promise<EnhancedDashboard> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/dashboard`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
}

async function fetchAnalyticsSummary(clientId: string): Promise<AnalyticsSummary> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/analytics/summary`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

async function refreshAnalytics(clientId: string): Promise<AnalyticsSummary> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/analytics/refresh`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to refresh analytics");
  return data;
}

async function fetchOccasions(clientId: string): Promise<{ occasions: OccasionSummary[] }> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/occasions`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch occasions");
  return res.json();
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500/20 text-pink-400",
  facebook: "bg-blue-500/20 text-blue-400",
  linkedin: "bg-sky-500/20 text-sky-400",
  twitter: "bg-cyan-500/20 text-cyan-400",
  youtube: "bg-red-500/20 text-red-400",
};

function readableStatus(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    approved: "Approved",
    export_ready: "Ready to post",
    scheduled: "Scheduled",
    posted: "Published",
    published: "Published",
    failed: "Failed",
  };
  return map[status] ?? status;
}

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const icons: Record<string, ElementType> = {
    instagram: Instagram,
    facebook: Facebook,
    twitter: Twitter,
    linkedin: Linkedin,
  };
  const platformColors: Record<string, string> = {
    instagram: "#E1306C",
    facebook: "#1877F2",
    twitter: "#1DA1F2",
    linkedin: "#0A66C2",
  };
  const Icon = icons[platform] ?? Globe;
  return <Icon className={className} style={{ color: platformColors[platform] }} />;
}

function ActivityThumbnail({
  src,
  platform,
  published = false,
}: {
  src?: string | null;
  platform?: string | null;
  published?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = published ? (
    platform ? <PlatformIcon platform={platform} className="w-4 h-4 opacity-70" /> : <Send className="w-4 h-4 text-green-500 opacity-70" />
  ) : (
    <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
  );

  return (
    <div className={cn("w-11 h-11 shrink-0 flex items-center justify-center border-r border-border", published ? "bg-green-50" : "bg-muted")}>
      {src && !failed ? (
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
      ) : fallback}
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
      ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800",
    )}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function PipelineStep({ label, count, icon: Icon }: { label: string; count: number; icon: ElementType }) {
  return (
    <div className="rounded-lg border bg-background/80 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{count}</div>
    </div>
  );
}

export default function ClientDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: client, isLoading: isClientLoading } = useGetClient(clientId || "");

  const { data: dashboard, isLoading: isDashboardLoading } = useQuery({
    queryKey: ["enhanced-dashboard", clientId],
    queryFn: () => fetchDashboard(clientId!),
    enabled: !!clientId,
  });

  const { data: occasionsData } = useQuery({
    queryKey: ["marketing-occasions", clientId],
    queryFn: () => fetchOccasions(clientId!),
    enabled: !!clientId,
  });

  const { data: analytics } = useQuery({
    queryKey: ["analytics-summary", clientId],
    queryFn: () => fetchAnalyticsSummary(clientId!),
    enabled: !!clientId,
  });

  const refreshAnalyticsMutation = useMutation({
    mutationFn: () => refreshAnalytics(clientId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics-summary", clientId] });
      toast({ title: "Analytics refreshed", description: "Metrics were updated for connected published posts." });
    },
    onError: (err) => toast({
      title: "Analytics refresh failed",
      description: err instanceof Error ? err.message : "Metrics could not be refreshed.",
      variant: "destructive",
    }),
  });

  const recentlyPublished = dashboard?.recentlyPublished;
  const nextOccasion = occasionsData?.occasions?.find((occasion) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(occasion.date) >= today;
  });

  if (isClientLoading || isDashboardLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!client || !dashboard) return <div>Client not found</div>;

  const setupSteps: Array<{
    label: string;
    done: boolean;
    href?: string;
    hint?: string;
    doneHint?: string;
    detail?: string;
  }> = [
    {
      label: "Create or select client",
      done: true,
      href: "/",
      doneHint: "Current workspace",
      detail: "Choose the client workspace you want to set up.",
    },
    {
      label: "Complete Brand Setup",
      done: dashboard.hasBrandDna,
      href: `/clients/${clientId}/brand-dna`,
      hint: "Add voice, audience, colors, and goals",
      doneHint: "Brand DNA saved",
      detail: "Import the website or fill the brand basics so every draft has the right context.",
    },
    {
      label: "Import logo and images",
      done: Boolean((client as { logoUrl?: string | null }).logoUrl) || dashboard.brandAssetCount > 0 || dashboard.imageAssetCount > 0,
      href: `/clients/${clientId}/brand-dna`,
      hint: "Use Brand Importer or upload assets",
      doneHint: "Assets available",
      detail: "Save logo, palette, and useful website images before generating polished posts.",
    },
    {
      label: "Generate first campaign or occasion draft",
      done: dashboard.totalPosts > 0 || dashboard.campaignDraftCount > 0,
      href: dashboard.hasBrandDna ? `/clients/${clientId}/campaigns/generate` : `/clients/${clientId}/brand-dna`,
      hint: dashboard.hasBrandDna ? "Open Campaign Planner" : "Finish Brand Setup first",
      doneHint: "Draft created",
      detail: "Create the first useful content batch from Campaign Planner or Marketing Calendar.",
    },
    {
      label: "Review and edit artwork",
      done: dashboard.artworkReadyCount > 0 || dashboard.pendingApprovals > 0 || dashboard.approvedCount > 0 || dashboard.publishedCount > 0,
      href: `/clients/${clientId}/drafts`,
      hint: "Open Review",
      doneHint: dashboard.artworkReadyCount > 0 ? "Artwork attached" : "Reviewed",
      detail: "Check captions, rewrite if needed, and save final artwork before approval.",
    },
    {
      label: "Approve to Publish Queue",
      done: dashboard.approvedCount > 0 || dashboard.scheduledCount > 0 || dashboard.publishedCount > 0,
      href: `/clients/${clientId}/drafts?tab=ready`,
      hint: "Approve one ready draft",
      doneHint: "Queue has content",
      detail: "Approve the finished draft so it moves into the Publish Queue.",
    },
  ];
  const setupComplete = setupSteps.filter((s) => s.done).length;
  const allDone = setupComplete === setupSteps.length;
  const collapsedSetup = setupComplete >= 4;
  const visibleSetupSteps = collapsedSetup ? setupSteps.filter((step) => !step.done) : setupSteps;
  const nextSetupStep = setupSteps.find((step) => !step.done) ?? setupSteps[setupSteps.length - 1]!;
  const setupCtaLabel = setupComplete <= 1 ? "Start setup" : "Continue setup";
  const hasSocialAccount = !!dashboard.connectedAccounts?.length;
  const hasWorkflow = !!(client as { webhookUrl?: string | null }).webhookUrl;
  const readyPostCount = dashboard.approvedCount + dashboard.scheduledCount;
  const publishingReady = hasSocialAccount || hasWorkflow;
  const activityItems = (() => {
    const published = (recentlyPublished ?? []).slice(0, 2).map((post: Post) => ({ type: "published" as const, post }));
    const publishedIds = new Set(published.map(({ post }) => post.id));
    const recent = dashboard.recentPosts
      .filter((post) => !publishedIds.has(post.id))
      .slice(0, 5 - published.length)
      .map((post) => ({ type: "recent" as const, post }));
    return [...published, ...recent].slice(0, 5);
  })();
  const nextStep = (() => {
    if (dashboard.needsAttentionCount > 0) {
      return {
        title: `${dashboard.needsAttentionCount} post${dashboard.needsAttentionCount === 1 ? "" : "s"} need attention`,
        detail: "A publish attempt failed or was blocked. Open the Publish Queue to review the reason and choose manual export, reconnect, or retry.",
        href: `/clients/${clientId}/queue`,
        button: "Open Publish Queue",
      };
    }
    if (!dashboard.hasBrandDna) {
      return {
        title: "Complete Brand Setup",
        detail: "Import the website or fill the basics so every idea, campaign, image, and report uses the right voice and audience.",
        href: `/clients/${clientId}/brand-dna`,
        button: "Open Brand Setup",
      };
    }
    if (dashboard.brandAssetCount === 0 && dashboard.imageAssetCount === 0) {
      return {
        title: "Import brand assets",
        detail: "Add a logo, product images, and website references so generated visuals feel like this client.",
        href: `/clients/${clientId}/brand-dna`,
        button: "Import assets",
      };
    }
    if (!dashboard.aiProviderConfigured) {
      return {
        title: "Configure AI provider",
        detail: "Add and test an AI key in Settings before generating campaign content.",
        href: "/settings",
        button: "Open Settings",
      };
    }
    if (dashboard.pendingApprovals > 0) {
      return {
        title: `Review ${dashboard.pendingApprovals} pending draft${dashboard.pendingApprovals === 1 ? "" : "s"}`,
        detail: "AI-generated content is ready for your review. Approve to move to the publish queue.",
        href: `/clients/${clientId}/drafts?tab=pending`,
        button: "Open Review",
      };
    }
    if (dashboard.totalPosts === 0) {
      return {
        title: "Research trends for this client",
        detail: "Find current topics and brand-safe angles before generating the first campaign.",
        href: `/clients/${clientId}/research`,
        button: "Research trends",
      };
    }
    if (dashboard.draftCount > 0) {
      return {
        title: `Review ${dashboard.draftCount} draft${dashboard.draftCount === 1 ? "" : "s"}`,
        detail: "Continue editing or approve drafts to move them to the publish queue.",
        href: `/clients/${clientId}/drafts`,
        button: "Review drafts",
      };
    }
    if (readyPostCount > 0 && !publishingReady) {
      return {
      title: "Choose publishing destination",
      detail: "Approved posts are ready, but no social account or workflow URL is connected. Export still works.",
      href: `/clients/${clientId}/social-accounts`,
      button: "Check destinations",
      };
    }
    if (readyPostCount > 0) {
      return {
        title: `Publish ${readyPostCount} approved post${readyPostCount === 1 ? "" : "s"}`,
        detail: "Content is approved and waiting in the Publish Queue.",
        href: `/clients/${clientId}/queue`,
        button: "Open publish queue",
      };
    }
    if (!hasSocialAccount) {
      return {
      title: "Connect a destination",
      detail: "Set up a social account or workflow URL, or keep using manual export packages.",
      href: `/clients/${clientId}/social-accounts`,
      button: "Check destinations",
      };
    }
    return {
      title: dashboard.campaignDraftCount === 0 ? "Generate your first campaign" : "Create next post",
      detail: dashboard.campaignDraftCount === 0
        ? "Use Campaign Planner to generate a full content calendar in one go."
        : "Create the next piece of content for this client.",
      href: dashboard.campaignDraftCount === 0 ? `/clients/${clientId}/campaigns/generate` : `/clients/${clientId}/create`,
      button: dashboard.campaignDraftCount === 0 ? "Open Campaign Planner" : "Create next post",
    };
  })();
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 rounded-xl border bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-sm">
        <div>
            <h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill ok={dashboard.aiProviderConfigured} label={dashboard.aiProviderConfigured ? "AI ready" : "AI setup needed"} />
          <StatusPill ok={dashboard.hasBrandDna} label={dashboard.hasBrandDna ? "Brand ready" : "Brand incomplete"} />
          <StatusPill ok={publishingReady} label={publishingReady ? "Destination ready" : "Export/manual only"} />
        </div>
      </div>

      {!allDone && (
        <Card className="border-primary/25 bg-primary/5 shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">First-time setup</p>
                <h2 className="mt-1 text-xl font-semibold">Get this client ready to use</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Follow the core flow once: brand, assets, first draft, review, then queue.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-background">
                    {setupComplete} / {setupSteps.length} complete
                  </Badge>
                  {collapsedSetup && (
                    <span className="text-xs text-muted-foreground">Mostly complete. Showing remaining steps only.</span>
                  )}
                </div>
              </div>
              <Link href={nextSetupStep.href ?? `/clients/${clientId}`}>
                <Button className="gap-2 lg:min-w-44">
                  {setupCtaLabel}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {visibleSetupSteps.map((step, index) => {
                const stepNumber = setupSteps.indexOf(step) + 1;
                const row = (
                  <div className={cn(
                    "flex min-h-20 gap-3 rounded-lg border bg-background p-3 transition-colors",
                    step.done ? "opacity-70" : step.href ? "hover:border-primary/40 hover:bg-primary/5 cursor-pointer" : ""
                  )}>
                    <div className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                      step.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground"
                    )}>
                      {step.done ? <CheckCircle2 className="w-4 h-4" /> : stepNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn("text-sm font-semibold", step.done && "text-muted-foreground")}>{step.label}</p>
                        {index === 0 && !step.done && (
                          <Badge variant="secondary" className="text-[10px]">Next</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                      <p className={cn("mt-1 text-xs", step.done ? "text-primary" : "text-amber-700")}>
                        {step.done ? step.doneHint ?? "Done" : step.hint ?? "Not complete yet"}
                      </p>
                    </div>
                    {!step.done && step.href && <ArrowRight className="mt-1 w-4 h-4 shrink-0 text-muted-foreground" />}
                  </div>
                );

                return step.href ? (
                  <Link key={step.label} href={step.href}>{row}</Link>
                ) : (
                  <div key={step.label}>{row}</div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Suggested next step</p>
            <h2 className="text-2xl font-semibold mt-1">{nextStep.title}</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{nextStep.detail}</p>
          </div>
          <Link href={nextStep.href}>
            <Button size="lg" className="gap-2 sm:min-w-48">
              {nextStep.button}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: "Brand readiness", value: dashboard.hasBrandDna ? "Ready" : "Needs setup", href: `/clients/${clientId}/brand-dna`, icon: CheckCircle2 },
          { label: "Trend opportunities", value: "Research now", href: `/clients/${clientId}/research`, icon: Radar },
          { label: "Drafts needing review", value: String(dashboard.pendingApprovals), href: `/clients/${clientId}/drafts?tab=pending`, icon: FileText },
          { label: "Quick campaign", value: "Generate", href: `/clients/${clientId}/campaigns/generate`, icon: Sparkles },
        ].map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.label} href={action.href}>
              <Card className="group cursor-pointer hover:border-primary/35">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{action.label}</p>
                    <p className="mt-1 text-sm font-semibold">{action.value}</p>
                  </div>
                  <Icon className="h-5 w-5 text-primary transition-transform group-hover:scale-110" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <PipelineStep label="Drafts" count={dashboard.draftCount} icon={FileText} />
        <PipelineStep label="Review" count={dashboard.pendingApprovals} icon={CheckCircle2} />
        <PipelineStep label="Ready" count={dashboard.approvedCount} icon={Send} />
        <PipelineStep label="Scheduled" count={dashboard.scheduledCount} icon={Clock} />
        <PipelineStep label="Published" count={dashboard.publishedCount} icon={Globe} />
      </div>

      {dashboard.needsAttentionCount > 0 && (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-900">
                  {dashboard.needsAttentionCount} post{dashboard.needsAttentionCount === 1 ? "" : "s"} need attention
                </p>
                <p className="text-xs text-red-800/90 mt-0.5">
                  Publish attempts that fail stay visible with their reason so they can be retried, exported, or fixed.
                </p>
              </div>
            </div>
            <Link href={`/clients/${clientId}/queue`}>
              <Button variant="outline" size="sm" className="border-red-200 bg-white text-red-800 hover:bg-red-100">
                Review failures
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4 text-primary" />
            Analytics
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshAnalyticsMutation.mutate()}
            disabled={refreshAnalyticsMutation.isPending || (analytics?.publishedPosts ?? 0) === 0}
            className="h-8 gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshAnalyticsMutation.isPending && "animate-spin")} />
            Refresh metrics
          </Button>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          {!analytics || analytics.publishedPosts === 0 ? (
            <p className="text-sm text-muted-foreground">
              Published posts will appear here once they have a real published time. Metrics refresh only works for connected platform accounts.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {[
                ["Published posts", analytics.publishedPosts],
                ["Reach", analytics.reach],
                ["Impressions", analytics.impressions],
                ["Likes / reactions", analytics.likes],
                ["Comments", analytics.comments],
                ["Shares", analytics.shares],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold">{Number(value).toLocaleString()}</p>
                </div>
              ))}
              <div className="rounded-lg border bg-primary/5 p-3 sm:col-span-2 lg:col-span-6">
                <p className="text-xs text-muted-foreground">Engagement rate</p>
                <p className="mt-1 text-xl font-semibold">
                  {analytics.engagementRate === null ? "Not available yet" : `${analytics.engagementRate}%`}
                </p>
                {analytics.posts.some((post) => post.warning) && (
                  <p className="mt-1 text-xs text-amber-700">
                    Some published posts could not fetch metrics because the platform post ID or connector permission is not available yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Today + Upcoming Schedule + Active Storyline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Today */}
        <Card className="bg-card">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="w-4 h-4 text-primary" />
              Today
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {dashboard.todaysPosts.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nothing scheduled today.</div>
            ) : (
              <div className="space-y-1.5">
                {dashboard.todaysPosts.slice(0, 3).map(post => (
                  <div key={post.id} className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5">
                    <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                      {readableStatus(post.status)}
                    </Badge>
                    <p className="text-xs line-clamp-1 flex-1">{post.caption}</p>
                    {post.scheduledAt && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {format(new Date(post.scheduledAt), "h:mm a")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {nextOccasion && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Next Occasion</p>
                <p className="text-sm font-medium">{nextOccasion.title}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(nextOccasion.date), "MMM d")} · {nextOccasion.category}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Schedule */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" />
              Upcoming Schedule
            </CardTitle>
            <Link href={`/clients/${clientId}/calendar`} className="text-xs text-primary hover:underline flex items-center">
              Calendar <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {dashboard.upcomingPosts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No scheduled posts yet. Approved posts with dates will appear here.
              </div>
            ) : (
              <div className="space-y-1.5">
                {dashboard.upcomingPosts.slice(0, 4).map(post => (
                  <div key={post.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors">
                    <div className="shrink-0 text-center min-w-9">
                      {post.scheduledAt ? (
                        <>
                          <div className="text-xs font-bold text-primary">{format(new Date(post.scheduledAt), "MMM")}</div>
                          <div className="text-base font-bold leading-none">{format(new Date(post.scheduledAt), "d")}</div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">—</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-1">{post.caption || post.topic}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        {post.platform && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${PLATFORM_COLORS[post.platform] ?? "bg-muted text-muted-foreground"}`}>
                            {post.platform}
                          </span>
                        )}
                        {post.scheduledAt && (
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(post.scheduledAt), "h:mm a")}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[9px] uppercase shrink-0">
                      {readableStatus(post.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Storyline */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="w-4 h-4 text-primary" />
              Active Storyline
            </CardTitle>
            <Link href={`/clients/${clientId}/storylines`} className="text-xs text-primary hover:underline flex items-center">
              Manage <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {!dashboard.activeStoryline ? (
              <div className="text-sm text-muted-foreground">
                No active storyline yet.{" "}
                <Link href={`/clients/${clientId}/storylines`} className="text-primary hover:underline text-sm">
                  Create one
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{dashboard.activeStoryline.title}</h3>
                  <Badge variant="default" className="bg-primary/20 text-primary border-none text-[10px]">
                    Active
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                  {dashboard.activeStoryline.narrative}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity — combined recent posts + published */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Activity</h2>
          <Link
            href={`/clients/${clientId}/drafts`}
            className="text-sm text-primary flex items-center hover:underline"
          >
            View all <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>

        {activityItems.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground">
              No posts yet. Create a draft to start the workflow.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {activityItems.map(({ type, post }) => {
              if (type === "published") {
                return (
                  <Card key={`pub-${post.id}`} className="overflow-hidden flex flex-row h-11 border-green-100 bg-green-50/30">
                    <ActivityThumbnail src={post.selectedImageUrl} platform={post.platform} published />
                    <CardContent className="px-3 py-2 flex-1 overflow-hidden flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge className="text-[9px] px-1.5 py-0 bg-green-100 text-green-800 border-green-200 border font-medium">
                            Published
                          </Badge>
                          {post.platform && <span className="text-[10px] text-muted-foreground capitalize">{post.platform}</span>}
                        </div>
                        <p className="text-sm font-medium truncate leading-tight">{post.caption || post.topic}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {post.publishedAt && (
                          <span className="text-xs text-muted-foreground hidden sm:block">
                            {format(new Date(post.publishedAt), "MMM d")}
                          </span>
                        )}
                        {post.publishedUrl && (
                          <a
                            href={post.publishedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            View
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <Card key={post.id} className="overflow-hidden flex flex-row h-11">
                  <ActivityThumbnail src={post.selectedImageUrl} platform={post.platform} />
                  <CardContent className="px-3 py-2 flex-1 overflow-hidden flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 uppercase">
                          {readableStatus(post.status)}
                        </Badge>
                        {post.platform && <span className="text-[10px] text-muted-foreground capitalize">{post.platform}</span>}
                      </div>
                      <p className="text-sm font-medium truncate leading-tight">
                        {post.caption || post.topic}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                      {format(new Date(post.createdAt), "MMM d")}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
