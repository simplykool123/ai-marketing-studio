import { useState } from "react";
import { useParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListPosts, useUpdatePost, getListPostsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Download,
  Trash2,
  XCircle,
  CheckCircle2,
  ImageIcon,
  Filter,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ImageItem = {
  id: string;
  clientId: string;
  postId: string;
  url: string;
  provider: string;
  status: string;
  type: string;
  prompt?: string | null;
  notes?: string | null;
  createdAt: string;
};

type FilterStatus = "all" | "selected" | "rejected" | "pending";
type FilterType = "all" | "generated" | "uploaded" | "logo" | "thumbnail" | "blog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchClientImages(clientId: string): Promise<ImageItem[]> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/images`);
  if (!res.ok) throw new Error("Failed to fetch images");
  return res.json();
}

async function updateImage(
  clientId: string,
  imageId: string,
  body: Partial<Pick<ImageItem, "status" | "type" | "notes">>
): Promise<ImageItem> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/images/${imageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update image");
  return res.json();
}

async function deleteImage(clientId: string, imageId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/images/${imageId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete image");
}

const TYPE_LABELS: Record<string, string> = {
  generated: "AI Generated",
  uploaded: "Uploaded",
  logo: "Logo",
  thumbnail: "Thumbnail",
  blog: "Blog",
};

const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Selected", value: "selected" },
  { label: "Pending", value: "pending" },
  { label: "Rejected", value: "rejected" },
];

const TYPE_FILTERS: { label: string; value: FilterType }[] = [
  { label: "All Types", value: "all" },
  { label: "AI Generated", value: "generated" },
  { label: "Uploaded", value: "uploaded" },
  { label: "Logos", value: "logo" },
  { label: "Thumbnails", value: "thumbnail" },
  { label: "Blog", value: "blog" },
];

export default function AssetLibrary() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");

  // For "Select for Post" dialog
  const [selectForPostImage, setSelectForPostImage] = useState<ImageItem | null>(null);

  const { data: images, isLoading } = useQuery({
    queryKey: ["client-images", clientId],
    queryFn: () => fetchClientImages(clientId!),
    enabled: !!clientId,
  });

  const { data: posts } = useListPosts(clientId || "");
  const updatePost = useUpdatePost();

  const updateMutation = useMutation({
    mutationFn: ({ imageId, updates }: { imageId: string; updates: Partial<Pick<ImageItem, "status" | "type" | "notes">> }) =>
      updateImage(clientId!, imageId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-images", clientId] });
      toast({ title: "Image updated" });
    },
    onError: () => toast({ title: "Failed to update image", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => deleteImage(clientId!, imageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-images", clientId] });
      toast({ title: "Image deleted" });
    },
    onError: () => toast({ title: "Failed to delete image", variant: "destructive" }),
  });

  const handleSelectForPost = (postId: string, imageUrl: string) => {
    if (!clientId) return;
    updatePost.mutate(
      { clientId, postId, data: { selectedImageUrl: imageUrl } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
          setSelectForPostImage(null);
          toast({ title: "Image attached to post" });
        },
        onError: () => toast({ title: "Failed to attach image", variant: "destructive" }),
      }
    );
  };

  const filtered = (images ?? []).filter(img => {
    const matchStatus = statusFilter === "all" || img.status === statusFilter;
    const matchType = typeFilter === "all" || (img.type || "generated") === typeFilter;
    return matchStatus && matchType;
  });

  const statusCounts = {
    all: images?.length ?? 0,
    selected: images?.filter(i => i.status === "selected").length ?? 0,
    pending: images?.filter(i => i.status === "pending").length ?? 0,
    rejected: images?.filter(i => i.status === "rejected").length ?? 0,
  };

  const draftPosts = posts?.filter(p => p.status === "draft") ?? [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-20" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-56" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Library</h1>
        <p className="text-muted-foreground mt-1">All generated and uploaded images for this client.</p>
      </div>

      {/* Status filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        {STATUS_FILTERS.map(f => (
          <Button
            key={f.value}
            variant={statusFilter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(f.value)}
            className="gap-1"
          >
            {f.label}
            <Badge
              variant="secondary"
              className={cn(
                "ml-1 px-1.5 py-0 text-[10px]",
                statusFilter === f.value && "bg-primary-foreground/20 text-primary-foreground"
              )}
            >
              {statusCounts[f.value]}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Type filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">Type:</span>
        {TYPE_FILTERS.map(f => (
          <Button
            key={f.value}
            variant={typeFilter === f.value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTypeFilter(f.value)}
            className="h-7 text-xs px-2"
          >
            {f.label}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No images found</h3>
            <p className="text-muted-foreground max-w-md">
              {statusFilter === "all" && typeFilter === "all"
                ? "Generate or upload images to see them here."
                : `No ${typeFilter !== "all" ? TYPE_LABELS[typeFilter] + " " : ""}${statusFilter !== "all" ? statusFilter : ""} images found.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(img => (
            <Card
              key={img.id}
              className={cn(
                "overflow-hidden group transition-all",
                img.status === "rejected" && "opacity-50"
              )}
            >
              <div className="relative aspect-square bg-muted overflow-hidden">
                <img
                  src={img.url}
                  alt={img.prompt ?? "Asset"}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 flex-wrap justify-center px-2">
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => window.open(img.url, "_blank")}
                      title="Download"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => setSelectForPostImage(img)}
                      title="Attach to a draft post"
                    >
                      <Link2 className="w-3 h-3" />
                    </Button>
                    {img.status !== "rejected" ? (
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-8 w-8"
                        onClick={() => updateMutation.mutate({ imageId: img.id, updates: { status: "rejected" } })}
                        title="Reject"
                      >
                        <XCircle className="w-3 h-3" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="secondary"
                        className="h-8 w-8"
                        onClick={() => updateMutation.mutate({ imageId: img.id, updates: { status: "pending" } })}
                        title="Restore"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-8 w-8"
                      onClick={() => deleteMutation.mutate(img.id)}
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {/* Status badge */}
                <div className="absolute top-2 left-2">
                  <Badge
                    variant={img.status === "selected" ? "default" : img.status === "rejected" ? "destructive" : "secondary"}
                    className="text-[9px] uppercase px-1.5"
                  >
                    {img.status}
                  </Badge>
                </div>
              </div>

              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1 flex-wrap">
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {TYPE_LABELS[img.type] ?? img.type ?? "generated"}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] uppercase opacity-70">
                      {img.provider}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(img.createdAt), "MMM d")}
                  </span>
                </div>
                {img.notes && (
                  <p className="text-[11px] text-muted-foreground leading-tight">{img.notes}</p>
                )}
                {!img.notes && img.prompt && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                    {img.prompt}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Select for Post dialog */}
      <Dialog open={!!selectForPostImage} onOpenChange={() => setSelectForPostImage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach to a Draft Post</DialogTitle>
          </DialogHeader>
          {draftPosts.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              No draft posts available. Create a draft first.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto py-2">
              {draftPosts.map(post => (
                <button
                  key={post.id}
                  className="w-full text-left rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors p-3"
                  onClick={() => handleSelectForPost(post.id, selectForPostImage!.url)}
                  disabled={updatePost.isPending}
                >
                  <p className="text-sm font-medium line-clamp-1">{post.topic}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{post.caption}</p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
