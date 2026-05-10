import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useListPosts,
  getListPostsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import {
  CheckCircle2, Clock, CalendarCheck, ListOrdered, PenLine,
  Send, Loader2, AlertCircle, PlayCircle, Webhook as WebhookIcon, Info, X, Link as LinkIcon, MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  twitter: "bg-sky-50 text-sky-700 border-sky-200",
  linkedin: "bg-indigo-50 text-indigo-700 border-indigo-200",
  youtube: "bg-red-50 text-red-700 border-red-200",
  blog: "bg-amber-50 text-amber-700 border-amber-200",
  newsletter: "bg-violet-50 text-violet-700 border-violet-200",
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", twitter: "X/Twitter",
  linkedin: "LinkedIn", youtube: "YouTube", blog: "Blog", newsletter: "Newsletter",
};

const QUEUE_STATUSES = ["approved", "export_ready", "scheduled", "failed"];

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function postImageUrl(post: any): string | null {
  const schema = asRecord(post.contentSchema);
  return (
    schema.finalArtworkUrl ||
    post.selectedImageUrl ||
    post.brandedImageUrl ||
    post.originalImageUrl ||
    schema.imageUrl ||
    schema.artworkUrl ||
    schema.generatedImageUrl ||
    schema.backgroundImageUrl ||
    null
  );
}

function QueueImage({ post }: { post: any }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = postImageUrl(post);
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="w-12 h-12 rounded-lg object-cover shrink-0 border border-border/50"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
      <CalendarCheck className="w-5 h-5 text-muted-foreground" />
    </div>
  );
}

async function mockPostApi(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/${postId}/mock-post`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to simulate mock post");
  return res.json();
}

async function markPostedApi(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/${postId}/mark-posted`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to mark as posted");
  return res.json();
}

async function webhookExportApi(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/webhook/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId }),
  });
  if (!res.ok) throw new Error("Failed to webhook export");
  return res.json();
}

async function publishApi(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/${postId}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Publish failed");
  return data;
}

