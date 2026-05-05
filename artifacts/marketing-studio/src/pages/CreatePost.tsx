import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import PlatformPreview from "@/components/PlatformPreview";
import {
  createPost,
  generateCaptions,
  generateImages,
  getListPostsQueryKey,
  updatePost,
  useGetBrandDna,
  useGetClient,
  useListBrandAssets,
  type CaptionOption,
  type CreatePostBodyPlatform,
  type ImageResult,
  type UpdatePostBodyPlatform,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3;
type SaveState = "idle" | "saving" | "saved" | "failed";
type SendState = "idle" | "sending" | "sent" | "failed";
type BrandControlKey = "useBrandDna" | "useBrandColors" | "includeLogo" | "useBrandAssets";

type BrandControlsState = Record<BrandControlKey, boolean>;

type BrandControlsPayload = BrandControlsState & {
  brandName?: string;
  logoUrl?: string;
  assetUrls?: string[];
  assetNotes?: string;
  captionContext?: string;
  imageContext?: string;
};

type GenerateCaptionsBodyWithBrand = Parameters<typeof generateCaptions>[0] & {
  brandControls?: BrandControlsPayload;
};

type GenerateImagesBodyWithBrand = Parameters<typeof generateImages>[0] & {
  platform?: string;
  desiredRatio?: string;
  brandControls?: BrandControlsPayload;
};

const APPROVAL_PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X/Twitter" },
  { value: "youtube", label: "YouTube" },
] as const;

type ApprovalPlatform = (typeof APPROVAL_PLATFORMS)[number]["value"];

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function hasText(value: string | undefined | null): value is string {
  return Boolean(value?.trim());
}

