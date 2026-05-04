import { useState, type ReactNode } from "react";
import { useParams } from "wouter";
import {
  useListPosts,
  useApprovePost,
  useDeletePost,
  useUpdatePost,
  useRegeneratePostCopy,
  useGeneratePostImage,
  usePublishPost,
  getListPostsQueryKey,
  type UpdatePostBodyPlatform,
  type ApprovePostBodyPlatform,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import {
  CalendarIcon,
  Download,
  Trash2,
  CheckCircle,
  FileText,
  Copy,
  Send,
  Webhook,
  PlayCircle,
  ExternalLink,
  PenLine,
  PlusCircle,
  RefreshCw,
  ImagePlus,
  Loader2,
  Zap,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "blog", label: "Blog" },
];

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  twitter: "bg-sky-50 text-sky-700 border-sky-200",
  linkedin: "bg-indigo-50 text-indigo-700 border-indigo-200",
  blog: "bg-amber-50 text-amber-700 border-amber-200",
};

type Post = {
  id: string;
  topic: string;
  caption: string;
  hashtags?: string | null;
  selectedImageUrl?: string | null;
  status: string;
  platform?: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  clientId: string;
  updatedAt: string;
  generationStatus?: string | null;
  publishedAt?: string | null;
  publishedUrl?: string | null;
  publishError?: string | null;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function mockPost(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/${postId}/mock-post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to mock post");
  return res.json();
}

async function markPosted(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/${postId}/mark-posted`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to mark as posted");
  return res.json();
}

async function webhookExport(clientId: string, postId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/webhook/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId }),
  });
  if (!res.ok) throw new Error("Failed to webhook export");
  return res.json();
}

export default function Drafts() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: posts, isLoading } = useListPosts(clientId || "");
  const approvePost = useApprovePost();
  const deletePost = useDeletePost();
  const updatePost = useUpdatePost();
  const regenerateCopy = useRegeneratePostCopy();
  const generateImage = useGeneratePostImage();
  const publishPost = usePublishPost();

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [date, setDate] = useState<Date>();
  const [approvePlatform, setApprovePlatform] = useState("instagram");
  const [isApproveOpen, setIsApproveOpen] = useState(false);

  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTopic, setEditTopic] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editHashtags, setEditHashtags] = useState("");
  const [editPlatform, setEditPlatform] = useState("instagram");
  const [isEditSaving, setIsEditSaving] = useState(false);

  const [regeneratingPostId, setRegeneratingPostId] = useState<string | null>(null);
  const [generatingImagePostId, setGeneratingImagePostId] = useState<string | null>(null);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);

  const invalidatePosts = () => {
    if (clientId) queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
  };

  const drafts = (posts?.filter(p => p.status === "draft") || []) as Post[];
  const approved = (posts?.filter(p =>
    p.status === "approved" || p.status === "scheduled" || p.status === "failed"
  ) || []) as Post[];
  const published = (posts?.filter(p => p.status === "published") || []) as Post[];

  const openEdit = (post: Post) => {
    setEditingPost(post);
    setEditTopic(post.topic || "");
    setEditCaption(post.caption || "");
    setEditHashtags(post.hashtags || "");
    setEditPlatform(post.platform || "instagram");
  };

  const handleSaveEdit = async () => {
    if (!clientId || !editingPost) return;
    setIsEditSaving(true);
    try {
      await new Promise<void>((resolve, reject) => {
        updatePost.mutate(
          {
            clientId,
            postId: editingPost.id,
            data: {
              topic: editTopic,
              caption: editCaption,
              hashtags: editHashtags,
              platform: editPlatform as UpdatePostBodyPlatform,
            },
          },
          { onSuccess: () => resolve(), onError: reject }
        );
      });
      invalidatePosts();
      setEditingPost(null);
      toast({ title: "Post updated" });
    } catch {
      toast({ title: "Failed to update post", variant: "destructive" });
    } finally {
      setIsEditSaving(false);
    }
  };

  const mockPostMutation = useMutation({
    mutationFn: ({ postId }: { postId: string }) => mockPost(clientId!, postId),
    onSuccess: () => {
      invalidatePosts();
      toast({
        title: "Demo post simulated",
        description: "Status was set to published locally — nothing was sent to any platform.",
      });
    },
    onError: () => toast({ title: "Failed to simulate mock post", variant: "destructive" }),
  });

  const markPostedMutation = useMutation({
    mutationFn: ({ postId }: { postId: string }) => markPosted(clientId!, postId),
    onSuccess: () => {
      invalidatePosts();
      toast({ title: "Marked as posted manually" });
    },
    onError: () => toast({ title: "Failed to mark post", variant: "destructive" }),
  });

  const webhookMutation = useMutation({
    mutationFn: ({ postId }: { postId: string }) => webhookExport(clientId!, postId),
    onSuccess: (data) => {
      toast({ title: data.message ?? "Webhook export sent" });
    },
    onError: () => toast({ title: "Failed to webhook export", variant: "destructive" }),
  });

  const handleApprove = () => {
    if (!clientId || !selectedPostId || !date) return;
    approvePost.mutate(
      {
        clientId,
        postId: selectedPostId,
        data: { scheduledAt: date.toISOString(), platform: approvePlatform as ApprovePostBodyPlatform },
      },
      {
        onSuccess: () => {
          invalidatePosts();
          setIsApproveOpen(false);
          setSelectedPostId(null);
          setDate(undefined);
          toast({ title: "Post approved and scheduled" });
        },
        onError: () => toast({ title: "Failed to approve post", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (postId: string) => {
    if (!clientId) return;
    deletePost.mutate(
      { clientId, postId },
      {
        onSuccess: () => {
          invalidatePosts();
          toast({ title: "Post deleted" });
        },
        onError: () => toast({ title: "Failed to delete post", variant: "destructive" }),
      }
    );
  };

  const handleRegenerateCopy = (postId: string) => {
    if (!clientId) return;
    setRegeneratingPostId(postId);
    regenerateCopy.mutate(
      { clientId, postId },
      {
        onSuccess: () => {
          invalidatePosts();
          toast({ title: "Copy regenerated" });
          setRegeneratingPostId(null);
        },
        onError: () => {
          toast({ title: "Failed to regenerate copy", variant: "destructive" });
          setRegeneratingPostId(null);
        },
      }
    );
  };

  const handleGenerateImage = (postId: string) => {
    if (!clientId) return;
    setGeneratingImagePostId(postId);
    generateImage.mutate(
      { clientId, postId },
      {
        onSuccess: () => {
          invalidatePosts();
          toast({ title: "Image generated" });
          setGeneratingImagePostId(null);
        },
        onError: () => {
          toast({ title: "Failed to generate image", variant: "destructive" });
          setGeneratingImagePostId(null);
        },
      }
    );
  };

  const handlePublish = (postId: string) => {
    if (!clientId) return;
    setPublishingPostId(postId);
    publishPost.mutate(
      { clientId, postId },
      {
        onSuccess: (post) => {
          invalidatePosts();
          toast({
            title: "Post published!",
            description: post?.publishedUrl ? `View it live →` : undefined,
          });
          setPublishingPostId(null);
        },
        onError: (err: any) => {
          invalidatePosts();
          const msg = err?.response?.data?.error ?? "Publish failed";
          toast({ title: "Publish failed", description: msg, variant: "destructive" });
          setPublishingPostId(null);
        },
      }
    );
  };

  const handleCopyCaption = (caption: string, hashtags?: string | null) => {
    const text = [caption, hashtags].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Caption copied to clipboard" });
  };

  const handleExportAll = () => {
    if (!clientId) return;
    window.open(`${BASE}/api/clients/${clientId}/export/approved`, "_blank");
  };

  const handleExportSingle = (post: Post) => {
    const blob = new Blob(
      [JSON.stringify({
        id: post.id,
        topic: post.topic,
        caption: post.caption,
        hashtags: post.hashtags ?? "",
        selectedImageUrl: post.selectedImageUrl ?? "",
        platform: post.platform ?? "instagram",
        scheduledAt: post.scheduledAt ?? "",
        status: post.status,
        createdAt: post.createdAt,
      }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-${post.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAsset = (url: string) => {
    window.open(url, "_blank");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-[380px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  const PostActionBar = ({ post }: { post: Post }) => (
    <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs px-2"
        onClick={() => handleCopyCaption(post.caption, post.hashtags)}
      >
        <Copy className="w-3 h-3 mr-1" /> Copy
      </Button>
      {post.selectedImageUrl && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2"
          onClick={() => handleDownloadAsset(post.selectedImageUrl!)}
        >
          <Download className="w-3 h-3 mr-1" /> Asset
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs px-2"
        onClick={() => handleExportSingle(post)}
        title="Download this post's content as a JSON file"
      >
        <FileText className="w-3 h-3 mr-1" /> Export JSON
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs px-2"
        onClick={() => mockPostMutation.mutate({ postId: post.id })}
        disabled={mockPostMutation.isPending}
        title="Simulates publishing — does not deliver to any platform"
      >
        <PlayCircle className="w-3 h-3 mr-1" /> Mock Post (Demo)
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs px-2"
        onClick={() => markPostedMutation.mutate({ postId: post.id })}
        disabled={markPostedMutation.isPending}
        title="Flag this post as already posted by you elsewhere"
      >
        <Send className="w-3 h-3 mr-1" /> Mark as Posted Manually
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs px-2"
        onClick={() => webhookMutation.mutate({ postId: post.id })}
        disabled={webhookMutation.isPending}
        title="Send post payload to your configured webhook URL"
      >
        <Webhook className="w-3 h-3 mr-1" /> Webhook Export
      </Button>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drafts & Posts</h1>
          <p className="text-muted-foreground mt-1 text-sm">Review, edit, and schedule generated posts.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/clients/${clientId}/bulk-generate`}>
            <Button variant="outline" size="sm">
              <Zap className="w-4 h-4 mr-2" /> Bulk Generate
            </Button>
          </Link>
          <Link href={`/clients/${clientId}/manual`}>
            <Button variant="outline" size="sm">
              <PlusCircle className="w-4 h-4 mr-2" /> New Manual Post
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleExportAll} disabled={approved.length === 0}>
            <ExternalLink className="w-4 h-4 mr-2" /> Export JSON
          </Button>
        </div>
      </div>

      <Tabs defaultValue="drafts">
        <TabsList>
          <TabsTrigger value="drafts">
            Drafts
            {drafts.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {drafts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved
            {approved.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {approved.length}
              </Badge>
            )}
          </TabsTrigger>
          {published.length > 0 && (
            <TabsTrigger value="published">
              Published
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {published.length}
              </Badge>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Drafts Tab */}
        <TabsContent value="drafts" className="mt-6">
          {drafts.length === 0 ? (
            <Card className="border-dashed bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <h3 className="text-base font-semibold mb-1">No drafts yet</h3>
                <p className="text-muted-foreground text-sm max-w-sm mb-5">
                  Create a post using AI or write content manually — it will appear here for review.
                </p>
                <div className="flex gap-2 flex-wrap justify-center">
                  <Link href={`/clients/${clientId}/bulk-generate`}>
                    <Button size="sm"><Zap className="w-4 h-4 mr-2" /> Bulk Generate</Button>
                  </Link>
                  <Link href={`/clients/${clientId}/create`}>
                    <Button size="sm" variant="outline"><PlusCircle className="w-4 h-4 mr-2" /> Create with AI</Button>
                  </Link>
                  <Link href={`/clients/${clientId}/manual`}>
                    <Button size="sm" variant="outline"><PenLine className="w-4 h-4 mr-2" /> Manual Post</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {drafts.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={() => openEdit(post)}
                  onApprove={() => {
                    setSelectedPostId(post.id);
                    setApprovePlatform(post.platform || "instagram");
                    setIsApproveOpen(true);
                  }}
                  onDelete={() => handleDelete(post.id)}
                  onRegenerateCopy={() => handleRegenerateCopy(post.id)}
                  onGenerateImage={() => handleGenerateImage(post.id)}
                  isRegeneratingCopy={regeneratingPostId === post.id}
                  isGeneratingImage={generatingImagePostId === post.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Approved Tab */}
        <TabsContent value="approved" className="mt-6">
          {approved.length === 0 ? (
            <Card className="border-dashed bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <CheckCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No approved posts</h3>
                <p className="text-muted-foreground max-w-md">
                  Approve drafts to see them here and take publishing actions.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {approved.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={() => openEdit(post)}
                  onDelete={() => handleDelete(post.id)}
                  onPublish={() => handlePublish(post.id)}
                  isPublishing={publishingPostId === post.id}
                  actionBar={<PostActionBar post={post} />}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Published Tab */}
        {published.length > 0 && (
          <TabsContent value="published" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {published.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={() => openEdit(post)}
                  onDelete={() => handleDelete(post.id)}
                />
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Approve Dialog */}
      <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Approve & Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={approvePlatform} onValueChange={setApprovePlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Schedule Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <CalendarComponent mode="single" selected={date} onSelect={setDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsApproveOpen(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={!date || approvePost.isPending}>
              {approvePost.isPending ? "Scheduling…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingPost} onOpenChange={(open) => { if (!open) setEditingPost(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Topic</Label>
              <Input value={editTopic} onChange={(e) => setEditTopic(e.target.value)} placeholder="Post topic" />
            </div>
            <div className="space-y-1.5">
              <Label>Caption</Label>
              <Textarea
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                className="min-h-[140px] resize-none text-sm leading-relaxed"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hashtags</Label>
              <Input
                value={editHashtags}
                onChange={(e) => setEditHashtags(e.target.value)}
                placeholder="#tag1 #tag2"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={editPlatform} onValueChange={setEditPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingPost(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={isEditSaving || !editCaption.trim()}>
              {isEditSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PostCard({
  post,
  onEdit,
  onApprove,
  onDelete,
  onRegenerateCopy,
  onGenerateImage,
  onPublish,
  isRegeneratingCopy,
  isGeneratingImage,
  isPublishing,
  actionBar,
}: {
  post: Post;
  onEdit: () => void;
  onApprove?: () => void;
  onDelete: () => void;
  onRegenerateCopy?: () => void;
  onGenerateImage?: () => void;
  onPublish?: () => void;
  isRegeneratingCopy?: boolean;
  isGeneratingImage?: boolean;
  isPublishing?: boolean;
  actionBar?: ReactNode;
}) {
  const isDraft = post.status === "draft";
  const isApprovedOrScheduled = post.status === "approved" || post.status === "scheduled";
  const isFailed = post.status === "failed";
  const isPublished = post.status === "published";
  const platformClass = PLATFORM_COLORS[post.platform || ""] || "bg-muted text-muted-foreground";

  const statusBadgeClass = {
    draft: "",
    approved: "bg-blue-50 text-blue-700 border border-blue-200",
    scheduled: "bg-primary/10 text-primary border border-primary/20",
    published: "bg-green-50 text-green-700 border border-green-200",
    failed: "bg-red-50 text-red-700 border border-red-200",
  }[post.status] ?? "";

  return (
    <Card className="overflow-hidden flex flex-col group">
      <div className="aspect-square bg-muted relative">
        {post.selectedImageUrl ? (
          <img src={post.selectedImageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileText className="w-10 h-10 text-muted-foreground/20" />
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="w-7 h-7 rounded-full bg-background/90 backdrop-blur-sm border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors shadow-sm"
            title="Edit"
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="w-7 h-7 rounded-full bg-background/90 backdrop-blur-sm border border-border flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors shadow-sm"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {post.platform && (
          <div className={cn("absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full border", platformClass)}>
            {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
          </div>
        )}
        {isGeneratingImage && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="text-xs font-medium">Generating image…</span>
            </div>
          </div>
        )}
        {isPublishing && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="text-xs font-medium">Publishing…</span>
            </div>
          </div>
        )}
      </div>
      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-2">
          <Badge
            variant="secondary"
            className={cn("uppercase text-[10px] tracking-wider", statusBadgeClass)}
          >
            {post.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {format(new Date(post.createdAt), "MMM d")}
          </span>
        </div>
        {post.topic && <p className="text-xs text-muted-foreground font-medium mb-1 truncate">{post.topic}</p>}
        {isRegeneratingCopy ? (
          <div className="flex items-center gap-2 py-2 flex-1">
            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            <span className="text-sm text-muted-foreground">Regenerating copy…</span>
          </div>
        ) : (
          <>
            <p className="text-sm line-clamp-3 flex-1 leading-relaxed">{post.caption}</p>
            {post.hashtags && <p className="text-xs text-primary/70 mt-1.5 line-clamp-1">{post.hashtags}</p>}
          </>
        )}
        {post.scheduledAt && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <CalendarIcon className="w-3 h-3" />
            {format(new Date(post.scheduledAt), "MMM d, yyyy")}
          </p>
        )}

        {/* Publish error */}
        {isFailed && post.publishError && (
          <div className="mt-2 p-2 rounded-md bg-red-50 border border-red-100">
            <p className="text-xs text-red-700 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{post.publishError}</span>
            </p>
          </div>
        )}

        {/* Published link */}
        {isPublished && post.publishedUrl && (
          <a
            href={post.publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-xs text-primary flex items-center gap-1 hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> View live post
          </a>
        )}
        {isPublished && post.publishedAt && (
          <p className="text-xs text-muted-foreground mt-1">
            Published {format(new Date(post.publishedAt), "MMM d, h:mm a")}
          </p>
        )}

        {isDraft && (
          <div className="mt-3 space-y-2">
            {(onRegenerateCopy || onGenerateImage) && (
              <div className="flex gap-1.5">
                {onRegenerateCopy && (
                  <Button
                    variant="outline" size="sm"
                    className="flex-1 h-7 text-xs gap-1"
                    onClick={onRegenerateCopy}
                    disabled={isRegeneratingCopy || isGeneratingImage}
                    title="Regenerate caption and hashtags"
                  >
                    {isRegeneratingCopy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Redo Copy
                  </Button>
                )}
                {onGenerateImage && (
                  <Button
                    variant="outline" size="sm"
                    className="flex-1 h-7 text-xs gap-1"
                    onClick={onGenerateImage}
                    disabled={isRegeneratingCopy || isGeneratingImage}
                    title="Generate AI image for this post"
                  >
                    {isGeneratingImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />}
                    {post.selectedImageUrl ? "New Image" : "Gen Image"}
                  </Button>
                )}
              </div>
            )}
            {onApprove && (
              <Button className="w-full" size="sm" onClick={onApprove}>
                <CheckCircle className="w-4 h-4 mr-2" /> Approve & Schedule
              </Button>
            )}
          </div>
        )}

        {(isApprovedOrScheduled || isFailed) && onPublish && (
          <div className="mt-3">
            <Button
              className={cn("w-full", isFailed && "variant-outline border-red-200 hover:bg-red-50")}
              size="sm"
              variant={isFailed ? "outline" : "default"}
              onClick={onPublish}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publishing…</>
              ) : isFailed ? (
                <><RotateCcw className="w-4 h-4 mr-2" /> Retry Publish</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Publish Now</>
              )}
            </Button>
          </div>
        )}
        {actionBar}
      </CardContent>
    </Card>
  );
}
