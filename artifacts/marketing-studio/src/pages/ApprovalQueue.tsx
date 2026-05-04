import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListPosts,
  useApprovePost,
  useUpdatePost,
  rejectPost,
  bulkApprovePosts,
  autoSchedulePosts,
  getPostingRules,
} from "@workspace/api-client-react";
import type { Post, ApprovePostBodyPlatform } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  X,
  Pencil,
  CalendarClock,
  ListChecks,
  Zap,
  Clock,
  ImageIcon,
  Hash,
  CalendarDays,
} from "lucide-react";
import { format, addDays, startOfDay, setHours } from "date-fns";

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  facebook: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  twitter: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  linkedin: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  blog: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  newsletter: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const PLATFORM_BEST_HOURS: Record<string, number[]> = {
  instagram: [9, 12, 15, 18],
  facebook: [9, 13, 16],
  linkedin: [8, 12, 17],
  twitter: [8, 12, 17, 20],
  default: [9, 12, 15, 18],
};

function computeSuggestedTime(platform: string | null | undefined, preferredWindows: number[]): string {
  const windows = preferredWindows.length > 0
    ? preferredWindows
    : PLATFORM_BEST_HOURS[platform ?? ""] ?? PLATFORM_BEST_HOURS.default;
  const tomorrow = addDays(startOfDay(new Date()), 1);
  const suggested = setHours(tomorrow, windows[0] ?? 9);
  return suggested.toISOString().slice(0, 16);
}

