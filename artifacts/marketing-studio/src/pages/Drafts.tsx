import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearch } from "wouter";
import {
  useListPosts,
  useApprovePost,
  useDeletePost,
  useUpdatePost,
  useRegeneratePostCopy,
  useGeneratePostImage,
  usePublishPost,
  useUploadPostImage,
  useSaveImage,
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
  Eye,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "blog", label: "Blog" },
  { value: "newsletter", label: "Newsletter" },
];

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  twitter: "bg-sky-50 text-sky-700 border-sky-200",
  linkedin: "bg-indigo-50 text-indigo-700 border-indigo-200",
  youtube: "bg-red-50 text-red-700 border-red-200",
  blog: "bg-amber-50 text-amber-700 border-amber-200",
  newsletter: "bg-violet-50 text-violet-700 border-violet-200",
};

type Post = {
  id: string;
  topic: string;
  caption: string;
  hashtags?: string | null;
  selectedImageUrl?: string | null;
  originalImageUrl?: string | null;
  brandedImageUrl?: string | null;
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
  qualityScore?: number | null;
  qualityReport?: unknown;
  campaignId?: string | null;
  skillId?: string | null;
  contentType?: string | null;
  contentSchema?: unknown;
  generationMetadata?: unknown;
  title?: string | null;
  longFormBody?: string | null;
  imagePrompt?: string | null;
  postType?: string | null;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CONTENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "social", label: "Social" },
  { value: "blog", label: "Blog" },
  { value: "newsletter", label: "Newsletter" },
  { value: "image", label: "Image prompts/assets" },
  { value: "video", label: "Video scripts" },
] as const;

const REJECT_CATEGORIES = [
  { value: "off_brand_voice", label: "Off-brand voice" },
  { value: "off_strategy", label: "Off strategy" },
  { value: "poor_quality", label: "Poor quality" },
  { value: "wrong_format", label: "Wrong format" },
  { value: "wrong_timing", label: "Wrong timing" },
  { value: "too_similar_to_past", label: "Too similar to past" },
  { value: "other", label: "Other" },
];

const MAX_IMAGE_GENERATIONS = 3;

function hasPublishedProof(post: Post): boolean {
  return (post.status === "posted" || post.status === "published") && !!post.publishedAt;
}

function displayStatus(post: Post): string {
  if (hasPublishedProof(post)) return "published";
  if ((post.status === "posted" || post.status === "published") && !post.publishedAt) return "not posted yet";
  if (post.status === "export_ready") return "ready to post";
  if (post.status === "failed" && /no active .*account connected|no .*account connected/i.test(post.publishError ?? "")) {
    return "failed - no social account";
  }
  return post.status;
}

type ContentFilter = typeof CONTENT_FILTERS[number]["value"];
type ReviewTab = "pending" | "drafts" | "ready" | "history";

function getReviewTab(value: string | null): ReviewTab {
  return value === "drafts" || value === "ready" || value === "history" ? value : "pending";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function postImageUrl(post: Post): string | null {
  const schema = asRecord(post.contentSchema);
  return (
    schema.finalArtworkUrl ||
    post.selectedImageUrl ||
    schema.backgroundImageUrl ||
    post.originalImageUrl ||
    schema.imageUrl ||
    post.brandedImageUrl ||
    schema.artworkUrl ||
    schema.generatedImageUrl ||
    null
  );
}

function artworkBaseImageUrl(post: Post): string | null {
  const schema = asRecord(post.contentSchema);
  return schema.backgroundImageUrl || post.selectedImageUrl || schema.imageUrl || post.originalImageUrl || null;
}

function postImagePrompt(post: Post): string {
  const schema = asRecord(post.contentSchema);
  return [schema.imagePrompt, schema.creativeDirection, schema.artworkDirection, schema.prompt, post.imagePrompt]
    .filter(Boolean)
    .join(" ");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function asHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function artworkLogoUrl(post: Post): string | null {
  const schema = asRecord(post.contentSchema);
  const logo = asRecord(schema.logo);
  const layers = asRecord(schema.artworkLayers);
  return firstString(layers.logoUrl, logo.url, schema.logoUrl, schema.brandLogoUrl);
}

function artworkBrandName(post: Post): string | null {
  const schema = asRecord(post.contentSchema);
  return firstString(schema.brandName, schema.clientName);
}

function artworkFrameColor(post: Post): string {
  const schema = asRecord(post.contentSchema);
  const layers = asRecord(schema.artworkLayers);
  const colors = Array.isArray(schema.brandColorsUsed) ? schema.brandColorsUsed : [];
  return asHexColor(layers.frameColor, asHexColor(colors[2], asHexColor(colors[0], "#f59e0b")));
}

function artworkPanelColor(post: Post): string {
  const schema = asRecord(post.contentSchema);
  const layers = asRecord(schema.artworkLayers);
  const colors = Array.isArray(schema.brandColorsUsed) ? schema.brandColorsUsed : [];
  return asHexColor(layers.panelColor, asHexColor(colors[0], "#111827"));
}

function loadCanvasImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image for artwork render"));
    image.src = url;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, size: number) {
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapCanvasLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

async function renderArtworkPng(params: {
  post: Post;
  headline: string;
  subline: string;
  logoEnabled: boolean;
  frameColor: string;
}) {
  const size = 1080;
  const sourceUrl = artworkBaseImageUrl(params.post);
  if (!sourceUrl) throw new Error("No background image is available for this artwork.");

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not render artwork.");

  const background = await loadCanvasImage(sourceUrl);
  drawCover(ctx, background, size);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 0, size, size);

  ctx.lineWidth = 12;
  ctx.strokeStyle = params.frameColor;
  roundedRect(ctx, 42, 42, 996, 996, 34);
  ctx.stroke();

  ctx.fillStyle = artworkPanelColor(params.post);
  ctx.globalAlpha = 0.92;
  roundedRect(ctx, 76, 644, 928, 326, 30);
  ctx.fill();
  ctx.globalAlpha = 1;

  const logoUrl = artworkLogoUrl(params.post);
  if (params.logoEnabled && logoUrl) {
    try {
      const logo = await loadCanvasImage(logoUrl);
      const boxWidth = 150;
      const boxHeight = 84;
      const scale = Math.min(boxWidth / logo.naturalWidth, boxHeight / logo.naturalHeight);
      const width = logo.naturalWidth * scale;
      const height = logo.naturalHeight * scale;
      ctx.drawImage(logo, 76 + (boxWidth - width) / 2, 76 + (boxHeight - height) / 2, width, height);
    } catch {
      // If the logo cannot be loaded cross-origin, keep the final artwork renderable.
    }
  } else if (params.logoEnabled) {
    const brandName = artworkBrandName(params.post);
    if (brandName) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 34px Inter, Arial, sans-serif";
      ctx.fillText(brandName, 76, 122);
    }
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 76px Inter, Arial, sans-serif";
  const headlineLines = wrapCanvasLines(ctx, params.headline, 840, 2);
  headlineLines.forEach((line, index) => ctx.fillText(line, 120, 740 + index * 82));

  ctx.font = "400 34px Inter, Arial, sans-serif";
  const sublineStart = 780 + Math.max(0, headlineLines.length - 1) * 82;
  const sublineLines = wrapCanvasLines(ctx, params.subline, 820, 3);
  sublineLines.forEach((line, index) => ctx.fillText(line, 120, sublineStart + index * 42));

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export artwork PNG."));
    }, "image/png");
  });
}

