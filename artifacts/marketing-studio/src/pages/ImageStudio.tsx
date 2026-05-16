import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  Image as ImageIcon,
  Sparkles,
  RefreshCw,
  Wand2,
  Upload,
  X,
  Copy,
  CheckCircle2,
  Send,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ReferenceImage = {
  file: File;
  previewUrl: string;
};

type BrandAsset = {
  id: string;
  assetType: string;
  fileUrl: string;
  notes?: string | null;
};

type PreparedImagePrompt = {
  finalPrompt: string;
  negativePrompt: string;
  suggestedAspectRatio: "1:1" | "4:5" | "16:9" | "9:16";
  styleTags: string[];
  brandColorNotes: string;
  compositionNotes: string;
  textRecommendation: string;
};

type StudioResult = {
  id: string;
  imageUrl: string;
  prompt: string;
  style?: string;
  postId?: string;
  provider?: string;
};

const IMAGE_PROVIDER_OPTIONS = [
  { value: "auto", label: "Auto best", bestFor: "Flux → Ideogram → DALL-E fallback." },
  { value: "flux", label: "Flux", bestFor: "Photorealistic lifestyle, people, product, and natural social visuals." },
  { value: "ideogram", label: "Ideogram", bestFor: "Text-on-image, offer posts, banners, posters, and CTA graphics." },
  { value: "openai", label: "DALL-E", bestFor: "Reliable fallback and general-purpose social images." },
];

