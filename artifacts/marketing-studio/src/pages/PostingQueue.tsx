import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useListPosts,
  getListPostsQueryKey,
  useUploadPostImage,
  useSaveImage,
  useUpdatePost,
  useGetClient,
} from "@workspace/api-client-react";
import ArtworkEditorDialog from "@/components/artwork/ArtworkEditorDialog";
import type { ArtworkLayers } from "@/components/artwork/types";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import {
  CheckCircle2, Clock, CalendarCheck, ListOrdered, PenLine,
  Send, Loader2, AlertCircle, PlayCircle, Workflow, Info, X, Link as LinkIcon, MoreHorizontal,
  Download, Copy, CalendarPlus, FileJson,
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

const QUEUE_STATUSES = ["approved", "export_ready", "scheduled", "failed", "posted", "published"];

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

function finalArtworkUrl(post: any): string {
  const schema = asRecord(post.contentSchema);
  return String(schema.finalArtworkUrl || post.selectedImageUrl || post.brandedImageUrl || schema.imageUrl || "");
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

async function autoScheduleApi(clientId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/auto-schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dryRun: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to auto-schedule ready posts");
  return data as { count: number; message?: string };
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

function artworkBaseImageUrl(post: any): string | null {
  const schema = asRecord(post.contentSchema);
  return schema.backgroundImageUrl || post.selectedImageUrl || schema.imageUrl || post.originalImageUrl || null;
}

function postImagePrompt(post: any): string {
  const schema = asRecord(post.contentSchema);
  return [schema.imagePrompt, schema.creativeDirection, schema.artworkDirection, schema.prompt, post.imagePrompt]
    .filter(Boolean).join(" ");
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
  if (post.status === "posted" || post.status === "published") return "Ready to post";
  return "Not posted yet";
}

function exportableStatus(post: any): string {
  return post.publishedAt ? "published" : post.status;
}

function buildExportPackage(clientName: string, posts: any[]) {
  return {
    clientName,
    exportedAt: new Date().toISOString(),
    totalItems: posts.length,
    posts: posts.map((post) => ({
      clientName,
      postId: post.id,
      platform: post.platform ?? "instagram",
      caption: post.caption ?? "",
      hashtags: post.hashtags ?? "",
      finalArtworkUrl: finalArtworkUrl(post),
      selectedImageUrl: post.selectedImageUrl ?? "",
      scheduledAt: post.scheduledAt ?? "",
      status: exportableStatus(post),
      createdAt: post.createdAt ?? "",
      contentType: post.contentType ?? post.postType ?? "social_post",
    })),
  };
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  const [artworkPost, setArtworkPost] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<"mark-posted" | "workflow" | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem("posting-mock-banner-dismissed") === "1"
  );

  const dismissBanner = () => {
    setBannerDismissed(true);
    try { window.localStorage.setItem("posting-mock-banner-dismissed", "1"); } catch {}
  };

  const uploadPostImage = useUploadPostImage();
  const saveImage = useSaveImage();
  const updatePost = useUpdatePost();

  const { data: posts = [], isLoading } = useListPosts(clientId ?? "");
  const { data: clientData } = useGetClient(clientId ?? "");
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

  const handleSaveArtwork = async (blob: Blob, layers: ArtworkLayers) => {
    if (!clientId || !artworkPost) return;
    const post = artworkPost;
    const schema = asRecord(post.contentSchema);
    const uploaded = await new Promise<{ url: string }>((resolve, reject) => {
      uploadPostImage.mutate(
        { clientId, data: { file: new File([blob], `artwork-${post.id}-${Date.now()}.png`, { type: "image/png" }) } },
        { onSuccess: resolve, onError: reject }
      );
    });
    await new Promise<void>((resolve, reject) => {
      saveImage.mutate(
        {
          clientId,
          postId: post.id,
          data: {
            url: uploaded.url,
            originalImageUrl: artworkBaseImageUrl(post) ?? undefined,
            brandedImageUrl: uploaded.url,
            provider: "openai",
            status: "selected",
            prompt: postImagePrompt(post) || "Final artwork rendered in Publish Queue",
          },
        },
        { onSuccess: () => resolve(), onError: reject }
      );
    });
    const nextSchema = {
      ...schema,
      backgroundImageUrl: schema.backgroundImageUrl || artworkBaseImageUrl(post) || undefined,
      artworkLayers: layers,
      finalArtworkUrl: uploaded.url,
    };
    await new Promise<void>((resolve, reject) => {
      updatePost.mutate(
        {
          clientId,
          postId: post.id,
          data: {
            selectedImageUrl: uploaded.url,
            contentSchema: nextSchema,
            contentSchemaVersion: post.contentSchema ? 1 : undefined,
          },
        },
        { onSuccess: () => resolve(), onError: reject }
      );
    });
    invalidate();
    toast({ title: "Final artwork saved" });
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
    onError: () => toast({ title: "Failed to simulate post", variant: "destructive" }),
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
      toast({ title: "Sent to workflow" });
    },
    onError: () => toast({ title: "Failed to send workflow", variant: "destructive" }),
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

  const autoScheduleMutation = useMutation({
    mutationFn: () => autoScheduleApi(clientId!),
    onSuccess: (result) => {
      invalidate();
      toast({
        title: result.count ? `Scheduled ${result.count} ready post${result.count === 1 ? "" : "s"}` : "Nothing to schedule",
        description: result.count ? "Ready posts were assigned schedule times. Nothing was published." : result.message ?? "No ready posts need scheduling.",
      });
    },
    onError: (err) => toast({
      title: "Auto-schedule failed",
      description: err instanceof Error ? err.message : "Could not schedule ready posts.",
      variant: "destructive",
    }),
  });

  const queuePosts = (posts as any[]).filter((post) => {
    if (!QUEUE_STATUSES.includes(post.status)) return false;
    if ((post.status === "posted" || post.status === "published") && !post.publishedAt) return false;
    return filter === "all" || post.status === filter;
  });

  const sortedPosts = [...queuePosts].sort((a, b) => {
    if (!a.scheduledAt && !b.scheduledAt) return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  const selectedPosts = sortedPosts.filter((post) => selectedIds.has(post.id));
  const readyPosts = sortedPosts.filter((post) => ["approved", "export_ready"].includes(post.status) && !post.scheduledAt);
  const clientName = clientData?.name ?? "Client";
  const allVisibleSelected = sortedPosts.length > 0 && sortedPosts.every((post) => selectedIds.has(post.id));

  const toggleSelected = (postId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(postId);
      else next.delete(postId);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const post of sortedPosts) {
        if (checked) next.add(post.id);
        else next.delete(post.id);
      }
      return next;
    });
  };

  const exportPosts = (items: any[], label = "selected") => {
    if (items.length === 0) {
      toast({ title: "No posts selected", description: "Select posts to export.", variant: "destructive" });
      return;
    }
    downloadJson(`${clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${label}-publish-package.json`, buildExportPackage(clientName, items));
    toast({ title: `Exported ${items.length} post${items.length === 1 ? "" : "s"}`, description: "JSON includes captions, artwork URLs, schedule, status, and content type." });
  };

  const copyCaptions = async (items: any[]) => {
    if (items.length === 0) {
      toast({ title: "No posts selected", description: "Select posts to copy captions.", variant: "destructive" });
      return;
    }
    const text = items.map((post) => [
      `[${PLATFORM_LABELS[post.platform] ?? post.platform ?? "Instagram"}] ${post.topic ?? "Untitled post"}`,
      post.caption ?? "",
      post.hashtags ?? "",
    ].filter(Boolean).join("\n")).join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${items.length} caption${items.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access is unavailable in this browser.", variant: "destructive" });
    }
  };

  const runBulkMarkPosted = async () => {
    if (!clientId || selectedPosts.length === 0) return;
    setBulkAction("mark-posted");
    try {
      await Promise.all(selectedPosts.map((post) => markPostedApi(clientId, post.id)));
      invalidate();
      setSelectedIds(new Set());
      toast({ title: `Marked ${selectedPosts.length} post${selectedPosts.length === 1 ? "" : "s"} as posted` });
    } catch (err) {
      invalidate();
      toast({
        title: "Bulk mark posted failed",
        description: err instanceof Error ? err.message : "One or more posts could not be marked posted.",
        variant: "destructive",
      });
    } finally {
      setBulkAction(null);
    }
  };

  const runBulkWorkflow = async () => {
    if (!clientId || selectedPosts.length === 0) return;
    setBulkAction("workflow");
    try {
      await Promise.all(selectedPosts.map((post) => webhookExportApi(clientId, post.id)));
      invalidate();
      toast({ title: `Sent ${selectedPosts.length} post${selectedPosts.length === 1 ? "" : "s"} to workflow` });
    } catch (err) {
      toast({
        title: "Workflow send failed",
        description: err instanceof Error ? err.message : "One or more posts could not be sent.",
        variant: "destructive",
      });
    } finally {
      setBulkAction(null);
    }
  };

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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Publish Queue</h1>
            <p className="text-muted-foreground mt-1">Approved posts wait here before publishing, exporting, or marking as posted.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => autoScheduleMutation.mutate()}
              disabled={autoScheduleMutation.isPending || readyPosts.length === 0}
              className="gap-1.5"
              title={readyPosts.length === 0 ? "No unscheduled ready posts" : "Schedule ready posts without publishing"}
            >
              {autoScheduleMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
              Auto-schedule ready posts
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPosts(sortedPosts, "queue")} disabled={sortedPosts.length === 0} className="gap-1.5">
              <FileJson className="w-3.5 h-3.5" />
              Export queue JSON
            </Button>
            <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All posts</SelectItem>
                <SelectItem value="approved">Ready</SelectItem>
                <SelectItem value="export_ready">Export ready</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
              <p className="text-sm text-muted-foreground mt-1">Approve drafts in Review to add them here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 font-medium">
                <Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => toggleAllVisible(checked === true)} />
                {selectedPosts.length ? `${selectedPosts.length} selected` : "Select posts for bulk actions"}
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => exportPosts(selectedPosts)} disabled={!selectedPosts.length} className="h-8 gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  Export selected
                </Button>
                <Button variant="outline" size="sm" onClick={() => copyCaptions(selectedPosts)} disabled={!selectedPosts.length} className="h-8 gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  Copy captions
                </Button>
                <Button variant="outline" size="sm" onClick={runBulkWorkflow} disabled={!selectedPosts.length || bulkAction !== null} className="h-8 gap-1.5">
                  {bulkAction === "workflow" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Workflow className="w-3.5 h-3.5" />}
                  Send to workflow
                </Button>
                <Button variant="outline" size="sm" onClick={runBulkMarkPosted} disabled={!selectedPosts.length || bulkAction !== null} className="h-8 gap-1.5">
                  {bulkAction === "mark-posted" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Mark posted
                </Button>
              </div>
            </div>
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
                    <Checkbox
                      checked={selectedIds.has(post.id)}
                      onCheckedChange={(checked) => toggleSelected(post.id, checked === true)}
                      aria-label={`Select ${post.topic}`}
                    />
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
                          hasPublishedProof && "bg-green-50 text-green-700 border-green-200",
                          isFailed && "bg-red-50 text-red-700"
                        )}>
                          {postStatusLabel(post)}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium truncate">{post.topic}</p>
                      <p className="text-xs text-muted-foreground truncate">{post.caption?.slice(0, 110)}{post.caption?.length > 110 ? "..." : ""}</p>
                      {post.hashtags && <p className="text-[11px] text-muted-foreground/80 truncate">{post.hashtags}</p>}
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

                    <div className="flex gap-1.5 shrink-0 flex-wrap justify-end max-w-[220px]">
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
                            Mark posted
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy}>
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setArtworkPost(post)}>
                                <PenLine className="w-3.5 h-3.5 mr-2" />
                                Edit Artwork
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/clients/${clientId}/drafts?tab=ready&postId=${post.id}`} className="flex items-center">
                                  <PenLine className="w-3.5 h-3.5 mr-2" />
                                  Edit in Review
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => mockPostMutation.mutate(post.id)}>
                                <PlayCircle className="w-3.5 h-3.5 mr-2" />
                                Simulate post (for testing)
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => webhookMutation.mutate(post.id)}>
                                <Workflow className="w-3.5 h-3.5 mr-2" />
                                Send to workflow
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => exportPosts([post], post.id)}>
                                <FileJson className="w-3.5 h-3.5 mr-2" />
                                Export JSON package
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

      <ArtworkEditorDialog
        open={!!artworkPost}
        onClose={() => setArtworkPost(null)}
        clientId={clientId || ""}
        clientLogoUrl={clientData?.logoUrl}
        post={artworkPost}
        onSave={handleSaveArtwork}
      />
    </div>
  );
}