export default function ApprovalQueue() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: allPosts, isLoading } = useListPosts(clientId ?? "");
  const pendingPosts = allPosts?.filter((p) => p.status === "draft") ?? [];

  const { data: postingRules } = useQuery({
    queryKey: ["postingRules", clientId],
    queryFn: () => getPostingRules(clientId ?? ""),
    enabled: !!clientId,
  });
  const preferredWindows = (postingRules?.preferredWindows as number[]) ?? [9, 12, 15, 18];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editHashtags, setEditHashtags] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");

  const [approvePost, setApprovePost] = useState<Post | null>(null);
  const [approveDate, setApproveDate] = useState("");
  const [approvePlatform, setApprovePlatform] = useState<string>("");
  const [bulkDate, setBulkDate] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 16)
  );
  const [autoScheduleResult, setAutoScheduleResult] = useState<{
    count: number;
    dryRun: boolean;
  } | null>(null);

  const approveMutation = useApprovePost();
  const updateMutation = useUpdatePost();

  const rejectMutation = useMutation({
    mutationFn: ({ postId }: { postId: string }) =>
      rejectPost(clientId ?? "", postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listPosts", clientId] });
      toast({ title: "Post rejected" });
    },
    onError: () => toast({ title: "Failed to reject post", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (postIds: string[]) =>
      bulkApprovePosts(clientId ?? "", {
        postIds,
        scheduledAt: bulkDate ? new Date(bulkDate).toISOString() : undefined,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["listPosts", clientId] });
      setSelected(new Set());
      toast({ title: `${data.count} post${data.count !== 1 ? "s" : ""} approved` });
    },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
  });

  const autoScheduleMutation = useMutation({
    mutationFn: (dryRun: boolean) =>
      autoSchedulePosts(clientId ?? "", { dryRun }),
    onSuccess: (data) => {
      if (!data.dryRun) {
        qc.invalidateQueries({ queryKey: ["listPosts", clientId] });
        toast({
          title: `Auto-scheduled ${data.count} post${data.count !== 1 ? "s" : ""}`,
          description: "Posts have been approved and scheduled.",
        });
      }
      setAutoScheduleResult({ count: data.count, dryRun: data.dryRun ?? false });
    },
    onError: () => toast({ title: "Auto-schedule failed", variant: "destructive" }),
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === pendingPosts.length) setSelected(new Set());
    else setSelected(new Set(pendingPosts.map((p) => p.id)));
  };

  const openEdit = (post: Post) => {
    setEditingPost(post);
    setEditCaption(post.caption ?? "");
    setEditHashtags(post.hashtags ?? "");
    setEditImageUrl(post.selectedImageUrl ?? "");
  };

  const openApprove = (post: Post) => {
    setApprovePost(post);
    setApprovePlatform(post.platform ?? "");
    setApproveDate(computeSuggestedTime(post.platform, preferredWindows));
  };

  const saveEdit = () => {
    if (!editingPost) return;
    updateMutation.mutate(
      {
        clientId: clientId ?? "",
        postId: editingPost.id,
        data: {
          caption: editCaption,
          hashtags: editHashtags,
          selectedImageUrl: editImageUrl || undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listPosts", clientId] });
          setEditingPost(null);
          toast({ title: "Post updated" });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      }
    );
  };

  const submitApprove = () => {
    if (!approvePost) return;
    approveMutation.mutate(
      {
        clientId: clientId ?? "",
        postId: approvePost.id,
        data: {
          scheduledAt: new Date(approveDate).toISOString(),
          ...(approvePlatform && approvePlatform !== "inherit"
            ? { platform: approvePlatform as ApprovePostBodyPlatform }
            : {}),
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listPosts", clientId] });
          setApprovePost(null);
          toast({ title: "Post approved & scheduled" });
        },
        onError: () => toast({ title: "Approve failed", variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Approval Queue</h1>
          <p className="text-muted-foreground mt-1">
            {pendingPosts.length} post{pendingPosts.length !== 1 ? "s" : ""} awaiting
            review
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <Input
                type="datetime-local"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                className="h-7 text-xs w-44"
              />
              <Button
                size="sm"
                onClick={() => bulkApproveMutation.mutate(Array.from(selected))}
                disabled={bulkApproveMutation.isPending}
              >
                <ListChecks className="w-3.5 h-3.5 mr-1.5" />
                Approve Selected
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => autoScheduleMutation.mutate(true)}
            disabled={autoScheduleMutation.isPending || pendingPosts.length === 0}
          >
            <Zap className="w-4 h-4 mr-2" />
            Preview Auto-Schedule
          </Button>
          <Button
            onClick={() => autoScheduleMutation.mutate(false)}
            disabled={autoScheduleMutation.isPending || pendingPosts.length === 0}
          >
            <CalendarClock className="w-4 h-4 mr-2" />
            Auto-Schedule All
          </Button>
        </div>
      </div>

      {/* Auto-schedule result banner */}
      {autoScheduleResult && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">
              {autoScheduleResult.dryRun
                ? `Preview: ${autoScheduleResult.count} posts would be scheduled`
                : `${autoScheduleResult.count} posts auto-scheduled successfully`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {autoScheduleResult.dryRun && (
              <Button
                size="sm"
                onClick={() => {
                  setAutoScheduleResult(null);
                  autoScheduleMutation.mutate(false);
                }}
              >
                Confirm
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoScheduleResult(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Select all row */}
      {pendingPosts.length > 0 && (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selected.size === pendingPosts.length && pendingPosts.length > 0}
            onCheckedChange={toggleAll}
            id="select-all"
          />
          <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
            Select all
          </label>
        </div>
      )}

      {/* Posts list */}
      {pendingPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCircle2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Queue is empty</h3>
          <p className="text-muted-foreground text-sm mb-4">
            All caught up! Generate content to fill the queue.
          </p>
          <Button variant="outline" onClick={() => navigate(`/clients/${clientId}/create`)}>
            Generate Content
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingPosts.map((post) => {
            const suggested = computeSuggestedTime(post.platform, preferredWindows);
            return (
              <Card
                key={post.id}
                className={`transition-all bg-card ${
                  selected.has(post.id) ? "ring-2 ring-primary" : ""
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    {/* Checkbox */}
                    <div className="pt-1 shrink-0">
                      <Checkbox
                        checked={selected.has(post.id)}
                        onCheckedChange={() => toggleSelect(post.id)}
                      />
                    </div>

                    {/* Image */}
                    {post.selectedImageUrl ? (
                      <div className="w-20 h-20 rounded-md overflow-hidden bg-muted shrink-0">
                        <img
                          src={post.selectedImageUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {post.platform && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase px-1.5 ${
                              PLATFORM_COLORS[post.platform] ?? ""
                            }`}
                          >
                            {post.platform}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] uppercase px-1.5">
                          {post.postType}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {format(new Date(post.createdAt), "MMM d, h:mm a")}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed line-clamp-3 mb-1">
                        {post.caption}
                      </p>
                      {post.hashtags && (
                        <p className="text-xs text-primary/70 line-clamp-1">
                          <Hash className="w-3 h-3 inline" />
                          {post.hashtags}
                        </p>
                      )}
                      {/* Suggested publish time */}
                      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="w-3 h-3" />
                        <span>
                          Suggested:{" "}
                          <span className="text-primary font-medium">
                            {format(new Date(suggested), "MMM d 'at' h:mm a")}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                        onClick={() => openApprove(post)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => openEdit(post)}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive hover:text-destructive"
                        onClick={() => rejectMutation.mutate({ postId: post.id })}
                        disabled={rejectMutation.isPending}
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Approve dialog — pre-populated with suggested time */}
      <Dialog open={!!approvePost} onOpenChange={(o) => !o && setApprovePost(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Schedule Date & Time</Label>
              <Input
                type="datetime-local"
                value={approveDate}
                onChange={(e) => setApproveDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Pre-filled from your posting rules preferred windows.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={approvePlatform} onValueChange={setApprovePlatform}>
                <SelectTrigger>
                  <SelectValue placeholder="Keep existing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Keep existing</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="twitter">Twitter</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="blog">Blog</SelectItem>
                  <SelectItem value="newsletter">Newsletter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {approvePost && (
              <div className="bg-muted/30 rounded-md p-3 text-sm text-muted-foreground line-clamp-3">
                {approvePost.caption}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovePost(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitApprove}
              disabled={approveMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Approve & Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog — includes image swap */}
      <Dialog open={!!editingPost} onOpenChange={(o) => !o && setEditingPost(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Image preview + swap */}
            <div className="space-y-1.5">
              <Label>Image</Label>
              {editImageUrl && (
                <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted mb-2">
                  <img
                    src={editImageUrl}
                    alt="Post image"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6 rounded-full"
                    onClick={() => setEditImageUrl("")}
                    title="Remove image"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={editImageUrl}
                  onChange={(e) => setEditImageUrl(e.target.value)}
                  placeholder="https://... (paste image URL to swap)"
                  className="text-sm"
                />
                {editImageUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditImageUrl("")}
                    title="Clear image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Caption</Label>
              <Textarea
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                rows={5}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hashtags</Label>
              <Input
                value={editHashtags}
                onChange={(e) => setEditHashtags(e.target.value)}
                placeholder="#marketing #social"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPost(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={updateMutation.isPending}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