async function fetchBrandAssets(clientId: string): Promise<BrandAsset[]> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/brand-assets`);
  if (!res.ok) throw new Error("Failed to load brand assets");
  return res.json();
}

export default function ImageStudio() {
  const { clientId } = useParams<{ clientId: string }>();
  const [location] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const _qs = new URLSearchParams(location.split("?")[1] ?? "");
  const initialIdea     = _qs.get("idea") ?? _qs.get("topic") ?? _qs.get("prompt") ?? "";
  const initialPlatform = _qs.get("platform") ?? "instagram";
  const incomingImageUrl = _qs.get("imageUrl") ?? "";

  const [roughIdea, setRoughIdea] = useState(initialIdea);
  const [editInstruction, setEditInstruction] = useState("");
  const [caption, setCaption] = useState("");
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState(initialPlatform);
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "4:5" | "16:9" | "9:16">("1:1");
  const [imageProvider, setImageProvider] = useState("auto");
  const [prepared, setPrepared] = useState<PreparedImagePrompt | null>(null);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [brandAssets, setBrandAssets] = useState<BrandAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<StudioResult[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"prompt" | "generate" | "edit" | "variations" | "review" | null>(null);

  useEffect(() => {
    if (!clientId) return;
    fetchBrandAssets(clientId)
      .then(setBrandAssets)
      .catch(() => {});
  }, [clientId]);

  const selectedResult = results.find((result) => result.id === selectedResultId) ?? results[0] ?? null;
  const selectedAssetArray = Array.from(selectedAssetIds);
  const selectedProviderOption = IMAGE_PROVIDER_OPTIONS.find((option) => option.value === imageProvider) ?? IMAGE_PROVIDER_OPTIONS[0];
  const workingPrompt = prepared
    ? `${prepared.finalPrompt}\n\nAvoid: ${prepared.negativePrompt}\nComposition: ${prepared.compositionNotes}\nText guidance: ${prepared.textRecommendation}`
    : roughIdea;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image is too large", description: "Maximum upload size is 10 MB.", variant: "destructive" });
      return;
    }
    if (referenceImage) URL.revokeObjectURL(referenceImage.previewUrl);
    setReferenceImage({ file, previewUrl: URL.createObjectURL(file) });
  }

  function removeReferenceImage() {
    if (referenceImage) URL.revokeObjectURL(referenceImage.previewUrl);
    setReferenceImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function improvePrompt() {
    if (!roughIdea.trim()) {
      toast({ title: "Enter a rough image idea first", variant: "destructive" });
      return;
    }
    setLoadingAction("prompt");
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/prepare-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: roughIdea, platform, aspectRatio, assetIds: selectedAssetArray }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not improve prompt");
      setPrepared(data.prepared);
      setAspectRatio(data.prepared?.suggestedAspectRatio ?? aspectRatio);
      toast({ title: "Prompt improved", description: "Review the direction, then generate or edit." });
    } catch (err) {
      toast({
        title: "Prompt improvement failed",
        description: err instanceof Error ? err.message : "Could not improve prompt.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function generateImage() {
    if (!workingPrompt.trim()) {
      toast({ title: "Enter or improve an image prompt first", variant: "destructive" });
      return;
    }
    setLoadingAction("generate");
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: workingPrompt,
          style: prepared?.styleTags?.join(", ") || "premium branded image",
          topic: topic || roughIdea.slice(0, 80) || "Generated image",
          aspectRatio,
          assetIds: selectedAssetArray,
          imageProvider,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Image generation failed");
      const result: StudioResult = {
        id: data.post?.id ?? crypto.randomUUID(),
        imageUrl: data.imageUrl,
        prompt: data.prompt ?? workingPrompt,
        style: data.style,
        postId: data.post?.id,
        provider: data.provider,
      };
      setResults((current) => [result, ...current]);
      setSelectedResultId(result.id);
      toast({ title: "Image generated", description: "Saved durably to Assets." });
    } catch (err) {
      toast({
        title: "Image generation failed",
        description: err instanceof Error ? err.message : "Check your OpenAI key in Settings.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function editImage() {
    if (!referenceImage) {
      toast({ title: "Upload a reference image first", variant: "destructive" });
      return;
    }
    if (!editInstruction.trim()) {
      toast({ title: "Describe the edit you want", variant: "destructive" });
      return;
    }
    setLoadingAction("edit");
    try {
      const formData = new FormData();
      formData.append("image", referenceImage.file);
      formData.append("instruction", `${editInstruction}\n\nPrompt direction: ${workingPrompt || roughIdea}`);
      formData.append("aspectRatio", aspectRatio);
      formData.append("topic", topic || "Edited image");
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/edit-image`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Image edit failed");
      const result: StudioResult = {
        id: data.post?.id ?? crypto.randomUUID(),
        imageUrl: data.imageUrl,
        prompt: data.prompt,
        style: "edited reference",
        postId: data.post?.id,
      };
      setResults((current) => [result, ...current]);
      setSelectedResultId(result.id);
      toast({ title: "Image edited", description: "Saved durably to Assets." });
    } catch (err) {
      toast({
        title: "Image edit failed",
        description: err instanceof Error ? err.message : "Image editing is not available with the current provider.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function createVariations() {
    if (!selectedResult && !workingPrompt.trim()) {
      toast({ title: "Generate or select an image first", variant: "destructive" });
      return;
    }
    setLoadingAction("variations");
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/variations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: selectedResult?.prompt || workingPrompt,
          sourceImageUrl: selectedResult?.imageUrl,
          aspectRatio,
          count: 3,
          topic: topic || "Image variations",
          imageProvider,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create variations");
      const newResults: StudioResult[] = (data.variations ?? []).map((item: any) => ({
        id: item.post?.id ?? crypto.randomUUID(),
        imageUrl: item.imageUrl,
        prompt: item.prompt,
        style: `variation ${item.variation}`,
        postId: item.post?.id,
        provider: item.provider,
      }));
      setResults((current) => [...newResults, ...current]);
      if (newResults[0]) setSelectedResultId(newResults[0].id);
      toast({ title: "Variations created", description: "Saved durably to Assets." });
    } catch (err) {
      toast({
        title: "Variation generation failed",
        description: err instanceof Error ? err.message : "Could not create variations.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function sendToReview() {
    if (!selectedResult) {
      toast({ title: "Select an image first", variant: "destructive" });
      return;
    }
    setLoadingAction("review");
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/save-to-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: selectedResult.imageUrl,
          prompt: selectedResult.prompt,
          platform,
          caption,
          topic: topic || roughIdea.slice(0, 80) || "Image draft",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send to Review");
      toast({ title: "Sent to Review", description: "A draft post was created with the selected image." });
    } catch (err) {
      toast({
        title: "Send to Review failed",
        description: err instanceof Error ? err.message : "Could not create draft.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(workingPrompt);
    toast({ title: "Prompt copied" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ImageIcon className="w-6 h-6 text-primary" />
            Image Studio
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Start rough, let AI shape the prompt, generate or edit images, create variations, then save the best one to Review.
          </p>
        </div>
        <Link href={`/clients/${clientId}/assets`}>
          <Button variant="outline">Open Assets</Button>
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Rough idea</CardTitle>
              <CardDescription>You do not need a perfect prompt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="twitter">X/Twitter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Aspect ratio</Label>
                  <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as typeof aspectRatio)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1:1">1:1 square</SelectItem>
                      <SelectItem value="4:5">4:5 portrait</SelectItem>
                      <SelectItem value="16:9">16:9 wide</SelectItem>
                      <SelectItem value="9:16">9:16 story</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Image provider</Label>
                  <Select value={imageProvider} onValueChange={setImageProvider}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IMAGE_PROVIDER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Best for: {selectedProviderOption.bestFor}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Image idea</Label>
                <textarea
                  className="min-h-[112px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="e.g. make this sofa background more premium, festive Instagram-ready product visual, remove clutter and use warm beige tones"
                  value={roughIdea}
                  onChange={(event) => {
                    setRoughIdea(event.target.value);
                    setPrepared(null);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Draft topic/title</Label>
                <Input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Optional title for Review" />
              </div>

              <Button onClick={improvePrompt} disabled={loadingAction !== null || !roughIdea.trim()} className="w-full gap-2">
                {loadingAction === "prompt" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Improve prompt with AI
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Optional reference</CardTitle>
              <CardDescription>Upload a photo for edit mode, or select imported brand assets for style context.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {incomingImageUrl && !referenceImage && (
                <div className="flex items-center gap-3 rounded-md border border-violet-200 bg-violet-50/50 p-2">
                  <img src={incomingImageUrl} alt="asset reference" className="h-16 w-16 shrink-0 rounded object-cover border" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-violet-800">Asset reference loaded</p>
                    <p className="text-xs text-violet-600 mt-0.5">From Brand Assets — included as context in generation.</p>
                  </div>
                </div>
              )}
              {referenceImage ? (
                <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
                  <img src={referenceImage.previewUrl} alt="reference" className="h-16 w-16 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{referenceImage.file.name}</p>
                    <p className="text-xs text-muted-foreground">Used for image edit mode</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={removeReferenceImage}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed border-input bg-background px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/30"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  Upload reference image
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

              {brandAssets.length > 0 && (
                <div className="space-y-2">
                  <Label>Brand assets</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {brandAssets.slice(0, 6).map((asset) => {
                      const selected = selectedAssetIds.has(asset.id);
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          className={cn("relative aspect-square overflow-hidden rounded-md border", selected && "ring-2 ring-primary")}
                          onClick={() => {
                            setSelectedAssetIds((current) => {
                              const next = new Set(current);
                              if (next.has(asset.id)) next.delete(asset.id);
                              else next.add(asset.id);
                              return next;
                            });
                          }}
                          title={asset.notes ?? asset.assetType}
                        >
                          <img src={asset.fileUrl} alt="" className="h-full w-full object-cover" />
                          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">{asset.assetType}</span>
                          {selected && <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Generate, edit, or vary</CardTitle>
              <CardDescription>Outputs are saved to durable storage before they appear here.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {prepared && (
                <div className="space-y-3 rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {prepared.styleTags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                  <p className="text-sm leading-relaxed">{prepared.finalPrompt}</p>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <p><span className="font-medium text-foreground">Avoid:</span> {prepared.negativePrompt}</p>
                    <p><span className="font-medium text-foreground">Colors:</span> {prepared.brandColorNotes}</p>
                    <p><span className="font-medium text-foreground">Composition:</span> {prepared.compositionNotes}</p>
                    <p><span className="font-medium text-foreground">Text:</span> {prepared.textRecommendation}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={copyPrompt} className="gap-1.5">
                    <Copy className="w-3.5 h-3.5" />
                    Copy prompt
                  </Button>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Edit instruction</Label>
                <Input
                  value={editInstruction}
                  onChange={(event) => setEditInstruction(event.target.value)}
                  placeholder="e.g. change sofa color to beige and remove background clutter"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Button onClick={generateImage} disabled={loadingAction !== null || !workingPrompt.trim()} className="gap-1.5">
                  {loadingAction === "generate" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Generate
                </Button>
                <Button onClick={editImage} disabled={loadingAction !== null || !referenceImage || !editInstruction.trim()} variant="outline" className="gap-1.5">
                  {loadingAction === "edit" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Edit image
                </Button>
                <Button onClick={createVariations} disabled={loadingAction !== null || (!selectedResult && !workingPrompt.trim())} variant="outline" className="gap-1.5">
                  {loadingAction === "variations" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                  Variations
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Choose result</CardTitle>
              <CardDescription>Select the strongest image, then send it to Review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingAction && loadingAction !== "prompt" && (
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="aspect-square rounded-lg" />
                  <Skeleton className="aspect-square rounded-lg" />
                </div>
              )}

              {results.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  Generated and edited images will appear here.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {results.map((result) => {
                    const selected = selectedResult?.id === result.id;
                    return (
                      <button
                        key={result.id}
                        type="button"
                        className={cn("group relative overflow-hidden rounded-lg border text-left", selected && "ring-2 ring-primary")}
                        onClick={() => setSelectedResultId(result.id)}
                      >
                        <img src={result.imageUrl} alt="" className="aspect-square w-full object-cover" />
                        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">{[result.provider, result.style ?? "generated"].filter(Boolean).join(" · ")}</span>
                        {selected && <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Caption for Review</Label>
                <textarea
                  className="min-h-[76px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="Optional caption. Review can rewrite it later."
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox checked={!!selectedResult} disabled />
                <span className="text-xs text-muted-foreground">
                  Selected outputs are already saved to Assets. Send to Review creates a draft post.
                </span>
              </div>

              <Button onClick={sendToReview} disabled={loadingAction !== null || !selectedResult} className="w-full gap-2">
                {loadingAction === "review" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send selected image to Review
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
