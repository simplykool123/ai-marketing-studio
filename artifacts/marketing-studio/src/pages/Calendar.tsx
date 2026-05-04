import { useState, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListPosts, useUpdatePost } from "@workspace/api-client-react";
import type { Post } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  format,
  isSameDay,
  isAfter,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  getDay,
} from "date-fns";
import { CalendarClock, Clock, ChevronLeft, ChevronRight, GripVertical, Info, X } from "lucide-react";

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500/80",
  facebook: "bg-blue-500/80",
  twitter: "bg-sky-500/80",
  linkedin: "bg-indigo-500/80",
  blog: "bg-emerald-500/80",
  newsletter: "bg-amber-500/80",
};

const STATUS_DOT: Record<string, string> = {
  approved: "bg-emerald-400",
  scheduled: "bg-blue-400",
  published: "bg-purple-400",
  draft: "bg-yellow-400",
};

export default function Calendar() {
  const { clientId } = useParams<{ clientId: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: posts, isLoading } = useListPosts(clientId || "");
  const updateMutation = useUpdatePost();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [dropTargetDay, setDropTargetDay] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem("posting-mock-banner-dismissed") === "1"
  );

  const dismissBanner = () => {
    setBannerDismissed(true);
    try { window.localStorage.setItem("posting-mock-banner-dismissed", "1"); } catch {}
  };

  const scheduledPosts =
    posts?.filter(
      (p) =>
        p.clientId === clientId &&
        ["approved", "scheduled", "published"].includes(p.status ?? "")
    ) ?? [];

  const getPostsForDay = (day: Date) =>
    scheduledPosts.filter((p) => p.scheduledAt && isSameDay(new Date(p.scheduledAt), day));

  const now = new Date();
  const upcomingPosts = scheduledPosts
    .filter((p) => p.scheduledAt && isAfter(new Date(p.scheduledAt), now))
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 10);

  // Build calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);

  const calendarDays: Date[] = [];
  let day = calStart;
  while (day <= calEnd) {
    calendarDays.push(day);
    day = addDays(day, 1);
  }

  const handleDragStart = (e: React.DragEvent, postId: string) => {
    e.dataTransfer.setData("postId", postId);
    setDraggedPostId(postId);
  };

  const handleDragEnd = () => {
    setDraggedPostId(null);
    setDropTargetDay(null);
  };

  const handleDragOver = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetDay(dayKey);
  };

  const handleDragLeave = () => {
    setDropTargetDay(null);
  };

  const handleDrop = (e: React.DragEvent, targetDay: Date) => {
    e.preventDefault();
    const postId = e.dataTransfer.getData("postId");
    setDraggedPostId(null);
    setDropTargetDay(null);

    if (!postId) return;
    const post = scheduledPosts.find((p) => p.id === postId);
    if (!post) return;

    const existing = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
    const newDate = new Date(targetDay);
    newDate.setHours(existing.getHours(), existing.getMinutes(), 0, 0);

    updateMutation.mutate(
      {
        clientId: clientId ?? "",
        postId,
        data: { scheduledAt: newDate.toISOString() },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listPosts", clientId] });
          toast({
            title: "Post rescheduled",
            description: `Moved to ${format(newDate, "MMMM d, yyyy 'at' h:mm a")}`,
          });
        },
        onError: () =>
          toast({ title: "Reschedule failed", variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 mb-6" />
        <Skeleton className="h-[600px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Content Calendar</h1>
        <p className="text-muted-foreground mt-1">
          View and drag posts to reschedule them.
        </p>
      </div>

      {!bannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium">Scheduled posts won't auto-publish to social platforms yet.</p>
            <p className="text-xs text-amber-800/90 mt-0.5">
              The calendar tracks intended publish times, but real platform delivery isn't connected. Use Mock Post (Demo), Webhook Export, or Mark as Posted Manually from Drafts &amp; Posting Queue.
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Month grid */}
        <Card className="lg:col-span-2 bg-card">
          <CardContent className="p-4">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="font-semibold">
                {format(currentMonth, "MMMM yyyy")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="text-center text-xs font-medium text-muted-foreground py-1"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {calendarDays.map((d) => {
                const dayKey = format(d, "yyyy-MM-dd");
                const dayPosts = getPostsForDay(d);
                const isCurrentMonth = isSameMonth(d, currentMonth);
                const isDrop = dropTargetDay === dayKey;
                const isTodayDate = isToday(d);

                return (
                  <div
                    key={dayKey}
                    className={`bg-card min-h-[72px] p-1 transition-colors ${
                      !isCurrentMonth ? "opacity-40" : ""
                    } ${isDrop ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
                    onDragOver={(e) => handleDragOver(e, dayKey)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, d)}
                  >
                    <div
                      className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                        isTodayDate
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {format(d, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {dayPosts.slice(0, 2).map((post) => (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, post.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => setSelectedPost(post)}
                          className={`group relative text-[10px] px-1 py-0.5 rounded cursor-grab active:cursor-grabbing flex items-center gap-0.5 text-white truncate transition-opacity ${
                            PLATFORM_COLORS[post.platform ?? ""] ?? "bg-gray-500/80"
                          } ${draggedPostId === post.id ? "opacity-40" : "hover:opacity-90"}`}
                          title={post.caption ?? ""}
                        >
                          <GripVertical className="w-2.5 h-2.5 shrink-0 opacity-60" />
                          <span className="truncate">{post.caption?.slice(0, 18)}</span>
                        </div>
                      ))}
                      {dayPosts.length > 2 && (
                        <div className="text-[9px] text-muted-foreground px-1">
                          +{dayPosts.length - 2} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {Object.entries(PLATFORM_COLORS).map(([p, cls]) => (
                <div key={p} className="flex items-center gap-1">
                  <div className={`w-2.5 h-2.5 rounded-sm ${cls}`} />
                  <span className="text-[10px] text-muted-foreground capitalize">{p}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming sidebar */}
        <div className="space-y-4">
          <h3 className="font-semibold text-base border-b pb-2">Upcoming Posts</h3>
          {upcomingPosts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No upcoming scheduled posts.
            </p>
          ) : (
            <div className="space-y-2">
              {upcomingPosts.map((post) => (
                <Card
                  key={post.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, post.id)}
                  onDragEnd={handleDragEnd}
                  className={`cursor-grab active:cursor-grabbing hover:border-primary transition-colors bg-card ${
                    draggedPostId === post.id ? "opacity-40" : ""
                  }`}
                  onClick={() => setSelectedPost(post)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs font-medium text-primary">
                            {post.scheduledAt
                              ? format(new Date(post.scheduledAt), "MMM d, h:mm a")
                              : "No date"}
                          </span>
                          {post.platform && (
                            <Badge
                              variant="outline"
                              className="text-[9px] uppercase px-1 py-0"
                            >
                              {post.platform}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs line-clamp-2 text-foreground">
                          {post.caption}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {draggedPostId && (
            <div className="text-xs text-primary/70 text-center py-2 animate-pulse">
              Drop on a calendar day to reschedule
            </div>
          )}
        </div>
      </div>

      {/* Post detail dialog */}
      <Dialog open={!!selectedPost} onOpenChange={(open) => !open && setSelectedPost(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Post Details</DialogTitle>
          </DialogHeader>
          {selectedPost && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge variant="default" className="bg-primary">
                  {selectedPost.status}
                </Badge>
                {selectedPost.scheduledAt && (
                  <Badge variant="outline">
                    {format(new Date(selectedPost.scheduledAt), "PPP p")}
                  </Badge>
                )}
                {selectedPost.platform && (
                  <Badge variant="secondary" className="uppercase">
                    {selectedPost.platform}
                  </Badge>
                )}
              </div>
              {selectedPost.selectedImageUrl && (
                <img
                  src={selectedPost.selectedImageUrl}
                  alt=""
                  className="w-full rounded-md max-h-96 object-contain bg-muted"
                />
              )}
              <div className="space-y-2 bg-muted/30 p-4 rounded-md">
                <p className="whitespace-pre-wrap text-sm">{selectedPost.caption}</p>
                {selectedPost.hashtags && (
                  <p className="text-primary text-sm font-medium">{selectedPost.hashtags}</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