function joinReadableList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export default function CreatePost() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: client, isLoading: clientLoading } = useGetClient(clientId ?? "");
  const { data: brandDna, isLoading: brandDnaLoading } = useGetBrandDna(clientId ?? "");
  const { data: brandAssets = [], isLoading: brandAssetsLoading } = useListBrandAssets(clientId ?? "");

  const [step, setStep] = useState<Step>(1);
  const [topic, setTopic] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("topic") ?? "";
  });

  const [captions, setCaptions] = useState<CaptionOption[]>([]);
  const [selectedCaptionIndex, setSelectedCaptionIndex] = useState(0);
  const [editedCaption, setEditedCaption] = useState("");
  const [editedHashtags, setEditedHashtags] = useState("");
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);

  const [images, setImages] = useState<ImageResult[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState("");
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);

  const [brandControlsInitialized, setBrandControlsInitialized] = useState(false);
  const [brandControls, setBrandControls] = useState<BrandControlsState>({
    useBrandDna: false,
    useBrandColors: false,
    includeLogo: false,
    useBrandAssets: false,
  });

  const [selectedPlatforms, setSelectedPlatforms] = useState<ApprovalPlatform[]>(["instagram"]);
  const [platformPreviews, setPlatformPreviews] = useState<ApprovalPlatform[]>([]);
  const [postIdsByPlatform, setPostIdsByPlatform] = useState<Partial<Record<ApprovalPlatform, string>>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [sendState, setSendState] = useState<SendState>("idle");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("topic");
    if (t) setTopic(t);
  }, []);

  const brandColorList = [
    brandDna?.primaryColor,
    brandDna?.secondaryColor,
    brandDna?.accentColor,
  ].filter(hasText);
  const brandName = brandDna?.brandName || client?.name || "Your Brand";
  const hasBrandDna = Boolean(brandDna);
  const hasBrandColors = brandColorList.length > 0;
  const hasLogo = Boolean(client?.logoUrl);
  const hasBrandAssets = brandAssets.length > 0;

  useEffect(() => {
    if (brandControlsInitialized || brandDnaLoading || brandAssetsLoading || clientLoading) return;
    setBrandControls({
      useBrandDna: hasBrandDna,
      useBrandColors: hasBrandColors,
      includeLogo: hasLogo,
      useBrandAssets: hasBrandAssets,
    });
    setBrandControlsInitialized(true);
  }, [
    brandAssetsLoading,
    brandControlsInitialized,
    brandDnaLoading,
    clientLoading,
    hasBrandAssets,
    hasBrandColors,
    hasBrandDna,
    hasLogo,
  ]);

  const invalidatePosts = () => {
    if (!clientId) return;
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
    queryClient.invalidateQueries({ queryKey: ["enhanced-dashboard", clientId] });
  };

  const resetSavedStates = () => {
    if (saveState !== "idle") setSaveState("idle");
    if (sendState !== "idle") setSendState("idle");
  };

  const resetPlatformPreviews = () => {
    setPlatformPreviews([]);
    resetSavedStates();
  };

  const setBrandControl = (key: BrandControlKey, value: boolean) => {
    setBrandControls((current) => ({ ...current, [key]: value }));
    resetPlatformPreviews();
  };

  const buildBrandControlsPayload = (): BrandControlsPayload => {
    const assetLines = brandControls.useBrandAssets
      ? brandAssets
          .map((asset) => {
            const notes = asset.notes?.trim();
            return `${asset.assetType}: ${notes || asset.fileUrl}`;
          })
          .filter(Boolean)
      : [];

    const captionContext = brandControls.useBrandDna && brandDna
      ? [
          brandDna.voiceTone ? `Brand tone: ${brandDna.voiceTone}` : null,
          brandDna.targetAudience || brandDna.audiencePersonas
            ? `Target audience: ${brandDna.targetAudience || brandDna.audiencePersonas}`
            : null,
          brandDna.additionalContext || brandDna.campaignGoals || brandDna.industry
            ? `USP / differentiator: ${brandDna.additionalContext || brandDna.campaignGoals || brandDna.industry}`
            : null,
          brandDna.contentThemes ? `Content pillars: ${brandDna.contentThemes}` : null,
          brandDna.brandValues ? `Brand values: ${brandDna.brandValues}` : null,
          "Use current storyline from server context if available.",
          "Use recent post history from server context if available.",
        ].filter(Boolean).join("\n")
      : "";

    const imageContext = [
      brandControls.useBrandColors && brandColorList.length
        ? `Brand colors: ${brandColorList.join(", ")}`
        : null,
      brandControls.useBrandDna && brandDna?.visualStyle
        ? `Visual style: ${brandDna.visualStyle}`
        : null,
      brandControls.useBrandDna && brandDna?.designNotes
        ? `Design notes: ${brandDna.designNotes}`
        : null,
      brandControls.includeLogo && client?.logoUrl
        ? "Use the uploaded logo/brand mark as a separate brand element or placement cue when appropriate. Do not redraw the exact logo from memory."
        : null,
      assetLines.length ? `Uploaded brand asset references:\n${assetLines.join("\n")}` : null,
    ].filter(Boolean).join("\n");

    return {
      ...brandControls,
      brandName,
      logoUrl: brandControls.includeLogo ? client?.logoUrl : undefined,
      assetUrls: brandControls.useBrandAssets ? brandAssets.map((asset) => asset.fileUrl) : [],
      assetNotes: assetLines.join("\n"),
      captionContext,
      imageContext,
    };
  };

  const buildImageVisualStyle = () => {
    const payload = buildBrandControlsPayload();
    return [
      payload.imageContext,
      "Keep the composition suitable for square social cropping and leave room for a real logo overlay in the UI.",
    ].filter(Boolean).join("\n");
  };

  const brandControlItems: Array<{
    key: BrandControlKey;
    label: string;
    available: boolean;
    description: string;
  }> = [
    {
      key: "useBrandDna",
      label: "Use Brand DNA",
      available: hasBrandDna,
      description: hasBrandDna ? "Voice, audience, USP, pillars, values, storyline, and recent posts." : "No Brand DNA saved yet.",
    },
    {
      key: "useBrandColors",
      label: "Use brand colors",
      available: hasBrandColors,
      description: hasBrandColors ? brandColorList.join(", ") : "No brand colors saved yet.",
    },
    {
      key: "includeLogo",
      label: "Include logo/brand mark",
      available: hasLogo,
      description: hasLogo ? "Use as a brand element; preview uses the uploaded logo." : "No client logo uploaded yet.",
    },
    {
      key: "useBrandAssets",
      label: "Use uploaded brand assets",
      available: hasBrandAssets,
      description: hasBrandAssets ? `${brandAssets.length} uploaded asset${brandAssets.length !== 1 ? "s" : ""} available.` : "No brand assets uploaded yet.",
    },
  ];

  const activeBrandSummary = joinReadableList([
    brandControls.useBrandDna && hasBrandDna ? `${brandName} brand voice` : null,
    brandControls.useBrandColors && hasBrandColors ? "colors" : null,
    brandControls.includeLogo && hasLogo ? "logo" : null,
    brandControls.useBrandAssets && hasBrandAssets ? "uploaded assets" : null,
  ].filter(hasText));

  const handleGenerateCaptions = async () => {
    if (!clientId || !topic.trim()) return;
    setIsGeneratingCaptions(true);
    resetSavedStates();
    try {
      const res = await generateCaptions({
        clientId,
        topic: topic.trim(),
        brandControls: buildBrandControlsPayload(),
      } as GenerateCaptionsBodyWithBrand);
      setCaptions(res.options);
      setSelectedCaptionIndex(0);
      setImages([]);
      setSelectedImageUrl("");
      setPlatformPreviews([]);
      setPostIdsByPlatform({});
      if (res.options.length > 0) {
        setEditedCaption(res.options[0].caption);
        setEditedHashtags(res.options[0].hashtags);
      }
      toast({ title: "Captions generated", description: "Choose one option and edit it before images." });
    } catch (err) {
      toast({
        title: "Failed to generate captions",
        description: getErrorMessage(err, "AI generation failed"),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingCaptions(false);
    }
  };

  const handleSelectCaption = (index: number) => {
    const option = captions[index];
    if (!option) return;
    setSelectedCaptionIndex(index);
    setEditedCaption(option.caption);
    setEditedHashtags(option.hashtags);
    resetPlatformPreviews();
  };

  const handleGenerateImages = async () => {
    if (!clientId || !editedCaption.trim()) return;
    setStep(2);
    setIsGeneratingImages(true);
    resetSavedStates();
    try {
      const res = await generateImages({
        clientId,
        caption: [editedCaption, editedHashtags].filter(Boolean).join("\n\n"),
        visualStyle: buildImageVisualStyle(),
        brandControls: buildBrandControlsPayload(),
      } as GenerateImagesBodyWithBrand);
      setImages(res.images);
      setSelectedImageUrl("");
      setPlatformPreviews([]);
      toast({ title: "Images generated", description: "Select one image to continue." });
    } catch (err) {
      toast({
        title: "Failed to generate images",
        description: getErrorMessage(err, "Image generation failed"),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingImages(false);
    }
  };

  const togglePlatform = (platform: ApprovalPlatform) => {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) {
        return current.filter((item) => item !== platform);
      }
      return [...current, platform];
    });
    resetPlatformPreviews();
  };

  const handleGeneratePlatformPreviews = () => {
    if (!selectedImageUrl) {
      toast({
        title: "Select an image first",
        description: "Choose one generated image before previewing platforms.",
        variant: "destructive",
      });
      return;
    }
    if (selectedPlatforms.length === 0) {
      toast({
        title: "Select at least one platform",
        description: "Choose where this post should go before previewing.",
        variant: "destructive",
      });
      return;
    }
    setPlatformPreviews([...selectedPlatforms]);
    setSendState("idle");
    toast({
      title: "Platform previews generated",
      description: `${selectedPlatforms.length} preview${selectedPlatforms.length !== 1 ? "s" : ""} ready to review.`,
    });
  };

  const upsertPostsForSelectedPlatforms = async (
    status: "draft" | "in_review",
    platforms: ApprovalPlatform[] = selectedPlatforms,
  ) => {
    if (!clientId) return {};
    if (platforms.length === 0) {
      throw new Error("Select at least one platform.");
    }

    const nextIds: Partial<Record<ApprovalPlatform, string>> = { ...postIdsByPlatform };

    for (const platform of platforms) {
      const existingPostId = nextIds[platform];
      const basePayload = {
        topic: topic.trim(),
        caption: editedCaption,
        hashtags: editedHashtags,
        selectedImageUrl: selectedImageUrl || undefined,
        platform: platform as CreatePostBodyPlatform,
        postType: "social" as const,
        title: platform === "youtube" ? topic.trim() : undefined,
      };

      if (existingPostId) {
        await updatePost(clientId, existingPostId, {
          ...basePayload,
          platform: platform as UpdatePostBodyPlatform,
          status,
        });
      } else {
        const created = await createPost(clientId, basePayload);
        nextIds[platform] = created.id;
        if (status !== "draft") {
          await updatePost(clientId, created.id, { status });
        }
      }
    }

    setPostIdsByPlatform(nextIds);
    invalidatePosts();
    return nextIds;
  };

  const handleSaveDraft = async () => {
    if (!clientId || !editedCaption.trim()) return;
    setSaveState("saving");
    try {
      await upsertPostsForSelectedPlatforms("draft");
      setSaveState("saved");
      toast({
        title: "Draft saved",
        description: `${selectedPlatforms.length} draft${selectedPlatforms.length !== 1 ? "s" : ""} saved.`,
      });
      window.setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      setSaveState("failed");
      toast({
        title: "Failed to save draft",
        description: getErrorMessage(err, "Save failed"),
        variant: "destructive",
      });
    }
  };

  const handleSendToApproval = async () => {
    if (!clientId || !editedCaption.trim()) return;
    if (platformPreviews.length === 0) {
      toast({
        title: "Generate previews first",
        description: "Review platform previews before sending posts to Approval.",
        variant: "destructive",
      });
      return;
    }
    setSendState("sending");
    try {
      await upsertPostsForSelectedPlatforms("in_review", platformPreviews);
      setSendState("sent");
      toast({
        title: "Sent to approval",
        description: `${platformPreviews.length} platform post${platformPreviews.length !== 1 ? "s" : ""} moved to Approval.`,
      });
      setLocation(`/clients/${clientId}/approvals`);
    } catch (err) {
      setSendState("failed");
      toast({
        title: "Failed to send to approval",
        description: getErrorMessage(err, "Approval handoff failed"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create with AI</h1>
        <p className="text-muted-foreground mt-1 text-sm">Generate captions and images, then choose platforms at approval handoff.</p>
      </div>

      <div className="flex items-center">
        {[1, 2, 3].map((s, idx) => (
          <div key={s} className="flex items-center">
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors",
                step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {s}
            </div>
            {idx < 2 && (
              <div className={cn("flex-1 h-0.5 w-12 mx-2 rounded transition-colors", step > s ? "bg-primary" : "bg-muted")} />
            )}
          </div>
        ))}
        <span className="ml-4 text-sm text-muted-foreground">
          {step === 1 ? "Caption" : step === 2 ? "Image" : "Review"}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Card>
            <CardContent className="pt-6">
              <Label className="text-base mb-3 block font-medium">What do you want to post about?</Label>
              <div className="flex gap-3">
                <Input
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                    resetPlatformPreviews();
                  }}
                  placeholder="e.g. New summer collection launch next week"
                  className="text-base py-5"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleGenerateCaptions();
                  }}
                />
                <Button
                  onClick={handleGenerateCaptions}
                  disabled={!topic.trim() || isGeneratingCaptions}
                  className="px-6"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {isGeneratingCaptions ? "Thinking..." : "Generate"}
                </Button>
              </div>

              <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <Label className="text-sm font-medium">Brand prompt controls</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {activeBrandSummary
                        ? `Using ${activeBrandSummary}.`
                        : "No brand references are active for this generation."}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {brandControlItems.map((item) => (
                    <div
                      key={item.key}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2.5",
                        !item.available && "opacity-60",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      </div>
                      <Switch
                        checked={brandControls[item.key] && item.available}
                        disabled={!item.available}
                        onCheckedChange={(checked) => setBrandControl(item.key, checked)}
                        aria-label={item.label}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {isGeneratingCaptions && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40 rounded-lg" />
              ))}
            </div>
          )}

          {captions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="md:col-span-1 space-y-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">3 Options</Label>
                {captions.map((option, index) => (
                  <Card
                    key={option.id}
                    className={cn(
                      "cursor-pointer transition-all border",
                      selectedCaptionIndex === index ? "border-primary ring-1 ring-primary shadow-sm" : "hover:border-primary/40",
                    )}
                    onClick={() => handleSelectCaption(index)}
                  >
                    <CardContent className="p-4 text-sm line-clamp-4 leading-relaxed">{option.caption}</CardContent>
                  </Card>
                ))}
              </div>

              <div className="md:col-span-2 space-y-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Edit Selection</Label>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <Textarea
                      value={editedCaption}
                      onChange={(event) => {
                        setEditedCaption(event.target.value);
                        resetPlatformPreviews();
                      }}
                      className="min-h-[140px] text-base resize-none"
                    />
                    <Input
                      value={editedHashtags}
                      onChange={(event) => {
                        setEditedHashtags(event.target.value);
                        resetPlatformPreviews();
                      }}
                      placeholder="#hashtags"
                    />
                    <div className="flex justify-end pt-2">
                      <Button onClick={handleGenerateImages} disabled={!editedCaption.trim() || isGeneratingImages}>
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

      {step === 2 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-muted-foreground" /> Select an Image
            </h2>
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>Back</Button>
          </div>

          {isGeneratingImages ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="aspect-square w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {images.map((image, index) => (
                <Card
                  key={`${image.url}-${index}`}
                  className={cn(
                    "overflow-hidden cursor-pointer transition-all",
                    selectedImageUrl === image.url ? "ring-2 ring-primary border-primary" : "hover:ring-1 hover:ring-primary/40",
                  )}
                  onClick={() => {
                    if (!image.url) return;
                    setSelectedImageUrl(image.url);
                    resetPlatformPreviews();
                  }}
                >
                  <div className="aspect-square relative bg-muted">
                    {image.url ? (
                      <img src={image.url} alt="Generated" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground px-4 text-center">
                        <AlertTriangle className="w-8 h-8 opacity-40" />
                        <span className="text-xs">{image.error ?? "Image generation failed"}</span>
                      </div>
                    )}
                    <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-medium text-foreground shadow-sm">
                      Option {index + 1}
                    </div>
                    {selectedImageUrl === image.url && image.url && (
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

          {images.length > 0 && !isGeneratingImages && (
            <div className="flex justify-end">
              <Button onClick={() => setStep(3)} disabled={!selectedImageUrl}>
                Review Selected <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review</h2>
            <Button variant="outline" size="sm" onClick={() => setStep(2)}>Back to Images</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Selected Image</Label>
              <div className="aspect-square rounded-lg overflow-hidden bg-muted border border-border relative">
                {selectedImageUrl ? (
                  <img src={selectedImageUrl} alt="Selected" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <ImageIcon className="w-12 h-12 opacity-30" />
                    <span className="text-sm">No image selected</span>
                  </div>
                )}
                {selectedImageUrl && brandControls.includeLogo && client?.logoUrl && (
                  <div className="absolute bottom-3 right-3 rounded-md bg-white/90 backdrop-blur-sm p-1.5 shadow-sm border border-white/70">
                    <img src={client.logoUrl} alt={`${brandName} logo`} className="h-8 max-w-24 object-contain" />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Topic</Label>
                <Input
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                    resetPlatformPreviews();
                  }}
                  placeholder="Post topic"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Caption</Label>
                <Textarea
                  value={editedCaption}
                  onChange={(event) => {
                    setEditedCaption(event.target.value);
                    resetPlatformPreviews();
                  }}
                  className="min-h-[130px] resize-none text-sm leading-relaxed"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Hashtags</Label>
                <Input
                  value={editedHashtags}
                  onChange={(event) => {
                    setEditedHashtags(event.target.value);
                    resetPlatformPreviews();
                  }}
                  placeholder="#hashtag1 #hashtag2"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground block">Send to platforms</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {APPROVAL_PLATFORMS.map((platform) => {
                    const checked = selectedPlatforms.includes(platform.value);
                    return (
                      <label
                        key={platform.value}
                        htmlFor={`approval-platform-${platform.value}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                          checked ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/50",
                        )}
                      >
                        <Checkbox
                          id={`approval-platform-${platform.value}`}
                          checked={checked}
                          onCheckedChange={() => togglePlatform(platform.value)}
                        />
                        <span>{platform.label}</span>
                      </label>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleGeneratePlatformPreviews}
                  disabled={!selectedImageUrl || selectedPlatforms.length === 0 || saveState === "saving" || sendState === "sending"}
                >
                  Generate Platform Previews
                </Button>
                {platformPreviews.length === 0 && (
                  <p className="text-xs text-muted-foreground">Generate previews before sending this post to Approval.</p>
                )}
              </div>

              {saveState === "failed" && (
                <p className="text-xs text-destructive">Save failed. Your edits are still here; try again.</p>
              )}
              {sendState === "failed" && (
                <p className="text-xs text-destructive">Sending failed. Nothing was removed; try again.</p>
              )}

              <div className="pt-4 border-t border-border flex gap-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={saveState === "saving" || sendState === "sending" || !editedCaption.trim() || selectedPlatforms.length === 0}
                >
                  {saveState === "saving" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save Draft"}
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSendToApproval}
                  disabled={
                    sendState === "sending" ||
                    saveState === "saving" ||
                    !editedCaption.trim() ||
                    selectedPlatforms.length === 0 ||
                    platformPreviews.length === 0
                  }
                >
                  {sendState === "sending" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  {sendState === "sending" ? "Sending..." : "Send to Approval"}
                </Button>
              </div>
            </div>
          </div>

          {platformPreviews.length > 0 ? (
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Platform previews</Label>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {platformPreviews.map((platform) => {
                  const platformLabel = APPROVAL_PLATFORMS.find((item) => item.value === platform)?.label ?? platform;
                  return (
                    <Card key={platform} className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <h3 className="text-sm font-semibold">{platformLabel}</h3>
                          <span className="text-[11px] text-muted-foreground">Ready for approval</span>
                        </div>
                        <PlatformPreview
                          platform={platform}
                          caption={editedCaption}
                          hashtags={editedHashtags}
                          imageUrl={selectedImageUrl}
                          title={platform === "youtube" ? topic : undefined}
                          brandName={brandName}
                          logoUrl={brandControls.includeLogo ? client?.logoUrl : undefined}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : (
            <PlatformPreview
              platform={selectedPlatforms[0] ?? "instagram"}
              caption={editedCaption}
              hashtags={editedHashtags}
              imageUrl={selectedImageUrl}
              title={selectedPlatforms.includes("youtube") ? topic : undefined}
              brandName={brandName}
              logoUrl={brandControls.includeLogo ? client?.logoUrl : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}
