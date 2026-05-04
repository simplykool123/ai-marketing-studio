import { useState } from "react";
import { useParams, Link } from "wouter";
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
  AlertCircle,
  Calendar,
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
} from "lucide-react";
import AiBrainWidget from "@/components/AiBrainWidget";

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
};

async function fetchDashboard(clientId: string): Promise<EnhancedDashboard> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/dashboard`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500/20 text-pink-400",
  facebook: "bg-blue-500/20 text-blue-400",
  linkedin: "bg-sky-500/20 text-sky-400",
  twitter: "bg-cyan-500/20 text-cyan-400",
  youtube: "bg-red-500/20 text-red-400",
};

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const icons: Record<string, React.ElementType> = {
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

export default function ClientDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setShowRecommendation] = useState(false);

  const { data: client, isLoading: isClientLoading } = useGetClient(clientId || "");

  const { data: dashboard, isLoading: isDashboardLoading } = useQuery({
    queryKey: ["enhanced-dashboard", clientId],
    queryFn: () => fetchDashboard(clientId!),
    enabled: !!clientId,
  });

  const recentlyPublished = dashboard?.recentlyPublished;

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">Dashboard for {client.name}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {!dashboard.hasBrandDna && (
            <Badge variant="destructive" className="gap-1 px-3 py-1">
              <AlertCircle className="w-3 h-3" />
              Missing Brand DNA
            </Badge>
          )}
          {dashboard.hasBrandDna && (
            <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border-none gap-1 px-3 py-1">
              <CheckCircle2 className="w-3 h-3" />
              Brand DNA Active
            </Badge>
          )}
          {dashboard.hasStoryline && (
            <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border-none gap-1 px-3 py-1">
              <CheckCircle2 className="w-3 h-3" />
              Storyline Active
            </Badge>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Posts</CardTitle>
            <LayoutDashboard className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totalPosts}</div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Approval</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="text-3xl font-bold">{dashboard.pendingApprovals}</div>
              {dashboard.pendingApprovals > 0 && (
                <Link href={`/clients/${clientId}/drafts`} className="text-xs text-primary hover:underline mb-1">
                  Review →
                </Link>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.scheduledCount}</div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Published</CardTitle>
            <Send className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.publishedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Connected Accounts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Connected Accounts</h2>
          <Link
            href={`/clients/${clientId}/social-accounts`}
            className="text-sm text-primary flex items-center hover:underline"
          >
            Manage <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>

        {!dashboard.connectedAccounts || dashboard.connectedAccounts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground">
              <Globe className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No social accounts connected yet.</p>
              <Link
                href={`/clients/${clientId}/social-accounts`}
                className="text-sm text-primary hover:underline mt-1 inline-block"
              >
                Connect accounts →
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-wrap gap-3">
            {dashboard.connectedAccounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-card shadow-sm"
              >
                <PlatformIcon platform={account.platform} className="w-4 h-4" />
                <div>
                  <p className="text-sm font-medium leading-tight">{account.accountName}</p>
                  {account.accountHandle && (
                    <p className="text-xs text-muted-foreground leading-tight">
                      {account.accountHandle}
                    </p>
                  )}
                </div>
                {account.followerCount != null && (
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {account.followerCount >= 1000
                      ? `${(account.followerCount / 1000).toFixed(1)}K`
                      : account.followerCount}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Recommendation + Today's Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI Recommendation Card */}
        <Card className="bg-card border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Recommendation
            </CardTitle>
            <p className="text-sm text-muted-foreground">What should we post next?</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <AiBrainWidget clientId={clientId ?? ""} />
          </CardContent>
        </Card>

        {/* Today's Content */}
        <Card className="bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="w-4 h-4 text-primary" />
              Today's Content
            </CardTitle>
            <p className="text-sm text-muted-foreground">{format(new Date(), "MMMM d, yyyy")}</p>
          </CardHeader>
          <CardContent>
            {dashboard.todaysPosts.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Nothing scheduled for today.
              </div>
            ) : (
              <div className="space-y-2">
                {dashboard.todaysPosts.map(post => (
                  <div key={post.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                    <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                      {post.status}
                    </Badge>
                    <p className="text-sm line-clamp-1 flex-1">{post.caption}</p>
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

      {/* Upcoming Schedule + Active Storyline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Schedule */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" />
              Upcoming Schedule
            </CardTitle>
            <Link href={`/clients/${clientId}/calendar`} className="text-xs text-primary hover:underline flex items-center">
              Calendar <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </CardHeader>
          <CardContent>
            {dashboard.upcomingPosts.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No upcoming scheduled posts.
              </div>
            ) : (
              <div className="space-y-2">
                {dashboard.upcomingPosts.map(post => (
                  <div key={post.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/30 transition-colors">
                    <div className="shrink-0 text-center min-w-[44px]">
                      {post.scheduledAt ? (
                        <>
                          <div className="text-xs font-bold text-primary">{format(new Date(post.scheduledAt), "MMM")}</div>
                          <div className="text-lg font-bold leading-none">{format(new Date(post.scheduledAt), "d")}</div>
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
                    <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
                      {post.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Storyline */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="w-4 h-4 text-primary" />
              Active Storyline
            </CardTitle>
            <Link href={`/clients/${clientId}/storylines`} className="text-xs text-primary hover:underline flex items-center">
              Manage <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </CardHeader>
          <CardContent>
            {!dashboard.activeStoryline ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No active storyline. <br />
                <Link href={`/clients/${clientId}/storylines`} className="text-primary hover:underline text-sm">
                  Create one →
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

      {/* Recently Published */}
      {recentlyPublished && recentlyPublished.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Recently Published</h2>
            <Link
              href={`/clients/${clientId}/queue`}
              className="text-sm text-primary flex items-center hover:underline"
            >
              View queue <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          <div className="space-y-2.5">
            {recentlyPublished.map((post: Post) => (
              <Card key={post.id} className="overflow-hidden flex flex-row h-16 border-green-100">
                {post.selectedImageUrl ? (
                  <div className="w-16 shrink-0 border-r border-border">
                    <img src={post.selectedImageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-16 shrink-0 bg-green-50 flex items-center justify-center border-r border-border">
                    {post.platform ? (
                      <PlatformIcon platform={post.platform} className="w-5 h-5 opacity-70" />
                    ) : (
                      <Send className="w-4 h-4 text-green-500 opacity-70" />
                    )}
                  </div>
                )}
                <CardContent className="p-3 flex-1 overflow-hidden flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate leading-tight">{post.caption || post.topic}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {post.platform && (
                        <span className="text-xs text-muted-foreground capitalize">{post.platform}</span>
                      )}
                      {post.publishedAt && (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(post.publishedAt), "MMM d, h:mm a")}
                        </span>
                      )}
                    </div>
                  </div>
                  {post.publishedUrl && (
                    <a
                      href={post.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary shrink-0 hover:underline flex items-center gap-1"
                    >
                      View →
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Recent Posts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Recent Posts</h2>
          <Link
            href={`/clients/${clientId}/drafts`}
            className="text-sm text-primary flex items-center hover:underline"
          >
            View all <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>

        {dashboard.recentPosts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              No posts yet. Start by generating some content!
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {dashboard.recentPosts.map((post) => (
              <Card key={post.id} className="overflow-hidden flex flex-row h-32">
                {post.selectedImageUrl ? (
                  <div className="w-32 shrink-0 border-r border-border">
                    <img
                      src={post.selectedImageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-32 shrink-0 bg-muted flex items-center justify-center border-r border-border">
                    <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                )}
                <CardContent className="p-4 flex-1 overflow-hidden flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {post.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(post.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
                    <p className="text-sm font-medium line-clamp-2 leading-tight">
                      {post.caption || post.topic}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
