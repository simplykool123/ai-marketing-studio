import { useState, type ElementType } from "react";
import { useParams, Link } from "wouter";
import { cn } from "@/lib/utils";
import { useGetClient, type Post } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText,
  CheckCircle2,
  Send,
  LayoutDashboard,
  ArrowRight,
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  Globe,
  Clock,
  Sparkles,
  CalendarDays,
  BookOpen,
  Image as ImageIcon,
  Circle,
  AlertCircle,
  Database,
  Flag,
  ListOrdered,
  Workflow,
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

async function fetchDashboard(clientId: string): Promise<EnhancedDashboard> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/dashboard`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
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
  }> = [
    {
      label: "Brand Setup complete",
      done: dashboard.hasBrandDna,
      href: `/clients/${clientId}/brand-dna`,
    },
    {
      label: "AI provider configured",
      done: dashboard.aiProviderConfigured,
      href: "/settings",
      hint: "Add API key in Settings",
      doneHint: dashboard.aiProvider ? `${dashboard.aiProvider} ready` : "AI ready",
    },
    {
      label: "Storage configured",
      done: dashboard.storageReady,
      hint: dashboard.storageStatusMessage ?? "Supabase Storage needs developer/admin setup",
      doneHint: dashboard.storageStatusMessage ?? "Uploads working",
    },
    {
      label: "First draft created",
      done: dashboard.totalPosts > 0,
      href: `/clients/${clientId}/create`,
    },
    {
      label: "First post approved",
      done: dashboard.approvedCount > 0 || dashboard.publishedCount > 0,
      href: `/clients/${clientId}/drafts?tab=ready`,
    },
  ];
  const setupComplete = setupSteps.filter((s) => s.done).length;
  const allDone = setupComplete === setupSteps.length;
  const collapsedSetup = setupComplete >= 3;
  const visibleSetupSteps = collapsedSetup ? setupSteps.filter((step) => !step.done) : setupSteps;
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
  const renderSetupStep = (step: (typeof setupSteps)[number]) => {
    const row = (
      <div className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
        step.done ? "opacity-60" : step.href ? "hover:bg-primary/10 cursor-pointer" : ""
      )}>
        {step.done ? (
          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className={cn("text-sm flex-1", step.done && "line-through text-muted-foreground")}>
          {step.label}
        </span>
        {step.done && step.doneHint && (
          <span className="text-xs text-muted-foreground">{step.doneHint}</span>
        )}
        {!step.done && step.hint && (
          <span className="text-xs text-muted-foreground">{step.hint}</span>
        )}
        {!step.done && step.href && (
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </div>
    );

    return step.href ? (
      <Link key={step.label} href={step.href}>
        {row}
      </Link>
    ) : (
      <div key={step.label}>{row}</div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 rounded-xl border bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/50">Agency Command Center</p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2">{client.name}</h1>
          <p className="text-white/70 mt-1 max-w-2xl">
            One operating view for strategy, draft production, review, publishing readiness, and AI learning.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill ok={dashboard.aiProviderConfigured} label={dashboard.aiProviderConfigured ? "AI ready" : "AI setup needed"} />
          <StatusPill ok={dashboard.hasBrandDna} label={dashboard.hasBrandDna ? "Brand ready" : "Brand incomplete"} />
          <StatusPill ok={publishingReady} label={publishingReady ? "Destination ready" : "Export/manual only"} />
        </div>
      </div>

      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next step</p>
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

      <div className="grid gap-3 md:grid-cols-5">
        <PipelineStep label="Drafts" count={dashboard.draftCount} icon={FileText} />
        <PipelineStep label="Review" count={dashboard.pendingApprovals} icon={CheckCircle2} />
        <PipelineStep label="Ready" count={dashboard.approvedCount} icon={Send} />
        <PipelineStep label="Scheduled" count={dashboard.scheduledCount} icon={Clock} />
        <PipelineStep label="Published" count={dashboard.publishedCount} icon={Globe} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI readiness</p>
            <p className="mt-1 text-sm font-medium">
              {dashboard.aiProviderConfigured ? "AI is ready" : "AI needs setup"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dashboard.aiProviderConfigured
                ? `${dashboard.aiProvider ?? "Provider"} key is saved in Settings.`
                : "Add and test your provider key in Settings."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand Setup</p>
            <p className="mt-1 text-sm font-medium">
              {dashboard.hasBrandDna ? "Brand DNA is active" : "Brand inputs missing"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Brand voice, pillars, and visuals improve every AI suggestion.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Publishing readiness</p>
            <p className="mt-1 text-sm font-medium">
              {publishingReady ? "Destination connected" : "Manual export only"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasSocialAccount ? "Social account connected." : hasWorkflow ? "Workflow URL configured." : "No social account or workflow URL connected yet."}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Campaign Planner", href: `/clients/${clientId}/campaigns/generate`, icon: Flag },
          { label: "Marketing Calendar", href: `/clients/${clientId}/marketing-calendar`, icon: CalendarDays },
          { label: "Review", href: `/clients/${clientId}/drafts?tab=pending`, icon: CheckCircle2 },
          { label: "Publish Queue", href: `/clients/${clientId}/queue`, icon: ListOrdered },
          { label: "AI Memory", href: `/clients/${clientId}/memory`, icon: Database },
        ].map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.label} href={action.href}>
              <Button variant="outline" className="h-11 w-full justify-start gap-2 bg-background">
                <Icon className="w-4 h-4 text-primary" />
                {action.label}
              </Button>
            </Link>
          );
        })}
      </div>

      {/* Setup checklist */}
      {!allDone && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                Getting Started
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {setupComplete} / {setupSteps.length} complete{collapsedSetup ? " · showing remaining" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            <div className="grid gap-1 md:grid-cols-2">
              {visibleSetupSteps.map(renderSetupStep)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card">
          <CardContent className="flex items-center justify-between p-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Posts</p>
              <div className="text-2xl font-semibold">{dashboard.totalPosts}</div>
            </div>
            <LayoutDashboard className="w-4 h-4 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="flex items-center justify-between p-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Pending Review</p>
              <div className="flex items-end gap-2">
                <div className="text-2xl font-semibold">{dashboard.pendingApprovals}</div>
                {dashboard.pendingApprovals > 0 && (
                  <Link href={`/clients/${clientId}/drafts?tab=pending`} className="text-xs text-primary hover:underline mb-1">
                    Review
                  </Link>
                )}
              </div>
            </div>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="flex items-center justify-between p-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Scheduled</p>
              <div className="text-2xl font-semibold">{dashboard.scheduledCount}</div>
            </div>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="flex items-center justify-between p-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Published</p>
              <div className="text-2xl font-semibold">{dashboard.publishedCount}</div>
            </div>
            <Send className="w-4 h-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className={cn("bg-card", !publishingReady && "border-amber-200 bg-amber-50/40")}>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {publishingReady ? <Workflow className="w-4 h-4 text-primary" /> : <AlertCircle className="w-4 h-4 text-amber-600" />}
              Publishing Destination
            </CardTitle>
            <Link href={`/clients/${clientId}/social-accounts`} className="text-xs text-primary hover:underline flex items-center">
              Manage <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {!publishingReady ? (
              <p className="text-sm text-muted-foreground">
                No social account or workflow URL connected. Export packages and manual mark-posted are still available.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hasWorkflow && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Workflow URL</Badge>}
                {dashboard.connectedAccounts.slice(0, 4).map((account) => (
                  <div key={account.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                    <PlatformIcon platform={account.platform} className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{account.accountName}</span>
                  </div>
                ))}
                {dashboard.connectedAccounts.length > 4 && (
                  <Badge variant="secondary" className="text-[10px]">+{dashboard.connectedAccounts.length - 4}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="w-4 h-4 text-primary" />
              Upcoming Occasion
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {nextOccasion ? (
              <>
                <p className="text-sm font-medium">{nextOccasion.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(nextOccasion.date), "MMM d")} · {nextOccasion.category}
                  {nextOccasion.requiresYearlyUpdate ? " · verify yearly" : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming curated occasions.</p>
            )}
            <Link href={`/clients/${clientId}/marketing-calendar`}>
              <Button size="sm" variant="outline" className="mt-3 gap-2">
                Open Calendar
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Ideas
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            <p className="text-sm text-muted-foreground">
              Open AI Ideas for fresh angles based on this client’s memory and recent content.
            </p>
            <Link href={`/clients/${clientId}/brain`}>
              <Button size="sm" variant="outline" className="mt-3 gap-2">
                Open AI Ideas
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="w-4 h-4 text-primary" />
              Today's Content
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {dashboard.todaysPosts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Nothing scheduled for today.
              </div>
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
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-card px-4 py-3">
        <p className="text-sm font-medium">Main workflow</p>
        <p className="text-xs text-muted-foreground mt-1">
          Brand Setup → AI Ideas / Storyline → Campaign Planner / Marketing Calendar → Review → Edit Artwork → Publish Queue → AI Memory.
        </p>
      </div>

      {/* Upcoming Schedule + Active Storyline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
                          {post.status}
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
