import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useListPosts,
  getListPostsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import {
  CheckCircle2, Clock, CalendarCheck, ListOrdered, PenLine,
  Send, Loader2, AlertCircle, PlayCircle, Webhook as WebhookIcon, Info, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  twitter: "bg-sky-50 text-sky-700 border-sky-200",
  linkedin: "bg-indigo-50 text-indigo-700 border-indigo-200",
  blog: "bg-amber-50 text-amber-700 border-amber-200",
  newsletter: "bg-violet-50 text-violet-700 border-violet-200",
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", twitter: "Twitter/X",
  linkedin: "LinkedIn", blog: "Blog", newsletter: "Newsletter",
};

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

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

function formatSchedule(dateStr?: string): { label: string; urgent: boolean } {
  if (!dateStr) return { label: "Unscheduled", urgent: false };
  const d = new Date(dateStr);
  if (isPast(d) && !isToday(d)) return { label: `Overdue — ${format(d, "MMM d")}`, urgent: true };
  if (isToday(d)) return { label: `Today at ${format(d, "h:mm a")}`, urgent: true };
  if (isTomorrow(d)) return { label: `Tomorrow at ${format(d, "h:mm a")}`, urgent: false };
  return { label: format(d, "MMM d, h:mm a"), urgent: false };
}

export default function PostingQueue() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "approved" | "scheduled" | "published" | "failed">("all");
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem("posting-mock-banner-dismissed") === "1"
  );

  const dismissBanner = () => {
    setBannerDismissed(true);
    try { window.localStorage.setItem("posting-mock-banner-dismissed", "1"); } catch {}
  };

  const { data: posts = [], isLoading } = useListPosts(
    clientId ?? "",
    { status: filter === "all" ? undefined : filter }
  );
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId!, {}) });

  const mockPostMutation = useMutation({
    mutationFn: (postId: string) => mockPostApi(clientId!, postId),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Demo post simulated",
        description: "Status was set to published locally — nothing was sent to any platform.",
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

  const sortedPosts = [...(posts as any[])].sort((a, b) => {
    if (!a.scheduledAt && !b.scheduledAt) return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {!bannerDismissed && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-medium">Real platform publishing isn't connected yet.</p>
              <p className="text-xs text-amber-800/90 mt-0.5">
                Actions here either simulate publishing (Mock Post Demo), export the post (JSON / Webhook), or mark it as posted manually. Nothing is delivered to Instagram, Facebook, LinkedIn, or any other network.
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
            <h1 className="text-2xl font-bold tracking-tight">Posting Queue</h1>
            <p className="text-muted-foreground mt-1">All scheduled and approved posts in order</p>
          </div>
          <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All posts</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="published">Published</SelectItem>
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
              const isPublished = post.status === "published";
              const canAct = ["approved", "scheduled", "failed"].includes(post.status);
              const isBusy =
                (mockPostMutation.isPending && mockPostMutation.variables === post.id) ||
                (markPostedMutation.isPending && markPostedMutation.variables === post.id) ||
                (webhookMutation.isPending && webhookMutation.variables === post.id);

              return (
                <Card key={post.id} className={cn(
                  "transition-shadow hover:shadow-sm",
                  schedule.urgent && post.status !== "published" && "border-amber-200",
                  isFailed && "border-red-200"
                )}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="text-sm font-medium text-muted-foreground w-5 shrink-0 text-center">
                      {idx + 1}
                    </div>

                    {post.selectedImageUrl ? (
                      <img src={post.selectedImageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 border border-border/50" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <CalendarCheck className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {post.platform && (
                          <Badge variant="outline" className={cn("text-xs", PLATFORM_COLORS[post.platform])}>
                            {PLATFORM_LABELS[post.platform] ?? post.platform}
                          </Badge>
                        )}
                        <Badge variant="outline" className={cn(
                          "text-xs",
                          isPublished && "bg-green-50 text-green-700",
                          post.status === "approved" && "bg-blue-50 text-blue-700",
                          isFailed && "bg-red-50 text-red-700"
                        )}>
                          {post.status}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium truncate">{post.topic}</p>
                      <p className="text-xs text-muted-foreground truncate">{post.caption?.slice(0, 80)}…</p>
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
                        {isPublished && post.publishedAt
                          ? format(new Date(post.publishedAt), "MMM d, h:mm a")
                          : schedule.label}
                      </div>
                    </div>

                    <div className="flex gap-1.5 shrink-0">
                      <Link href={`/clients/${clientId}/drafts`}>
                        <Button size="icon" variant="ghost" className="h-7 w-7">
                          <PenLine className="w-3.5 h-3.5" />
                        </Button>
                      </Link>

                      {canAct && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-amber-600 hover:text-amber-700"
                                onClick={() => mockPostMutation.mutate(post.id)}
                                disabled={isBusy}
                              >
                                {mockPostMutation.isPending && mockPostMutation.variables === post.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <PlayCircle className="w-3.5 h-3.5" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Mock Post (Demo) — simulated only</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-indigo-600 hover:text-indigo-700"
                                onClick={() => webhookMutation.mutate(post.id)}
                                disabled={isBusy}
                              >
                                {webhookMutation.isPending && webhookMutation.variables === post.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <WebhookIcon className="w-3.5 h-3.5" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Webhook Export — send payload to configured URL</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-green-600 hover:text-green-700"
                                onClick={() => markPostedMutation.mutate(post.id)}
                                disabled={isBusy}
                              >
                                {markPostedMutation.isPending && markPostedMutation.variables === post.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Send className="w-3.5 h-3.5" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Mark as Posted Manually — flag locally only</TooltipContent>
                          </Tooltip>
                        </>
                      )}

                      {isPublished && (
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
    </TooltipProvider>
  );
}
