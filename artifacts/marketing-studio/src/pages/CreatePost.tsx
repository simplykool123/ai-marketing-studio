import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import PlatformPreview from "@/components/PlatformPreview";
import {
  useGenerateCaptions,
  useGenerateImages,
  useCreatePost,
  useSaveImage,
  useUpdatePost,
  getListPostsQueryKey,
  type ImageResult,
  type UpdatePostBodyPlatform,
  type CreatePostBodyPlatform,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image as ImageIcon, Sparkles, Check, ChevronRight, Save, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3;

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "blog", label: "Blog" },
  { value: "newsletter", label: "Newsletter" },
];

export default function CreatePost() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const generateCaptions = useGenerateCaptions();
  const generateImages = useGenerateImages();
  const createPost = useCreatePost();
  const saveImage = useSaveImage();
  const updatePost = useUpdatePost();

  const [step, setStep] = useState<Step>(1);
  const [topic, setTopic] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("topic") ?? "";
  });
  const [platform, setPlatform] = useState("instagram");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("topic");
    if (t) setTopic(t);
  }, []);

  // Step 1
  const [captions, setCaptions] = useState<Array<{ id: number; caption: string; hashtags: string }>>([]);
  const [selectedCaptionIndex, setSelectedCaptionIndex] = useState<number>(0);
  const [editedCaption, setEditedCaption] = useState("");
  const [editedHashtags, setEditedHashtags] = useState("");

  // Step 2
  const [draftPostId, setDraftPostId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageResult[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  const handleGenerateCaptions = () => {
    if (!topic.trim() || !clientId) return;
    generateCaptions.mutate(
      { data: { clientId, topic } },
      {
        onSuccess: (res) => {
          setCaptions(res.options);
          if (res.options.length > 0) {
            setEditedCaption(res.options[0].caption);
            setEditedHashtags(res.options[0].hashtags);
          }
        },
        onError: () => toast({ title: "Failed to generate captions", variant: "destructive" }),
      }
    );
  };

  const handleSelectCaption = (index: number) => {
    setSelectedCaptionIndex(index);
    setEditedCaption(captions[index].caption);
    setEditedHashtags(captions[index].hashtags);
  };

  const handleGenerateImages = () => {
    if (!editedCaption.trim() || !clientId) return;
    setStep(2);
    createPost.mutate(
      { clientId, data: { topic, caption: editedCaption, hashtags: editedHashtags } },
      {
        onSuccess: (post) => {
          setDraftPostId(post.id);
          generateImages.mutate(
            { data: { clientId, caption: editedCaption, postId: post.id } },
            {
              onSuccess: (res) => setImages(res.images),
              onError: () => toast({ title: "Failed to generate images", variant: "destructive" }),
            }
          );
        },
        onError: () => { toast({ title: "Failed to create draft post", variant: "destructive" }); setStep(1); },
      }
    );
  };

  const handleManualImageUpload = async (file: File) => {
    if (!clientId) return;
    setIsUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clients/${clientId}/posts/upload-image`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json() as { url: string };
      setSelectedImageUrl(url);
      toast({ title: "Image uploaded" });
    } catch {
      toast({ title: "Failed to upload image", variant: "destructive" });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!clientId || !draftPostId) return;
    setIsSaving(true);
    try {
      await new Promise<void>((resolve, reject) => {
        updatePost.mutate(
          {
            clientId,
            postId: draftPostId,
            data: {
              caption: editedCaption,
              hashtags: editedHashtags,
              selectedImageUrl: selectedImageUrl || undefined,
              platform: platform as UpdatePostBodyPlatform,
              topic,
            },
          },
          { onSuccess: () => resolve(), onError: reject }
        );
      });

      if (images.length > 0) {
        await Promise.allSettled(
          images.map((img) =>
            new Promise<void>((resolve, reject) => {
              saveImage.mutate(
                {
                  clientId,
                  postId: draftPostId,
                  data: {
                    url: img.url,
                    provider: img.provider,
                    status: img.url === selectedImageUrl ? "selected" : "rejected",
                    prompt: img.prompt,
                  },
                },
                { onSuccess: () => resolve(), onError: reject }
              );
            })
          )
        );
      }

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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create with AI</h1>
        <p className="text-muted-foreground mt-1 text-sm">Generate captions + images, then review and save.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center">
        {[1, 2, 3].map((s, idx) => (
          <div key={s} className="flex items-center">
            <div className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors",
              step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>{s}</div>
            {idx < 2 && <div className={cn("flex-1 h-0.5 w-12 mx-2 rounded transition-colors", step > s ? "bg-primary" : "bg-muted")} />}
          </div>
        ))}
        <span className="ml-4 text-sm text-muted-foreground">
          {step === 1 ? "Caption" : step === 2 ? "Image" : "Review & Save"}
        </span>
      </div>

      {/* Step 1: Caption */}
      {step === 1 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Card>
            <CardContent className="pt-6">
              <Label className="text-base mb-3 block font-medium">What do you want to post about?</Label>
              <div className="flex gap-3">
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. New summer collection launch next week"
                  className="text-base py-5"
                  onKeyDown={(e) => { if (e.key === "Enter") handleGenerateCaptions(); }}
                />
                <Button
                  onClick={handleGenerateCaptions}
                  disabled={!topic.trim() || generateCaptions.isPending}
                  className="px-6"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {generateCaptions.isPending ? "Thinking…" : "Generate"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {generateCaptions.isPending && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          )}

          {captions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="md:col-span-1 space-y-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">3 Options</Label>
                {captions.map((opt, i) => (
                  <Card
                    key={opt.id}
                    className={cn(
                      "cursor-pointer transition-all border",
                      selectedCaptionIndex === i ? "border-primary ring-1 ring-primary shadow-sm" : "hover:border-primary/40"
                    )}
                    onClick={() => handleSelectCaption(i)}
                  >
                    <CardContent className="p-4 text-sm line-clamp-4 leading-relaxed">{opt.caption}</CardContent>
                  </Card>
                ))}
              </div>
              <div className="md:col-span-2 space-y-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Edit Selection</Label>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <Textarea
                      value={editedCaption}
                      onChange={(e) => setEditedCaption(e.target.value)}
                      className="min-h-[140px] text-base resize-none"
                    />
                    <Input
                      value={editedHashtags}
                      onChange={(e) => setEditedHashtags(e.target.value)}
                      placeholder="#hashtags"
                    />
                    <div className="flex justify-end pt-2">
                      <Button onClick={handleGenerateImages} disabled={!editedCaption.trim()}>
                        Next: Generate Images <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Images */}
      {step === 2 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-muted-foreground" /> Select an Image
            </h2>
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>Back</Button>
          </div>

          {(generateImages.isPending || createPost.isPending) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {[1, 2].map(i => <Skeleton key={i} className="aspect-square w-full rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {images.map((img, i) => (
                <Card
                  key={i}
                  className={cn(
                    "overflow-hidden cursor-pointer transition-all",
                    selectedImageUrl === img.url ? "ring-2 ring-primary border-primary" : "hover:ring-1 hover:ring-primary/40"
                  )}
                  onClick={() => { setSelectedImageUrl(img.url); setStep(3); }}
                >
                  <div className="aspect-square relative bg-muted">
                    {img.url ? (
                      <img src={img.url} alt="Generated" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-medium text-foreground shadow-sm">
                      {img.panel === "right" ? "Variation B" : "Variation A"}
                    </div>
                    {selectedImageUrl === img.url && (
                      <div className="absolute inset-0 bg-primary/15 flex items-center justify-center">
                        <div className="bg-primary text-primary-foreground p-3 rounded-full shadow-lg">
                          <Check className="w-7 h-7" />
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {images.length > 0 && !generateImages.isPending && (
            <div className="flex justify-end">
              <Button onClick={() => setStep(3)} disabled={!selectedImageUrl} variant="outline">
                Continue without selecting <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Review & Edit */}
      {step === 3 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review & Edit</h2>
            <Button variant="outline" size="sm" onClick={() => setStep(2)}>Back to Images</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: image + change option */}
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Image</Label>
              <div className="aspect-square rounded-xl overflow-hidden bg-muted border border-border relative group">
                {selectedImageUrl ? (
                  <img src={selectedImageUrl} alt="Selected" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <ImageIcon className="w-12 h-12 opacity-30" />
                    <span className="text-sm">No image selected</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end gap-2 p-3">
                  <Button size="sm" variant="secondary" onClick={() => setStep(2)} className="flex-1">
                    <ImageIcon className="w-4 h-4 mr-1.5" /> Change
                  </Button>
                  <label className="flex-1">
                    <Button size="sm" variant="secondary" className="w-full pointer-events-none" disabled={isUploadingImage}>
                      <Upload className="w-4 h-4 mr-1.5" /> {isUploadingImage ? "…" : "Upload"}
                    </Button>
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManualImageUpload(f); e.target.value = ""; }}
                    />
                  </label>
                  {selectedImageUrl && (
                    <Button size="sm" variant="secondary" onClick={() => setSelectedImageUrl("")}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Right: editable fields */}
            <div className="space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Topic</Label>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Post topic" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Caption</Label>
                <Textarea
                  value={editedCaption}
                  onChange={(e) => setEditedCaption(e.target.value)}
                  className="min-h-[130px] resize-none text-sm leading-relaxed"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Hashtags</Label>
                <Input
                  value={editedHashtags}
                  onChange={(e) => setEditedHashtags(e.target.value)}
                  placeholder="#hashtag1 #hashtag2"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4 border-t border-border">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSaveDraft}
                  disabled={isSaving || !editedCaption.trim()}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? "Saving…" : "Save as Draft"}
                </Button>
              </div>
            </div>
          </div>

          <PlatformPreview
            platform={platform}
            caption={editedCaption}
            hashtags={editedHashtags}
            imageUrl={selectedImageUrl}
          />
        </div>
      )}
    </div>
  );
}