async function fetchSocialAccounts(clientId: string): Promise<Array<{ platform: string; isActive: boolean }>> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/social-accounts`);
  if (!res.ok) return [];
  return res.json();
}

function formatSchedule(dateStr?: string): { label: string; urgent: boolean } {
  if (!dateStr) return { label: "Ready — no date set yet", urgent: false };
  const d = new Date(dateStr);
  if (isPast(d) && !isToday(d)) return { label: `Overdue — ${format(d, "MMM d")}`, urgent: true };
  if (isToday(d)) return { label: `Today at ${format(d, "h:mm a")}`, urgent: true };
  if (isTomorrow(d)) return { label: `Tomorrow at ${format(d, "h:mm a")}`, urgent: false };
  return { label: format(d, "MMM d, h:mm a"), urgent: false };
}

function isNoAccountFailure(post: any): boolean {
  return post.status === "failed" && /no active .*account connected|no .*account connected/i.test(post.publishError ?? "");
}

function postStatusLabel(post: any): string {
  if ((post.status === "posted" || post.status === "published") && post.publishedAt) return "Published";
  if (post.status === "scheduled") return "Scheduled";
  if (isNoAccountFailure(post)) return "Failed: no account connected";
  if (post.status === "failed") return "Failed";
  if (post.status === "approved" || post.status === "export_ready") return "Ready to post";
  return "Not posted yet";
}

function PostTimeline({ post }: { post: any }) {
  const steps = [
    { label: "Created", value: post.createdAt },
    { label: "Approved", value: ["approved", "export_ready", "scheduled", "posted", "published", "failed"].includes(post.status) ? post.updatedAt : null },
    { label: "Scheduled", value: post.scheduledAt },
    {
      label: post.status === "failed" ? "Failed" : post.publishedAt ? "Published" : "Not posted yet",
      value: post.status === "failed" ? post.updatedAt : post.publishedAt,
    },
  ];

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {steps.map((step) => (
        <span key={step.label} className={cn(step.value && "text-foreground")}>
          {step.label}: {step.value ? format(new Date(step.value), "MMM d, h:mm a") : "—"}
        </span>
      ))}
    </div>
  );
}

export default function PostingQueue() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "approved" | "export_ready" | "scheduled" | "failed">("all");
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem("posting-mock-banner-dismissed") === "1"
  );

  const dismissBanner = () => {
    setBannerDismissed(true);
    try { window.localStorage.setItem("posting-mock-banner-dismissed", "1"); } catch {}
  };

  const { data: posts = [], isLoading } = useListPosts(clientId ?? "");
  const { data: socialAccounts = [] } = useQuery({
    queryKey: ["social-accounts", clientId],
    queryFn: () => fetchSocialAccounts(clientId!),
    enabled: !!clientId,
  });
  const invalidate = () => {
    if (!clientId) return;
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
    queryClient.invalidateQueries({ queryKey: ["enhanced-dashboard", clientId] });
  };

  const mockPostMutation = useMutation({
    mutationFn: (postId: string) => mockPostApi(clientId!, postId),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Demo post simulated",
        description: "Status was set to posted locally — nothing was sent to any platform.",
      });
    },
    onError: () => toast({ title: "Failed to simulate mock post", variant: "destructive" }),
  });

  const markPostedMutation = useMutation({
    mutationFn: (postId: string) => markPostedApi(clientId!, postId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Marked as posted manually" });
    },
    onError: () => toast({ title: "Failed to mark as posted", variant: "destructive" }),
  });

  const webhookMutation = useMutation({
    mutationFn: (postId: string) => webhookExportApi(clientId!, postId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Sent to configured webhook" });
    },
    onError: () => toast({ title: "Failed to webhook export", variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: (postId: string) => publishApi(clientId!, postId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Publish retry complete" });
    },
    onError: (err) => {
      invalidate();
      toast({
        title: "Publish retry failed",
        description: err instanceof Error ? err.message : "Connect an account and try again.",
        variant: "destructive",
      });
    },
  });

  const queuePosts = (posts as any[]).filter((post) =>
    QUEUE_STATUSES.includes(post.status) && (filter === "all" || post.status === filter)
  );

  const sortedPosts = [...queuePosts].sort((a, b) => {
    if (!a.scheduledAt && !b.scheduledAt) return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  return (
    <div className="space-y-6">
        {!bannerDismissed && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-medium">Direct platform publishing is not connected yet.</p>
              <p className="text-xs text-amber-800/90 mt-0.5">
                Approved and scheduled posts wait here. Nothing is posted automatically.
              </p>
            </div>
            <button
              onClick={dismissBanner}
              className="text-amber-700 hover:text-amber-900 shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Publish Queue</h1>
            <p className="text-muted-foreground mt-1">Approved drafts appear here before publishing.</p>
          </div>
          <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All posts</SelectItem>
              <SelectItem value="approved">Ready to post</SelectItem>
              <SelectItem value="export_ready">Ready to export</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : sortedPosts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <ListOrdered className="w-6 h-6 text-primary" />
              </div>
              <p className="font-medium">Queue is empty</p>
              <p className="text-sm text-muted-foreground mt-1">Approve drafts to add them to the queue.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {sortedPosts.map((post: any, idx: number) => {
              const schedule = formatSchedule(post.scheduledAt);
              const isFailed = post.status === "failed";
              const isPublished = post.status === "posted" || post.status === "published";
              const hasPublishedProof = isPublished && !!post.publishedAt;
              const noAccountFailure = isNoAccountFailure(post);
              const platform = post.platform ?? "instagram";
              const hasMatchingAccount = socialAccounts.some((account) => account.isActive && account.platform === platform);
              const canAct = ["approved", "export_ready", "scheduled", "failed"].includes(post.status);
              const isBusy =
                (mockPostMutation.isPending && mockPostMutation.variables === post.id) ||
                (markPostedMutation.isPending && markPostedMutation.variables === post.id) ||
                (webhookMutation.isPending && webhookMutation.variables === post.id) ||
                (publishMutation.isPending && publishMutation.variables === post.id);

              return (
                <Card key={post.id} className={cn(
                  "transition-shadow hover:shadow-sm",
                  schedule.urgent && !hasPublishedProof && "border-amber-200",
                  isFailed && "border-red-200"
                )}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="text-sm font-medium text-muted-foreground w-5 shrink-0 text-center">
                      {idx + 1}
                    </div>

                    <QueueImage post={post} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {post.platform && (
                          <Badge variant="outline" className={cn("text-xs", PLATFORM_COLORS[post.platform])}>
                            {PLATFORM_LABELS[post.platform] ?? post.platform}
                          </Badge>
                        )}
                        <Badge variant="outline" className={cn(
                          "text-xs",
                          post.status === "approved" && "bg-blue-50 text-blue-700",
                          post.status === "export_ready" && "bg-emerald-50 text-emerald-700",
                          post.status === "scheduled" && "bg-primary/10 text-primary",
                          isFailed && "bg-red-50 text-red-700"
                        )}>
                          {postStatusLabel(post)}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium truncate">{post.topic}</p>
                      <p className="text-xs text-muted-foreground truncate">{post.caption?.slice(0, 80)}…</p>
                      <PostTimeline post={post} />
                      {isFailed && post.publishError && (
                        <p className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{post.publishError}</span>
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0 hidden sm:block">
                      <div className={cn(
                        "flex items-center gap-1 text-xs",
                        schedule.urgent && !isPublished ? "text-amber-600 font-medium" : "text-muted-foreground"
                      )}>
                        <Clock className="w-3 h-3" />
                        {hasPublishedProof
                          ? format(new Date(post.publishedAt), "MMM d, h:mm a")
                          : schedule.label}
                      </div>
                    </div>

                    <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                      {canAct && (
                        <>
                          {(noAccountFailure || !hasMatchingAccount) && (
                            <Link href={`/clients/${clientId}/social-accounts`}>
                              <Button size="sm" variant="default" className="h-7 text-xs px-2">
                                <LinkIcon className="w-3.5 h-3.5 mr-1" />
                                Connect account
                              </Button>
                            </Link>
                          )}

                          {hasMatchingAccount && !hasPublishedProof && (
                            <Button
                              size="sm"
                              variant={isFailed ? "outline" : "default"}
                              className="h-7 text-xs px-2"
                              onClick={() => publishMutation.mutate(post.id)}
                              disabled={isBusy}
                            >
                              {publishMutation.isPending && publishMutation.variables === post.id
                                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                : <Send className="w-3.5 h-3.5 mr-1" />}
                              {isFailed ? "Retry Publish" : "Publish Now"}
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => markPostedMutation.mutate(post.id)}
                            disabled={isBusy}
                          >
                            {markPostedMutation.isPending && markPostedMutation.variables === post.id
                              ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              : <Send className="w-3.5 h-3.5 mr-1" />}
                            Mark as posted manually
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy}>
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/clients/${clientId}/drafts?tab=ready&postId=${post.id}`} className="flex items-center">
                                  <PenLine className="w-3.5 h-3.5 mr-2" />
                                  Edit in Review
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => mockPostMutation.mutate(post.id)}>
                                <PlayCircle className="w-3.5 h-3.5 mr-2" />
                                Mock Post (Demo)
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => webhookMutation.mutate(post.id)}>
                                <WebhookIcon className="w-3.5 h-3.5 mr-2" />
                                Webhook Export
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      )}

                      {hasPublishedProof && (
                        <CheckCircle2 className="w-4 h-4 text-green-500 m-1.5" />
                      )}
                      {isFailed && (
                        <AlertCircle className="w-4 h-4 text-red-500 m-1.5" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
    </div>
  );
}
