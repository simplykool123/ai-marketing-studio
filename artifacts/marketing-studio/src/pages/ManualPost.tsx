import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useCreatePost, useUpdatePost, getListPostsQueryKey, type CreatePostBodyPlatform } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Upload, X, Image as ImageIcon, PenLine } from "lucide-react";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "blog", label: "Blog" },
];

export default function ManualPost() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  const [topic, setTopic] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleImageUpload = async (file: File) => {
    if (!clientId) return;
    setIsUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clients/${clientId}/posts/upload-image`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json() as { url: string };
      setImageUrl(url);
      setImagePreview(url);
      toast({ title: "Image uploaded" });
    } catch {
      toast({ title: "Failed to upload image", variant: "destructive" });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!clientId || !caption.trim()) return;
    setIsSaving(true);
    try {
      await new Promise<void>((resolve, reject) => {
        createPost.mutate(
          {
            clientId,
            data: {
              topic: topic.trim() || "Manual post",
              caption: caption.trim(),
              hashtags: hashtags.trim() || undefined,
              selectedImageUrl: imageUrl || undefined,
              platform: platform as CreatePostBodyPlatform,
            },
          },
          { onSuccess: () => resolve(), onError: reject }
        );
      });
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
      toast({ title: "Post saved as draft" });
      setLocation(`/clients/${clientId}/drafts`);
    } catch {
      toast({ title: "Failed to save post", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <PenLine className="w-6 h-6 text-muted-foreground" />
          Manual Post
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Write your own caption, paste existing content, or upload an image — saved as a draft for approval.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Post Content</CardTitle>
          <CardDescription>Everything here is editable before you approve and schedule.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Topic */}
          <div className="space-y-1.5">
            <Label>Topic / Title <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. New product launch, Weekly tip, Behind the scenes…"
            />
          </div>

          {/* Caption */}
          <div className="space-y-1.5">
            <Label>Caption <span className="text-destructive">*</span></Label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your caption here, or paste existing content…"
              className="min-h-[160px] resize-none text-sm leading-relaxed"
            />
          </div>

          {/* Hashtags */}
          <div className="space-y-1.5">
            <Label>Hashtags <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#brand #marketing #content"
              className="font-mono text-sm"
            />
          </div>

          {/* Platform */}
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Image upload */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Image <span className="text-muted-foreground text-xs font-normal ml-1">(optional)</span></CardTitle>
          <CardDescription>Upload any image for this post. It will be stored and attached to the draft.</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }}
          />
          {imagePreview ? (
            <div className="relative rounded-xl overflow-hidden border border-border bg-muted max-w-sm">
              <img src={imagePreview} alt="Preview" className="w-full aspect-square object-cover" />
              <button
                onClick={() => { setImageUrl(""); setImagePreview(""); }}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm border border-border flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors shadow-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingImage}
              className="flex flex-col items-center justify-center w-full max-w-sm aspect-square rounded-xl border-2 border-dashed border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-colors cursor-pointer text-muted-foreground group"
            >
              {isUploadingImage ? (
                <span className="text-sm">Uploading…</span>
              ) : (
                <>
                  <ImageIcon className="w-10 h-10 mb-3 opacity-30 group-hover:opacity-50 transition-opacity" />
                  <span className="text-sm font-medium">Click to upload image</span>
                  <span className="text-xs mt-1 opacity-60">PNG, JPG, WebP. Max 10 MB.</span>
                </>
              )}
            </button>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => setLocation(`/clients/${clientId}/drafts`)}>
          Cancel
        </Button>
        <Button
          onClick={handleSaveDraft}
          disabled={isSaving || !caption.trim()}
          size="lg"
        >
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? "Saving…" : "Save as Draft"}
        </Button>
      </div>
    </div>
  );
}