function dateFromIsoDay(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const dateOnly = value.trim().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
    ? new Date(`${dateOnly}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function occasionScheduleDate(post: Post): Date | undefined {
  const schema = asRecord(post.contentSchema);
  const metadata = asRecord(post.generationMetadata);
  return dateFromIsoDay(schema.occasionDate) ?? dateFromIsoDay(metadata.occasionDate);
}

function suggestedScheduleDate(post: Post): Date {
  const occasionDate = occasionScheduleDate(post);
  if (occasionDate) return occasionDate;
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() >= 18) date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function contentTypeLabel(post: Post): string {
  return (post.contentType || post.postType || "social_post").replace(/_/g, " ");
}

function contentGroup(post: Post): ContentFilter {
  const type = `${post.contentType ?? ""} ${post.postType ?? ""} ${post.platform ?? ""}`.toLowerCase();
  if (type.includes("blog")) return "blog";
  if (type.includes("newsletter")) return "newsletter";
  if (type.includes("video")) return "video";
  if (type.includes("image")) return "image";
  return "social";
}

function schemaPreview(post: Post): string {
  const schema = asRecord(post.contentSchema);
  const type = contentGroup(post);
  if (type === "blog") {
    return [schema.seoTitle, schema.metaDescription, schema.fullDraft, post.longFormBody, post.caption].filter(Boolean).join(" ");
  }
  if (type === "newsletter") {
    return [schema.subject, schema.preheader, ...(Array.isArray(schema.sections) ? schema.sections : []), post.caption].filter(Boolean).join(" ");
  }
  if (type === "video") {
    const scenes = Array.isArray(schema.scenes) ? schema.scenes.map((scene: any) => [scene.visual, scene.text, scene.voiceover].filter(Boolean).join(" ")) : [];
    return [schema.hook, ...scenes, schema.cta, post.longFormBody, post.caption].filter(Boolean).join(" ");
  }
  if (type === "image") {
    return [schema.prompt, schema.imageUrl, schema.style, schema.rationale, post.imagePrompt, post.selectedImageUrl, post.caption].filter(Boolean).join(" ");
  }
  if (Array.isArray(schema.slides)) {
    return schema.slides.map((slide: any) => [slide.title, slide.text, slide.caption].filter(Boolean).join(" ")).join(" ");
  }
  return [schema.captionAngle, schema.caption, schema.hashtags, schema.imagePrompt, post.caption, post.hashtags].filter(Boolean).join(" ");
}

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

async function rejectDraft(clientId: string, postId: string, category: string, reason: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/posts/${postId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, reason }),
  });
  if (!res.ok) throw new Error("Failed to reject draft");
  return res.json();
}

export default function Drafts() {
  const { clientId } = useParams<{ clientId: string }>();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const campaignIdFilter = searchParams.get("campaignId") ?? undefined;
  const postIdFilter = searchParams.get("postId") ?? undefined;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const listParams = campaignIdFilter ? { campaignId: campaignIdFilter } : undefined;
  const { data: posts, isLoading } = useListPosts(clientId || "", listParams);
  const approvePost = useApprovePost();
  const deletePost = useDeletePost();
  const updatePost = useUpdatePost();
  const regenerateCopy = useRegeneratePostCopy();
  const generateImage = useGeneratePostImage();
  const uploadPostImage = useUploadPostImage();
  const saveImage = useSaveImage();
  const publishPost = usePublishPost();

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [date, setDate] = useState<Date>();
  const [approveTime, setApproveTime] = useState("");
  const [approvePlatform, setApprovePlatform] = useState("instagram");
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [activeContentFilter, setActiveContentFilter] = useState<ContentFilter>("all");
  const [activeReviewTab, setActiveReviewTab] = useState<ReviewTab>(() => getReviewTab(searchParams.get("tab")));
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);
  const [previewFocusPostId, setPreviewFocusPostId] = useState<string | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const [rejectingPost, setRejectingPost] = useState<Post | null>(null);
  const [rejectCategory, setRejectCategory] = useState("poor_quality");
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTopic, setEditTopic] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editHashtags, setEditHashtags] = useState("");
  const [editPlatform, setEditPlatform] = useState("instagram");
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [artworkPost, setArtworkPost] = useState<Post | null>(null);
  const [artworkHeadline, setArtworkHeadline] = useState("");
  const [artworkSubline, setArtworkSubline] = useState("");
  const [artworkLogoEnabled, setArtworkLogoEnabled] = useState(true);
  const [artworkFrameColorValue, setArtworkFrameColorValue] = useState("#f59e0b");
  const [isArtworkSaving, setIsArtworkSaving] = useState(false);

  const [regeneratingPostId, setRegeneratingPostId] = useState<string | null>(null);
  const [generatingImagePostIds, setGeneratingImagePostIds] = useState<Set<string>>(() => new Set());
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);

  const invalidatePosts = () => {
    if (clientId) queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId, listParams) });
  };

  const updateReviewTab = (value: string) => {
    const nextTab = getReviewTab(value);
    setActiveReviewTab(nextTab);
    setPreviewPostId(null);
    const params = new URLSearchParams(search);
    params.set("tab", nextTab);
    const nextSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
  };

  const allPosts = (posts || []) as Post[];
  const needsReview = allPosts.filter(p => p.status === "draft" || p.status === "in_review");
  const drafts = allPosts.filter(p => p.status === "draft");
  const approved = allPosts.filter(p =>
    p.status === "approved" || p.status === "export_ready" || p.status === "scheduled" || p.status === "failed"
  );
  const history = allPosts.filter(p => p.status === "rejected" || hasPublishedProof(p));
  const matchesContentFilter = (post: Post) => activeContentFilter === "all" || contentGroup(post) === activeContentFilter;
  const filteredNeedsReview = needsReview.filter(matchesContentFilter);
  const filteredDrafts = drafts.filter(matchesContentFilter);
  const filteredApproved = approved.filter(matchesContentFilter);
  const filteredHistory = history.filter(matchesContentFilter);
  const lowQualityDrafts = drafts.filter((post) => post.qualityScore != null && post.qualityScore < 0.5);
  const contentTypeCount = new Set(drafts.map((post) => contentGroup(post))).size;
  const campaignDraftCount = campaignIdFilter
    ? drafts.filter((post) => post.campaignId === campaignIdFilter).length
    : drafts.filter((post) => !!post.campaignId).length;
  const activeReviewPosts = activeReviewTab === "drafts"
    ? filteredDrafts
    : activeReviewTab === "ready"
      ? filteredApproved
      : activeReviewTab === "history"
        ? filteredHistory
        : filteredNeedsReview;
  const previewPost = useMemo(() => {
    if (previewPostId) {
      const found = (posts as Post[] | undefined)?.find((post) => post.id === previewPostId);
      if (found) return found;
    }
    return activeReviewPosts[0] ?? filteredNeedsReview[0] ?? filteredDrafts[0] ?? filteredApproved[0] ?? filteredHistory[0] ?? null;
  }, [activeReviewPosts, filteredApproved, filteredDrafts, filteredHistory, filteredNeedsReview, posts, previewPostId]);

  useEffect(() => {
    if (!postIdFilter || !allPosts.length) return;
    const post = allPosts.find((item) => item.id === postIdFilter);
    if (!post) return;
    setPreviewPostId(post.id);
    setPreviewFocusPostId(post.id);
    const nextTab: ReviewTab =
      post.status === "rejected" || hasPublishedProof(post)
        ? "history"
        : ["approved", "export_ready", "scheduled", "failed"].includes(post.status)
          ? "ready"
          : post.status === "draft"
            ? "drafts"
            : "pending";
    setActiveReviewTab(nextTab);
    window.requestAnimationFrame(() => {
      previewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [allPosts, postIdFilter]);

  const openApprove = (post: Post) => {
    setSelectedPostId(post.id);
    setApprovePlatform(post.platform || "instagram");
    setDate(suggestedScheduleDate(post));
    setApproveTime("09:00");
    setIsApproveOpen(true);
  };

  const openEdit = (post: Post) => {
    setEditingPost(post);
    setEditTopic(post.topic || "");
    setEditCaption(post.caption || "");
    setEditHashtags(post.hashtags || "");
    setEditPlatform(post.platform || "instagram");
  };

  const openArtworkEditor = (post: Post) => {
    const schema = asRecord(post.contentSchema);
    const layers = asRecord(schema.artworkLayers);
    setArtworkPost(post);
    setArtworkHeadline(firstString(layers.headline, schema.headline) ?? "");
    setArtworkSubline(firstString(layers.subline, schema.subline) ?? "");
    setArtworkLogoEnabled(layers.logoEnabled !== false && schema.logoEnabled !== false);
    setArtworkFrameColorValue(artworkFrameColor(post));
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

  const handleSaveArtwork = async () => {
    if (!clientId || !artworkPost) return;
    setIsArtworkSaving(true);
    try {
      const schema = asRecord(artworkPost.contentSchema);
      const frameColor = asHexColor(artworkFrameColorValue, artworkFrameColor(artworkPost));
      const finalArtworkBlob = await renderArtworkPng({
        post: artworkPost,
        headline: artworkHeadline,
        subline: artworkSubline,
        logoEnabled: artworkLogoEnabled,
        frameColor,
      });
      const uploaded = await new Promise<{ url: string }>((resolve, reject) => {
        uploadPostImage.mutate(
          {
            clientId,
            data: {
              file: new File([finalArtworkBlob], `final-artwork-${artworkPost.id}.png`, { type: "image/png" }),
            },
          },
          { onSuccess: resolve, onError: reject }
        );
      });
      const nextSchema = {
        ...schema,
        headline: artworkHeadline,
        subline: artworkSubline,
        logoEnabled: artworkLogoEnabled,
        finalArtworkUrl: uploaded.url,
        artworkLayers: {
          ...(asRecord(schema.artworkLayers)),
          headline: artworkHeadline,
          subline: artworkSubline,
          logoEnabled: artworkLogoEnabled,
          frameColor,
          panelColor: artworkPanelColor(artworkPost),
          logo: { enabled: artworkLogoEnabled, url: artworkLogoUrl(artworkPost) },
        },
      };
      await new Promise<void>((resolve, reject) => {
        saveImage.mutate(
          {
            clientId,
            postId: artworkPost.id,
            data: {
              url: uploaded.url,
              originalImageUrl: artworkBaseImageUrl(artworkPost) ?? undefined,
              brandedImageUrl: uploaded.url,
              provider: "openai",
              status: "selected",
              prompt: postImagePrompt(artworkPost) || "Final artwork rendered in Review",
            },
          },
          { onSuccess: () => resolve(), onError: reject }
        );
      });
      await new Promise<void>((resolve, reject) => {
        updatePost.mutate(
          {
            clientId,
            postId: artworkPost.id,
            data: {
              selectedImageUrl: uploaded.url,
              contentSchema: nextSchema,
              contentSchemaVersion: artworkPost.contentSchema ? 1 : undefined,
            },
          },
          { onSuccess: () => resolve(), onError: reject }
        );
      });
      invalidatePosts();
      queryClient.invalidateQueries({ queryKey: ["client-images", clientId] });
      setArtworkPost(null);
      toast({ title: "Final artwork saved" });
    } catch (err) {
      toast({
        title: "Failed to save final artwork",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsArtworkSaving(false);
    }
  };

  const mockPostMutation = useMutation({
    mutationFn: ({ postId }: { postId: string }) => mockPost(clientId!, postId),
    onSuccess: () => {
      invalidatePosts();
      toast({
        title: "Demo post simulated",
        description: "Status was set to posted locally — nothing was sent to any platform.",
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

  const handleReviewSelect = (postId: string) => {
    setPreviewPostId(postId);
    setPreviewFocusPostId(postId);
    window.requestAnimationFrame(() => {
      previewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      previewPanelRef.current?.focus({ preventScroll: true });
    });
    window.setTimeout(() => setPreviewFocusPostId((current) => current === postId ? null : current), 1200);
  };

  const buildScheduledAt = () => {
    if (!date) return undefined;
    const [hours, minutes] = (approveTime || "09:00").split(":").map(Number);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(hours || 9, minutes || 0, 0, 0);
    return scheduledAt;
  };

  const handleApprove = () => {
    if (!clientId || !selectedPostId) return;
    const scheduledAt = buildScheduledAt();
    approvePost.mutate(
      {
        clientId,
        postId: selectedPostId,
        data: { scheduledAt: scheduledAt?.toISOString(), platform: approvePlatform as ApprovePostBodyPlatform },
      },
      {
        onSuccess: () => {
          invalidatePosts();
          setIsApproveOpen(false);
          setSelectedPostId(null);
          setDate(undefined);
          setApproveTime("");
          toast({
            title: "Approved and moved to Publish Queue.",
            description: scheduledAt ? `Scheduled for ${format(scheduledAt, "MMMM d, yyyy 'at' h:mm a")}.` : undefined,
          });
        },
        onError: () => toast({ title: "Failed to approve post", variant: "destructive" }),
      }
    );
  };

  const openReject = (post: Post) => {
    setRejectingPost(post);
    setRejectCategory("poor_quality");
    setRejectReason("");
  };

  const handleReject = async () => {
    if (!clientId || !rejectingPost) return;
    setIsRejecting(true);
    try {
      await rejectDraft(clientId, rejectingPost.id, rejectCategory, rejectReason);
      invalidatePosts();
      setRejectingPost(null);
      setRejectReason("");
      if (previewPostId === rejectingPost.id) setPreviewPostId(null);
      toast({
        title: "Draft rejected",
        description: "AI memory was updated with what to avoid.",
      });
    } catch {
      toast({ title: "Failed to reject draft", variant: "destructive" });
    } finally {
      setIsRejecting(false);
    }
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
    if (generatingImagePostIds.has(postId)) return;
    if (generatingImagePostIds.size >= MAX_IMAGE_GENERATIONS) {
      toast({
        title: "Image generation queue is full",
        description: `Up to ${MAX_IMAGE_GENERATIONS} draft images can generate at once.`,
      });
      return;
    }
    setGeneratingImagePostIds((current) => new Set(current).add(postId));
    generateImage.mutate(
      { clientId, postId },
      {
        onSuccess: () => {
          invalidatePosts();
          toast({ title: "Image generated" });
        },
        onError: () => {
          toast({ title: "Failed to generate image", variant: "destructive" });
        },
        onSettled: () => {
          setGeneratingImagePostIds((current) => {
            const next = new Set(current);
            next.delete(postId);
            return next;
          });
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
        originalImageUrl: post.originalImageUrl ?? "",
        brandedImageUrl: post.brandedImageUrl ?? "",
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

  const canReview = (post?: Post | null): post is Post => !!post && (post.status === "draft" || post.status === "in_review");

  const renderReviewGrid = (items: Post[], emptyTitle: string, emptyBody: string) => {
    if (items.length === 0) {
      return (
        <Card className="border-dashed bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <h3 className="text-base font-semibold mb-1">{emptyTitle}</h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-5">{emptyBody}</p>
            {drafts.length === 0 && needsReview.length === 0 && (
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
            )}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map(post => (
            <PostCard
              key={post.id}
              post={post}
              isSelected={previewPost?.id === post.id}
              onSelect={() => handleReviewSelect(post.id)}
              onEdit={() => openEdit(post)}
              onApprove={canReview(post) ? () => openApprove(post) : undefined}
              onReject={canReview(post) ? () => openReject(post) : undefined}
              onDelete={() => handleDelete(post.id)}
              onRegenerateCopy={() => handleRegenerateCopy(post.id)}
              onGenerateImage={() => handleGenerateImage(post.id)}
              isRegeneratingCopy={regeneratingPostId === post.id}
              isGeneratingImage={generatingImagePostIds.has(post.id)}
            />
          ))}
        </div>
        <div
          ref={previewPanelRef}
          tabIndex={-1}
          className={cn(
            "rounded-lg outline-none transition-shadow",
            previewFocusPostId === previewPost?.id && "ring-2 ring-primary ring-offset-2"
          )}
        >
          <DraftPreviewPanel
            post={previewPost}
            onApprove={canReview(previewPost) ? () => openApprove(previewPost) : undefined}
            onReject={canReview(previewPost) ? () => openReject(previewPost) : undefined}
          />
        </div>
      </div>
    );
  };

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Approve drafts that are ready. Reject drafts to teach AI what to avoid.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/clients/${clientId}/bulk-generate`}>
            <Button variant="outline" size="sm">
              <Zap className="w-4 h-4 mr-2" /> Bulk create
            </Button>
          </Link>
          <Link href={`/clients/${clientId}/manual`}>
            <Button variant="outline" size="sm">
              <PlusCircle className="w-4 h-4 mr-2" /> Manual post
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleExportAll} disabled={approved.length === 0}>
            <ExternalLink className="w-4 h-4 mr-2" /> Export approved
          </Button>
        </div>
      </div>

      {campaignIdFilter && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-primary">Campaign filter active</p>
              <p className="text-xs text-muted-foreground">Showing drafts and posts from this campaign only.</p>
            </div>
          </div>
          <a href={`/clients/${clientId}/drafts`} className="text-sm font-medium text-primary underline">
            Clear filter
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Needs review</p>
            <p className="text-2xl font-semibold mt-1">{needsReview.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{campaignIdFilter ? "Campaign-filtered drafts" : "Campaign-linked drafts"}</p>
            <p className="text-2xl font-semibold mt-1">{campaignDraftCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Needs improvement</p>
            <p className="text-2xl font-semibold mt-1">{lowQualityDrafts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Content types</p>
            <p className="text-2xl font-semibold mt-1">{contentTypeCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {CONTENT_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={activeContentFilter === filter.value ? "default" : "outline"}
            onClick={() => {
              setActiveContentFilter(filter.value);
              setPreviewPostId(null);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card px-4 py-3">
        <p className="text-sm font-medium">Review → Publish Queue → AI Memory</p>
        <p className="text-xs text-muted-foreground mt-1">
          Approval moves content to the Publish Queue. It is not posted until a publish, webhook, or manual action happens.
        </p>
      </div>

      <Tabs value={activeReviewTab} onValueChange={updateReviewTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Needs Review / Pending
            {needsReview.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {needsReview.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="drafts">
            Drafts
            {drafts.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {drafts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ready">
            Approved / Ready
            {approved.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {approved.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            Rejected / History
            {history.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 h-4">
                {history.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Needs Review Tab */}
        <TabsContent value="pending" className="mt-6">
          {renderReviewGrid(
            filteredNeedsReview,
            needsReview.length === 0 ? "No posts need review" : "No pending posts match this filter",
            needsReview.length === 0
              ? "Generated drafts and approval handoffs will appear here when they need a decision."
              : "Choose another content type filter to continue reviewing."
          )}
        </TabsContent>

        {/* Drafts Tab */}
        <TabsContent value="drafts" className="mt-6">
          {renderReviewGrid(
            filteredDrafts,
            drafts.length === 0 ? "No drafts yet" : "No drafts match this filter",
            drafts.length === 0
              ? "Create a post using AI or write content manually. It will appear here for review."
              : "Choose another content type filter to continue reviewing."
          )}
        </TabsContent>

        {/* Ready Tab */}
        <TabsContent value="ready" className="mt-6">
          {filteredApproved.length === 0 ? (
            <Card className="border-dashed bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <CheckCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">{approved.length === 0 ? "No approved posts" : "No approved posts match this filter"}</h3>
                <p className="text-muted-foreground max-w-md">
                  Approve drafts to see them here and take publishing actions.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredApproved.map(post => (
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

        {/* History Tab */}
        <TabsContent value="history" className="mt-6">
          {filteredHistory.length === 0 ? (
            <Card className="border-dashed bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">{history.length === 0 ? "No review history yet" : "No history matches this filter"}</h3>
                <p className="text-muted-foreground max-w-md">
                  Rejected drafts and published posts will appear here after review decisions are made.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredHistory.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={() => openEdit(post)}
                  onDelete={() => handleDelete(post.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Approve Dialog */}
      <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Approve to Queue</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Default schedule is suggested. You can change it before approving.
            </p>
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
            <div className="space-y-1.5">
              <Label>Schedule Time</Label>
              <Input
                type="time"
                value={approveTime}
                onChange={(event) => setApproveTime(event.target.value)}
                disabled={!date}
              />
              <p className="text-xs text-muted-foreground">
                If you pick a date without a time, it defaults to 9:00 AM local time.
              </p>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              This schedules the post inside the app. It will not publish until a social account/webhook/manual action is used.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsApproveOpen(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={approvePost.isPending}>
              {approvePost.isPending ? "Approving..." : date ? "Approve & Schedule" : "Approve to Queue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectingPost} onOpenChange={(open) => { if (!open) setRejectingPost(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">{rejectingPost?.topic || "Untitled draft"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Rejecting this draft teaches AI what to avoid next time.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Reason category</Label>
              <Select value={rejectCategory} onValueChange={setRejectCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REJECT_CATEGORIES.map((category) => (
                    <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Optional reason</Label>
              <Textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="What should AI avoid or improve?"
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectingPost(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={isRejecting}>
              {isRejecting ? "Rejecting…" : "Reject Draft"}
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
            {editingPost && (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="aspect-square max-h-[260px] overflow-hidden rounded-md border bg-muted">
                  <DraftImagePreview post={editingPost} large />
                </div>
                {postImagePrompt(editingPost) && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{postImagePrompt(editingPost)}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleGenerateImage(editingPost.id)}
                    disabled={generatingImagePostIds.has(editingPost.id)}
                  >
                    {generatingImagePostIds.has(editingPost.id) ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-2 h-4 w-4" />
                    )}
                    Change Image
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openArtworkEditor(editingPost)}
                  >
                    <PenLine className="mr-2 h-4 w-4" />
                    Edit Artwork
                  </Button>
                </div>
              </div>
            )}
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

      {/* Artwork Entry Dialog */}
      <Dialog open={!!artworkPost} onOpenChange={(open) => { if (!open) setArtworkPost(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Artwork</DialogTitle>
          </DialogHeader>
          {artworkPost && (
            <div className="space-y-4 py-2">
              <div className="aspect-square overflow-hidden rounded-md border bg-muted">
                <ArtworkLayerPreview
                  post={artworkPost}
                  headline={artworkHeadline}
                  subline={artworkSubline}
                  logoEnabled={artworkLogoEnabled}
                  frameColor={artworkFrameColorValue}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Headline</Label>
                <Input value={artworkHeadline} onChange={(event) => setArtworkHeadline(event.target.value)} placeholder="Artwork headline" />
              </div>
              <div className="space-y-1.5">
                <Label>Subline</Label>
                <Input value={artworkSubline} onChange={(event) => setArtworkSubline(event.target.value)} placeholder="Short supporting line" />
              </div>
              <div className="space-y-1.5">
                <Label>Frame color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={asHexColor(artworkFrameColorValue, artworkFrameColor(artworkPost))}
                    onChange={(event) => setArtworkFrameColorValue(event.target.value)}
                    className="h-10 w-14 p-1"
                  />
                  <Input
                    value={artworkFrameColorValue}
                    onChange={(event) => setArtworkFrameColorValue(event.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>
                  <span className="font-medium">Show logo when available</span>
                  <span className="block text-xs text-muted-foreground">Uses the logo URL saved with this draft when available.</span>
                </span>
                <input
                  type="checkbox"
                  checked={artworkLogoEnabled}
                  onChange={(event) => setArtworkLogoEnabled(event.target.checked)}
                  className="h-4 w-4"
                />
              </label>
              {postImagePrompt(artworkPost) && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium">Image prompt</p>
                  <p className="mt-1 line-clamp-4 text-xs text-muted-foreground">{postImagePrompt(artworkPost)}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArtworkPost(null)}>Cancel</Button>
            <Button onClick={handleSaveArtwork} disabled={isArtworkSaving}>
              {isArtworkSaving ? "Rendering…" : "Save Final Artwork"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QualityBadge({ score }: { score?: number | null }) {
  if (score == null) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs",
        score >= 0.75 ? "bg-green-50 text-green-700 border-green-200"
        : score >= 0.5 ? "bg-yellow-50 text-yellow-700 border-yellow-200"
        : "bg-red-50 text-red-700 border-red-200"
      )}
    >
      Quality {Math.round(score * 100)}
    </Badge>
  );
}

function PostHistoryTimeline({ post }: { post: Post }) {
  const approvedAt = ["approved", "export_ready", "scheduled", "posted", "published", "failed"].includes(post.status)
    ? post.updatedAt
    : null;
  const finalLabel = post.status === "failed" ? "Failed" : post.publishedAt ? "Published" : "Not posted yet";
  const finalAt = post.status === "failed" ? post.updatedAt : post.publishedAt;
  const steps = [
    { label: "Created", value: post.createdAt },
    { label: "Approved", value: approvedAt },
    { label: "Scheduled", value: post.scheduledAt },
    { label: finalLabel, value: finalAt },
  ];

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Post history</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {steps.map((step) => (
          <div key={step.label}>
            <p className="font-medium">{step.label}</p>
            <p className="text-muted-foreground">
              {step.value ? format(new Date(step.value), "MMM d, h:mm a") : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextBlock({ title, children }: { title: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items?: unknown[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <TextBlock title={title}>
      <ul className="list-disc pl-4 space-y-1">
        {items.map((item, index) => (
          <li key={index}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
        ))}
      </ul>
    </TextBlock>
  );
}

function DraftImagePreview({ post, large = false }: { post: Post; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = postImageUrl(post);
  const prompt = postImagePrompt(post);

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-muted px-4 text-center">
      <ImagePlus className={cn(large ? "w-8 h-8" : "w-6 h-6", "text-muted-foreground/35")} />
      <p className={cn("font-medium text-muted-foreground", large ? "text-sm" : "text-xs")}>
        {imageUrl ? "Image expired or unavailable" : "No image yet"}
      </p>
      {prompt && (
        <p className={cn("text-muted-foreground line-clamp-3", large ? "text-xs" : "text-[10px]")}>
          {prompt}
        </p>
      )}
    </div>
  );
}

function ArtworkLayerPreview({
  post,
  headline,
  subline,
  logoEnabled,
  frameColor,
}: {
  post: Post;
  headline: string;
  subline: string;
  logoEnabled: boolean;
  frameColor: string;
}) {
  const [failed, setFailed] = useState(false);
  const imageUrl = artworkBaseImageUrl(post);
  const logoUrl = artworkLogoUrl(post);
  const brandName = artworkBrandName(post);
  const panelColor = artworkPanelColor(post);

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted">
      {imageUrl && !failed ? (
        <img src={imageUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No background image available
        </div>
      )}
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="absolute inset-4 rounded-md border-4"
        style={{ borderColor: asHexColor(frameColor, artworkFrameColor(post)) }}
      />
      {logoEnabled && (logoUrl || brandName) && (
        <div className="absolute left-7 top-7 flex h-12 max-w-[45%] items-center">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="truncate text-sm font-semibold text-white drop-shadow">{brandName}</span>
          )}
        </div>
      )}
      <div className="absolute inset-x-7 bottom-7 rounded-md px-5 py-4 text-white" style={{ backgroundColor: panelColor }}>
        <p className="line-clamp-2 text-2xl font-bold leading-tight">{headline || "Headline"}</p>
        <p className="mt-2 line-clamp-3 text-sm opacity-90">{subline || "Subline"}</p>
      </div>
    </div>
  );
}

function DraftPreviewContent({ post }: { post: Post }) {
  const schema = asRecord(post.contentSchema);
  const type = contentGroup(post);

  if (type === "blog") {
    return (
      <div className="space-y-4">
        <TextBlock title="SEO title">{schema.seoTitle || post.title || post.topic}</TextBlock>
        <TextBlock title="Meta description">{schema.metaDescription || post.caption}</TextBlock>
        <ListBlock title="Outline" items={schema.sections} />
        <TextBlock title="Full draft preview">{schema.fullDraft || post.longFormBody}</TextBlock>
        <ListBlock title="FAQ" items={schema.faq} />
      </div>
    );
  }

  if (type === "newsletter") {
    return (
      <div className="space-y-4">
        <TextBlock title="Subject">{schema.subject || post.title || post.topic}</TextBlock>
        <TextBlock title="Preheader">{schema.preheader || post.caption}</TextBlock>
        <ListBlock title="Sections" items={schema.sections} />
        <TextBlock title="Body preview">{post.longFormBody}</TextBlock>
      </div>
    );
  }

  if (type === "video") {
    const scenes = Array.isArray(schema.scenes) ? schema.scenes : [];
    return (
      <div className="space-y-4">
        <TextBlock title="Hook">{schema.hook || post.topic}</TextBlock>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenes</p>
          {scenes.length > 0 ? scenes.map((scene: any, index: number) => (
            <div key={index} className="rounded-md border p-3 text-sm">
              <p className="font-medium">Scene {scene.order ?? index + 1}{scene.duration ? ` · ${scene.duration}` : ""}</p>
              <p className="text-muted-foreground mt-1">{[scene.visual, scene.text, scene.voiceover].filter(Boolean).join(" ")}</p>
            </div>
          )) : <p className="text-sm text-muted-foreground">{post.longFormBody || post.caption}</p>}
        </div>
        <TextBlock title="Voiceover">{schema.voiceoverFull || post.longFormBody}</TextBlock>
        <TextBlock title="CTA">{schema.cta}</TextBlock>
      </div>
    );
  }

  if (type === "image") {
    return (
      <div className="space-y-4">
        <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
          <DraftImagePreview post={post} large />
        </div>
        <TextBlock title="Headline">{schema.headline}</TextBlock>
        <TextBlock title="Subline">{schema.subline}</TextBlock>
        <TextBlock title="Prompt">{schema.prompt || post.imagePrompt || post.caption}</TextBlock>
        <TextBlock title="Creative direction">{schema.creativeDirection || schema.artworkDirection}</TextBlock>
        <TextBlock title="Style">{schema.style}</TextBlock>
        <TextBlock title="Details">{schema.rationale}</TextBlock>
        {postImageUrl(post) && (
          <TextBlock title="Image URL">
            <a className="text-primary underline break-all" href={postImageUrl(post) || ""} target="_blank" rel="noreferrer">
              {postImageUrl(post)}
            </a>
          </TextBlock>
        )}
      </div>
    );
  }

  if (Array.isArray(schema.slides)) {
    return (
      <div className="space-y-3">
        {schema.slides.map((slide: any, index: number) => (
          <div key={index} className="rounded-md border p-3">
            <p className="text-sm font-medium">Slide {index + 1}{slide.title ? ` · ${slide.title}` : ""}</p>
            <p className="text-sm text-muted-foreground mt-1">{slide.text || slide.caption || JSON.stringify(slide)}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(postImageUrl(post) || postImagePrompt(post)) && (
        <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
          <DraftImagePreview post={post} large />
        </div>
      )}
      <TextBlock title="Caption">{schema.caption || schema.captionAngle || post.caption}</TextBlock>
      <TextBlock title="Hashtags">{schema.hashtags || post.hashtags}</TextBlock>
      <TextBlock title="Image prompt">{postImagePrompt(post)}</TextBlock>
    </div>
  );
}

function DraftPreviewPanel({
  post,
  onApprove,
  onReject,
}: {
  post: Post | null;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  if (!post) {
    return (
      <Card className="xl:sticky xl:top-4">
        <CardContent className="p-5 text-sm text-muted-foreground">
          Select a draft to review the full structured content.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="xl:sticky xl:top-4 max-h-[calc(100vh-2rem)] overflow-auto">
      <CardContent className="p-5 space-y-5">
        <div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Badge variant="secondary" className="capitalize">{contentTypeLabel(post)}</Badge>
            {post.platform && <Badge variant="outline">{post.platform}</Badge>}
            {post.campaignId && <Badge variant="outline">Campaign</Badge>}
            <QualityBadge score={post.qualityScore} />
          </div>
          <h2 className="text-lg font-semibold leading-tight">{post.title || post.topic || "Untitled draft"}</h2>
          <p className="text-xs text-muted-foreground mt-1">Status: {displayStatus(post)}</p>
        </div>

        <PostHistoryTimeline post={post} />

        {post.qualityReport != null && (
          <TextBlock title="Quality report">
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs overflow-auto">
              {typeof post.qualityReport === "string" ? post.qualityReport : JSON.stringify(post.qualityReport, null, 2)}
            </pre>
          </TextBlock>
        )}

        <DraftPreviewContent post={post} />

        {(onApprove || onReject) && (
          <div className="flex gap-2 pt-3 border-t">
            {onApprove && (
              <Button className="flex-1" size="sm" onClick={onApprove}>
                <CheckCircle className="w-4 h-4 mr-2" /> Approve
              </Button>
            )}
            {onReject && (
              <Button className="flex-1" size="sm" variant="outline" onClick={onReject}>
                <XCircle className="w-4 h-4 mr-2" /> Reject
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PostCard({
  post,
  isSelected,
  onSelect,
  onEdit,
  onApprove,
  onReject,
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
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onDelete: () => void;
  onRegenerateCopy?: () => void;
  onGenerateImage?: () => void;
  onPublish?: () => void;
  isRegeneratingCopy?: boolean;
  isGeneratingImage?: boolean;
  isPublishing?: boolean;
  actionBar?: ReactNode;
}) {
  const isDraft = post.status === "draft" || post.status === "in_review";
  const isApprovedOrScheduled = post.status === "approved" || post.status === "export_ready" || post.status === "scheduled";
  const isFailed = post.status === "failed";
  const isPublished = hasPublishedProof(post);
  const platformClass = PLATFORM_COLORS[post.platform || ""] || "bg-muted text-muted-foreground";
  const imageUrl = postImageUrl(post);

  const statusBadgeClass = ((post.status === "posted" || post.status === "published") && !post.publishedAt)
    ? "bg-muted text-muted-foreground border border-border"
    : ({
    draft: "",
    in_review: "bg-amber-50 text-amber-700 border border-amber-200",
    approved: "bg-blue-50 text-blue-700 border border-blue-200",
    export_ready: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    scheduled: "bg-primary/10 text-primary border border-primary/20",
    posted: "bg-green-50 text-green-700 border border-green-200",
    published: "bg-green-50 text-green-700 border border-green-200",
    failed: "bg-red-50 text-red-700 border border-red-200",
  }[post.status] ?? "");

  return (
    <Card className={cn("overflow-hidden flex flex-col group", isSelected && "ring-2 ring-primary")}>
      <div className="aspect-square bg-muted relative">
        <DraftImagePreview post={post} />
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
        {post.campaignId && (
          <div className="absolute bottom-2 right-2 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-background/90 text-muted-foreground">
            Campaign
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
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="secondary"
              className={cn("uppercase text-[10px] tracking-wider", statusBadgeClass)}
            >
              {displayStatus(post)}
            </Badge>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-muted text-muted-foreground border-border capitalize">
              {contentTypeLabel(post)}
            </span>
            {post.qualityScore != null && (
              <span
                title="Quality score from AI skill evaluation"
                className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
                  post.qualityScore >= 0.75 ? "bg-green-50 text-green-700 border-green-200"
                  : post.qualityScore >= 0.5  ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                  : "bg-red-50 text-red-600 border-red-200"
                )}
              >
                Q {Math.round(post.qualityScore * 100)}
              </span>
            )}
          </div>
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
            <p className="text-sm line-clamp-3 flex-1 leading-relaxed">{schemaPreview(post) || post.caption}</p>
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
            {onSelect && (
              <Button variant="outline" className="w-full" size="sm" onClick={onSelect}>
                <Eye className="w-4 h-4 mr-2" /> Review Draft
              </Button>
            )}
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
                    {imageUrl ? "New Image" : "Gen Image"}
                  </Button>
                )}
              </div>
            )}
            {onApprove && (
              <Button className="w-full" size="sm" onClick={onApprove}>
                <CheckCircle className="w-4 h-4 mr-2" /> Approve to Queue
              </Button>
            )}
            {onReject && (
              <Button className="w-full" size="sm" variant="outline" onClick={onReject}>
                <XCircle className="w-4 h-4 mr-2" /> Reject
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
