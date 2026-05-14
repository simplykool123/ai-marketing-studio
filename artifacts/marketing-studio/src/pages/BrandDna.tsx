import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useGetBrandDna,
  useUpsertBrandDna,
  useGetClient,
  useUpdateClient,
  useListBrandAssets,
  useDeleteBrandAsset,
  getGetBrandDnaQueryKey,
  getListBrandAssetsQueryKey,
  getGetClientQueryKey,
  type BrandDna as SavedBrandDna,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Globe2, RefreshCw, Save, Sparkles, Upload, Trash2, ImageIcon, Palette, FileText, Image, BookOpen, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const brandDnaSchema = z.object({
  brandName: z.string().min(1, "Brand name is required"),
  voiceTone: z.string().optional(),
  targetAudience: z.string().optional(),
  industry: z.string().optional(),
  brandValues: z.string().optional(),
  visualStyle: z.string().optional(),
  competitors: z.string().optional(),
  additionalContext: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  fontStyle: z.string().optional(),
  designNotes: z.string().optional(),
  contentThemes: z.string().optional(),
  postingCadence: z.string().optional(),
  audiencePersonas: z.string().optional(),
  campaignGoals: z.string().optional(),
});

type BrandDnaFormValues = z.infer<typeof brandDnaSchema>;

const emptyBrandDnaFormValues: BrandDnaFormValues = {
  brandName: "",
  voiceTone: "",
  targetAudience: "",
  industry: "",
  brandValues: "",
  visualStyle: "",
  competitors: "",
  additionalContext: "",
  primaryColor: "",
  secondaryColor: "",
  accentColor: "",
  fontStyle: "",
  designNotes: "",
  contentThemes: "",
  postingCadence: "",
  audiencePersonas: "",
  campaignGoals: "",
};

function toBrandDnaFormValues(brandDna: Partial<SavedBrandDna> | null | undefined, fallbackBrandName = ""): BrandDnaFormValues {
  return {
    brandName: brandDna?.brandName || fallbackBrandName || "",
    voiceTone: brandDna?.voiceTone || "",
    targetAudience: brandDna?.targetAudience || "",
    industry: brandDna?.industry || "",
    brandValues: brandDna?.brandValues || "",
    visualStyle: brandDna?.visualStyle || "",
    competitors: brandDna?.competitors || "",
    additionalContext: brandDna?.additionalContext || "",
    primaryColor: brandDna?.primaryColor || "",
    secondaryColor: brandDna?.secondaryColor || "",
    accentColor: brandDna?.accentColor || "",
    fontStyle: brandDna?.fontStyle || "",
    designNotes: brandDna?.designNotes || "",
    contentThemes: brandDna?.contentThemes || "",
    postingCadence: brandDna?.postingCadence || "",
    audiencePersonas: brandDna?.audiencePersonas || "",
    campaignGoals: brandDna?.campaignGoals || "",
  };
}

type WebsiteAnalysis = {
  brandTone: string;
  targetAudience: string;
  productsServices: string;
  usp: string;
  contentPillars: string;
  colorStyleHints: string;
  keywords: string;
  visualStyle: string;
  imageStyle: string;
  fontStyle: string;
  designNotes: string;
  imageStyleNotes: string;
  confidenceNotes: string;
};

type WebsiteImageCandidate = {
  url: string;
  previewUrl?: string;
  alt: string;
  sourcePage: string;
  reason: string;
  contentType?: string;
};

type WebsiteColorCandidate = {
  hex: string;
  count: number;
  score?: number;
};

type WebsiteAnalysisResponse = {
  websiteUrl: string;
  finalUrl?: string;
  analysis: WebsiteAnalysis;
  pagesAnalyzed?: Array<{ url: string; title: string }>;
  logoCandidates?: WebsiteImageCandidate[];
  imageCandidates?: WebsiteImageCandidate[];
  colors?: WebsiteColorCandidate[];
  visibleColors?: WebsiteColorCandidate[];
  cssColors?: WebsiteColorCandidate[];
  palette?: { primary?: string; secondary?: string; accent?: string };
  visualExtraction?: { screenshotCaptured?: boolean; note?: string };
  fontFamilies?: string[];
  warnings?: string[];
  cssFetched?: number;
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  logo: "Logo",
  color_palette: "Color Palette",
  reference_image: "Reference Image",
  brochure: "Brochure",
  sample_post: "Sample Post",
};

const ASSET_TYPE_ICONS: Record<string, React.ElementType> = {
  logo: Layers,
  color_palette: Palette,
  reference_image: Image,
  brochure: FileText,
  sample_post: BookOpen,
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative w-10 h-10 rounded-md border border-border overflow-hidden shrink-0">
          <input
            type="color"
            value={value || "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
          />
          <div
            className="w-full h-full rounded-md"
            style={{ backgroundColor: value || "#ffffff" }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Palette className="w-3 h-3 text-white/70 drop-shadow" />
          </div>
        </div>
        <Input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#hexcolor"
          className="font-mono text-sm"
        />
      </div>
    </div>
  );
}

async function getUploadErrorMessage(res: Response): Promise<string> {
  const data = await res.json().catch(() => null) as { error?: string } | null;
  return data?.error ?? `Upload failed with status ${res.status}`;
}

async function getJsonErrorMessage(res: Response): Promise<string> {
  const data = await res.json().catch(() => null) as { error?: string; details?: string; stage?: string } | null;
  return [data?.error, data?.details, data?.stage ? `Stage: ${data.stage}` : ""].filter(Boolean).join(" ") || `Request failed with status ${res.status}`;
}

function remotePreviewSrc(image?: WebsiteImageCandidate | null): string {
  if (!image?.url) return "";
  return image.previewUrl || `/api/brand-assets/proxy-image?url=${encodeURIComponent(image.url)}`;
}

function RemotePreviewImage({
  src,
  token,
  alt,
  className,
  fallbackClassName,
}: {
  src: string;
  token?: string | null;
  alt: string;
  className: string;
  fallbackClassName?: string;
}) {
  const [resolvedSrc, setResolvedSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setResolvedSrc("");
    setFailed(false);
    if (!src) {
      setFailed(true);
      return () => {};
    }
    if (!src.startsWith("/api/")) {
      setResolvedSrc(src);
      return () => {};
    }
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) throw new Error("Preview unavailable");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) setResolvedSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  if (failed) {
    return (
      <div className={cn("flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-center text-[10px] text-muted-foreground", fallbackClassName)}>
        <ImageIcon className="h-4 w-4" />
        <span>Preview unavailable</span>
      </div>
    );
  }

  if (!resolvedSrc) {
    return <div className={cn("h-full w-full animate-pulse bg-muted", fallbackClassName)} />;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export default function BrandDna() {
  const { clientId } = useParams<{ clientId: string }>();
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const [assetType, setAssetType] = useState<string>("reference_image");
  const [assetNotes, setAssetNotes] = useState("");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isAnalyzingWebsite, setIsAnalyzingWebsite] = useState(false);
  const [websiteAnalysis, setWebsiteAnalysis] = useState<WebsiteAnalysis | null>(null);
  const [websiteAnalysisResult, setWebsiteAnalysisResult] = useState<WebsiteAnalysisResponse | null>(null);
  const [analysisSourceUrl, setAnalysisSourceUrl] = useState("");
  const [replaceFilledFields, setReplaceFilledFields] = useState(false);
  const [isUsingExtractedLogo, setIsUsingExtractedLogo] = useState(false);
  const [showBlockedFallback, setShowBlockedFallback] = useState(false);
  const [fallbackScreenshot, setFallbackScreenshot] = useState<File | null>(null);
  const [fallbackText, setFallbackText] = useState("");
  const [isAnalyzingFallback, setIsAnalyzingFallback] = useState(false);

  const { data: brandDna, isLoading } = useGetBrandDna(clientId || "");
  const { data: client } = useGetClient(clientId || "");
  const { data: assets, isLoading: assetsLoading } = useListBrandAssets(clientId || "");
  const upsertBrandDna = useUpsertBrandDna();
  const updateClient = useUpdateClient();
  const deleteAsset = useDeleteBrandAsset();

  const form = useForm<BrandDnaFormValues>({
    resolver: zodResolver(brandDnaSchema as unknown as Parameters<typeof zodResolver>[0]),
    defaultValues: emptyBrandDnaFormValues,
  });
  const isFormDirty = form.formState.isDirty;

  useEffect(() => {
    if (brandDna && !isFormDirty) {
      form.reset(toBrandDnaFormValues(brandDna, client?.name || ""));
    }
  }, [brandDna, client?.name, form, isFormDirty]);

  const onSubmit = (data: BrandDnaFormValues) => {
    if (!clientId) return;
    const payload: BrandDnaFormValues = {
      ...data,
      brandName: data.brandName?.trim() || client?.name || "Brand",
      voiceTone: data.voiceTone || "",
      targetAudience: data.targetAudience || "",
      industry: data.industry || "",
      brandValues: data.brandValues || "",
      visualStyle: data.visualStyle || "",
      competitors: data.competitors || "",
      additionalContext: data.additionalContext || "",
      primaryColor: data.primaryColor || "",
      secondaryColor: data.secondaryColor || "",
      accentColor: data.accentColor || "",
      fontStyle: data.fontStyle || "",
      designNotes: data.designNotes || "",
      contentThemes: data.contentThemes || "",
      postingCadence: data.postingCadence || "",
      audiencePersonas: data.audiencePersonas || "",
      campaignGoals: data.campaignGoals || "",
    };
    upsertBrandDna.mutate(
      { clientId, data: payload },
      {
        onSuccess: async (savedBrandDna) => {
          queryClient.setQueryData(getGetBrandDnaQueryKey(clientId), savedBrandDna);
          form.reset(toBrandDnaFormValues(savedBrandDna, payload.brandName));
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetBrandDnaQueryKey(clientId) }),
            queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) }),
            queryClient.refetchQueries({ queryKey: getGetBrandDnaQueryKey(clientId) }),
            queryClient.refetchQueries({ queryKey: getGetClientQueryKey(clientId) }),
          ]);
          toast({ title: "Brand DNA saved" });
        },
        onError: (err) => toast({
          title: "Failed to save Brand DNA",
          description: err instanceof Error ? err.message : "Your changes were not saved. Please try again.",
          variant: "destructive",
        }),
      }
    );
  };

  const handleLogoUpload = async (file: File) => {
    if (!clientId) return;
    setIsUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clients/${clientId}/upload/logo`, {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await getUploadErrorMessage(res));
      queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
      toast({ title: "Logo uploaded successfully" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Failed to upload logo", description: message, variant: "destructive" });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleAssetUpload = async (file: File) => {
    if (!clientId) return;
    setIsUploadingAsset(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("assetType", assetType);
      if (assetNotes.trim()) fd.append("notes", assetNotes.trim());
      const res = await fetch(`/api/clients/${clientId}/upload/asset`, {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await getUploadErrorMessage(res));
      queryClient.invalidateQueries({ queryKey: getListBrandAssetsQueryKey(clientId) });
      setAssetNotes("");
      toast({ title: "Asset uploaded" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Failed to upload asset", description: message, variant: "destructive" });
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const handleDeleteAsset = (assetId: string) => {
    if (!clientId) return;
    deleteAsset.mutate(
      { clientId, assetId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBrandAssetsQueryKey(clientId) });
          toast({ title: "Asset deleted" });
        },
        onError: () => toast({ title: "Failed to delete asset", variant: "destructive" }),
      }
    );
  };

  const handleAnalyzeWebsite = async () => {
    if (!clientId || !websiteUrl.trim()) return;
    setIsAnalyzingWebsite(true);
    setWebsiteAnalysis(null);
    setWebsiteAnalysisResult(null);
    setShowBlockedFallback(false);
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-dna/analyze-website`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ websiteUrl }),
      });
      if (res.status === 401) {
        throw new Error("Session expired. Please sign in again.");
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; details?: string; stage?: string } | null;
        if (data?.stage === "website_fetch_and_extraction") setShowBlockedFallback(true);
        throw new Error([data?.error, data?.details, data?.stage ? `Stage: ${data.stage}` : ""].filter(Boolean).join(" ") || `Request failed with status ${res.status}`);
      }
      const data = await res.json() as WebsiteAnalysisResponse;
      setWebsiteAnalysis(data.analysis);
      setWebsiteAnalysisResult(data);
      setAnalysisSourceUrl(data.websiteUrl);
      toast({
        title: "Website analysis ready",
        description: data.warnings?.length
          ? data.warnings.join(" ")
          : "Review the suggestions before applying them to Brand Setup.",
      });
    } catch (err) {
      toast({
        title: "Could not analyze website",
        description: err instanceof Error ? err.message : "Check the URL and try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingWebsite(false);
    }
  };

  const handleAnalyzeFallback = async () => {
    if (!clientId) return;
    if (!fallbackScreenshot && fallbackText.trim().length < 30) {
      toast({
        title: "Add fallback input",
        description: "Upload a homepage screenshot or paste key website text before analyzing.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzingFallback(true);
    try {
      const formData = new FormData();
      if (fallbackScreenshot) formData.append("screenshot", fallbackScreenshot);
      if (fallbackText.trim()) formData.append("websiteText", fallbackText.trim());
      if (websiteUrl.trim()) formData.append("websiteUrl", websiteUrl.trim());

      const res = await fetch(`/api/clients/${clientId}/brand-dna/analyze-fallback`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (res.status === 401) throw new Error("Session expired. Please sign in again.");
      if (!res.ok) throw new Error(await getJsonErrorMessage(res));

      const data = await res.json() as WebsiteAnalysisResponse;
      setWebsiteAnalysis(data.analysis);
      setWebsiteAnalysisResult(data);
      setAnalysisSourceUrl(data.websiteUrl);
      toast({
        title: "Fallback analysis ready",
        description: data.warnings?.length
          ? data.warnings.join(" ")
          : "Review the suggestions before applying them to Brand Setup.",
      });
    } catch (err) {
      toast({
        title: "Fallback analysis failed",
        description: err instanceof Error ? err.message : "Try a smaller screenshot or paste website text manually.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingFallback(false);
    }
  };

  const setSuggestedValue = (field: keyof BrandDnaFormValues, value: string) => {
    if (!value || value === "Not clear from the page") return;
    const current = form.getValues(field);
    if (replaceFilledFields || !current?.trim()) {
      form.setValue(field, value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    }
  };

  const handleApplyAnalysis = async () => {
    if (!clientId || !websiteAnalysis) return;
    const palette = websiteAnalysisResult?.palette;
    const context = [
      websiteAnalysis.productsServices ? `Products/services: ${websiteAnalysis.productsServices}` : null,
      websiteAnalysis.usp ? `USP: ${websiteAnalysis.usp}` : null,
      websiteAnalysis.keywords ? `Keywords: ${websiteAnalysis.keywords}` : null,
    ].filter(Boolean).join("\n");

    if (!form.getValues("brandName")?.trim() && client?.name) {
      form.setValue("brandName", client.name, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    }
    setSuggestedValue("voiceTone", websiteAnalysis.brandTone);
    setSuggestedValue("targetAudience", websiteAnalysis.targetAudience);
    setSuggestedValue("industry", websiteAnalysis.productsServices);
    setSuggestedValue("brandValues", websiteAnalysis.usp);
    setSuggestedValue("contentThemes", websiteAnalysis.contentPillars);
    setSuggestedValue("visualStyle", websiteAnalysis.visualStyle || websiteAnalysis.colorStyleHints);
    setSuggestedValue("fontStyle", websiteAnalysis.fontStyle || websiteAnalysisResult?.fontFamilies?.join(", ") || "");
    setSuggestedValue("designNotes", [websiteAnalysis.designNotes, websiteAnalysis.imageStyle || websiteAnalysis.imageStyleNotes, websiteAnalysis.colorStyleHints].filter(Boolean).join("\n"));
    setSuggestedValue("primaryColor", palette?.primary || "");
    setSuggestedValue("secondaryColor", palette?.secondary || "");
    setSuggestedValue("accentColor", palette?.accent || "");
    setSuggestedValue("additionalContext", context);

    const memoryEntries = [
      {
        key: "Brand DNA / Website import",
        value: `Imported from ${analysisSourceUrl || websiteUrl}. ${websiteAnalysis.confidenceNotes || "Use as directional brand context."}`,
      },
      websiteAnalysis.imageStyleNotes ? {
        key: "Image Style Memory / Website import",
        value: [websiteAnalysis.imageStyleNotes, websiteAnalysis.imageStyle, websiteAnalysis.designNotes].filter(Boolean).join("\n"),
      } : null,
      websiteAnalysisResult?.colors?.length ? {
        key: "Image Style Memory / Website palette",
        value: `Extracted palette: ${websiteAnalysisResult.colors.map((color) => `${color.hex} (${color.count})`).join(", ")}. ${websiteAnalysisResult.visualExtraction?.note || ""}`,
      } : null,
      websiteAnalysis.keywords ? {
        key: "SEO Memory / Website keywords",
        value: websiteAnalysis.keywords,
      } : null,
    ].filter(Boolean) as Array<{ key: string; value: string }>;

    await Promise.all(memoryEntries.map((entry) => fetch(`/api/clients/${clientId}/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(entry),
    }).catch(() => null)));

    toast({
      title: "Suggestions applied. Click Save Brand DNA to keep changes.",
      description: replaceFilledFields ? "Brand fields were updated from the importer." : "Empty Brand Setup fields were filled. Existing filled fields were preserved.",
    });
  };

  const handleUseExtractedLogo = async (url: string) => {
    if (!clientId) return;
    setIsUsingExtractedLogo(true);
    updateClient.mutate(
      { clientId, data: { logoUrl: url } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
          queryClient.refetchQueries({ queryKey: getGetClientQueryKey(clientId) });
          toast({ title: "Extracted logo applied", description: "The logo URL was saved as the client logo reference." });
          setIsUsingExtractedLogo(false);
        },
        onError: () => {
          toast({ title: "Could not apply logo", description: "Upload the logo file manually if this URL cannot be used.", variant: "destructive" });
          setIsUsingExtractedLogo(false);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card><CardContent className="p-6 space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      </div>
    );
  }

  const logoUrl = client?.logoUrl;
  const logoDisplaySrc = logoUrl
    ? (/^https?:\/\//i.test(logoUrl) ? `/api/brand-assets/proxy-image?url=${encodeURIComponent(logoUrl)}` : logoUrl)
    : "";
  const extractedLogo = websiteAnalysisResult?.logoCandidates?.[0] ?? null;
  const recommendedPalette = [
    { label: "Primary", hex: websiteAnalysisResult?.palette?.primary },
    { label: "Secondary", hex: websiteAnalysisResult?.palette?.secondary },
    { label: "Accent", hex: websiteAnalysisResult?.palette?.accent },
  ].filter((color): color is { label: string; hex: string } => Boolean(color.hex));
  const moreDetectedColors = (websiteAnalysisResult?.colors ?? []).filter(
    (color) => !recommendedPalette.some((recommended) => recommended.hex.toLowerCase() === color.hex.toLowerCase()),
  );
  const cssFallbackColors = (websiteAnalysisResult?.cssColors ?? []).filter(
    (color) => !recommendedPalette.some((recommended) => recommended.hex.toLowerCase() === color.hex.toLowerCase()),
  );
  const hasVisiblePalette = (websiteAnalysisResult?.visibleColors?.length ?? 0) > 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand DNA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Set your brand voice, audience, colors, and goals. AI uses this before generating content.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Brand Setup → AI Ideas / Storyline → Campaign Planner / Marketing Calendar → Review → Publish Queue → AI Memory
      </div>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Globe2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Website Brand Importer</CardTitle>
              <CardDescription>
                Paste the client website and let AI draft brand tone, audience, pillars, keywords, and image style notes. Nothing is saved until you apply and save.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://clientwebsite.com"
              className="flex-1"
            />
            <Button type="button" onClick={handleAnalyzeWebsite} disabled={!websiteUrl.trim() || isAnalyzingWebsite} className="gap-2">
              {isAnalyzingWebsite ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Analyze Website
            </Button>
          </div>

          {showBlockedFallback && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 space-y-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="text-sm font-semibold">This website blocked server-side reading.</p>
                  <p className="text-xs text-amber-900">
                    Upload a homepage screenshot or paste key website text.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide">Upload screenshot</label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setFallbackScreenshot(event.target.files?.[0] ?? null)}
                    className="bg-background"
                  />
                  {fallbackScreenshot && (
                    <p className="text-xs text-amber-900">{fallbackScreenshot.name}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide">Paste website text</label>
                  <Textarea
                    value={fallbackText}
                    onChange={(event) => setFallbackText(event.target.value)}
                    placeholder="Paste homepage, about, product, or service copy here..."
                    rows={4}
                    className="bg-background"
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={handleAnalyzeFallback}
                disabled={isAnalyzingFallback || (!fallbackScreenshot && fallbackText.trim().length < 30)}
                className="gap-2"
              >
                {isAnalyzingFallback ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Analyze fallback
              </Button>
            </div>
          )}

          {websiteAnalysis && (
            <div className="rounded-lg border bg-background p-4 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Brand suggestions ready</p>
                  <p className="text-xs text-muted-foreground">
                    Source: {websiteAnalysisResult?.finalUrl || analysisSourceUrl}. Review before applying; importer analyzed up to five same-domain pages.
                  </p>
                  {websiteAnalysisResult?.visualExtraction?.note && (
                    <p className="mt-1 text-xs text-muted-foreground">{websiteAnalysisResult.visualExtraction.note}</p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={replaceFilledFields} onCheckedChange={(checked) => setReplaceFilledFields(checked === true)} />
                  Replace filled fields
                </label>
              </div>

              {replaceFilledFields && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>Replace filled fields is on. Applying suggestions can overwrite existing Brand Setup values.</span>
                </div>
              )}

              {(websiteAnalysisResult?.pagesAnalyzed?.length ?? 0) > 0 && (
                <div className="rounded-md border bg-muted/25 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pages analyzed</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {websiteAnalysisResult?.pagesAnalyzed?.map((page) => (
                      <Badge key={page.url} variant="outline" className="max-w-full truncate text-[10px]" title={page.url}>
                        {page.title || new URL(page.url).pathname || "Homepage"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {extractedLogo ? (
                <div className="rounded-md border bg-muted/25 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Extracted logo candidate</p>
                      <p className="text-xs text-muted-foreground mt-1">{extractedLogo.reason}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isUsingExtractedLogo}
                      onClick={() => handleUseExtractedLogo(extractedLogo.url)}
                    >
                      {isUsingExtractedLogo ? "Applying..." : "Use extracted logo"}
                    </Button>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-16 w-24 overflow-hidden rounded-md border bg-white p-2">
                      <RemotePreviewImage
                        src={remotePreviewSrc(extractedLogo)}
                        token={token}
                        alt={extractedLogo.alt || "Extracted logo"}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">{extractedLogo.url}</p>
                      <p className="text-[10px] text-muted-foreground">Validated preview from the website source.</p>
                    </div>
                  </div>
                </div>
              ) : websiteAnalysisResult ? (
                <div className="flex items-start gap-2 rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground">
                  <ImageIcon className="h-4 w-4 shrink-0" />
                  <span>No usable logo preview was found. If the website blocks logo preview, upload the logo manually.</span>
                </div>
              ) : null}

              {recommendedPalette.length > 0 && (
                <div className="rounded-md border bg-muted/25 p-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {hasVisiblePalette ? "Visible page palette" : "Recommended brand colors"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {hasVisiblePalette
                        ? "Palette detected from rendered screenshot and used first when applying suggestions."
                        : "Ranked from logo, header, primary buttons, hero, and brand CSS signals. Treat as a best match, not a perfect extraction."}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recommendedPalette.map((color) => (
                      <div key={`${color.label}-${color.hex}`} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
                        <span className="h-5 w-5 rounded border" style={{ backgroundColor: color.hex }} />
                        <span className="text-xs font-medium">{color.label}</span>
                        <span className="font-mono text-xs">{color.hex}</span>
                      </div>
                    ))}
                  </div>
                  {moreDetectedColors.length > 0 && (
                    <details className="mt-3 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">{hasVisiblePalette ? "More visible colors" : "More detected colors"}</summary>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {moreDetectedColors.slice(0, 7).map((color) => (
                          <div key={color.hex} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
                            <span className="h-4 w-4 rounded border" style={{ backgroundColor: color.hex }} />
                            <span className="font-mono text-[10px]">{color.hex}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {cssFallbackColors.length > 0 && (
                    <details className="mt-3 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">CSS palette fallback</summary>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {cssFallbackColors.slice(0, 8).map((color) => (
                          <div key={`css-${color.hex}`} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
                            <span className="h-4 w-4 rounded border" style={{ backgroundColor: color.hex }} />
                            <span className="font-mono text-[10px]">{color.hex}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {(websiteAnalysisResult?.imageCandidates?.length ?? 0) > 0 && (
                <div className="rounded-md border bg-muted/25 p-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hero / brand images</p>
                      <p className="text-xs text-muted-foreground">Rendered hero, slideshow, and product images are prioritized when available. Reference only: remote URL import to Brand Assets is not supported yet.</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {websiteAnalysisResult?.imageCandidates?.slice(0, 4).map((image) => (
                      <div key={image.url} className="overflow-hidden rounded-md border bg-background">
                        <div className="aspect-square bg-muted">
                          <RemotePreviewImage
                            src={remotePreviewSrc(image)}
                            token={token}
                            alt={image.alt || image.reason}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="p-2">
                          <p className="truncate text-[10px] font-medium">{image.reason}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{image.alt || "No alt text"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ["Tone", websiteAnalysis.brandTone],
                  ["Audience", websiteAnalysis.targetAudience],
                  ["Products / Services", websiteAnalysis.productsServices],
                  ["USP", websiteAnalysis.usp],
                  ["Content Pillars", websiteAnalysis.contentPillars],
                  ["Style Hints", websiteAnalysis.colorStyleHints],
                  ["Keywords", websiteAnalysis.keywords],
                  ["Visual Style", websiteAnalysis.visualStyle],
                  ["Image Style", websiteAnalysis.imageStyle || websiteAnalysis.imageStyleNotes],
                  ["Font Style", websiteAnalysis.fontStyle || websiteAnalysisResult?.fontFamilies?.join(", ")],
                  ["Design Notes", websiteAnalysis.designNotes],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md bg-muted/35 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-sm mt-1 leading-relaxed">{value || "Not clear from the page"}</p>
                  </div>
                ))}
              </div>

              {websiteAnalysis.confidenceNotes && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>{websiteAnalysis.confidenceNotes}</span>
                </div>
              )}

              {(websiteAnalysisResult?.warnings?.length ?? 0) > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>{websiteAnalysisResult?.warnings?.join(" ")}</span>
                </div>
              )}

              <Button type="button" onClick={handleApplyAnalysis} className="gap-2">
                <Save className="w-4 h-4" />
                Apply suggestions to Brand Setup
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logo upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client Logo</CardTitle>
          <CardDescription>Upload a logo to represent this brand across the studio.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-xl border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <RemotePreviewImage
                  src={logoDisplaySrc}
                  token={token}
                  alt="Logo"
                  className="h-full w-full object-contain bg-white"
                />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ""; }}
              />
              <Button variant="outline" size="sm" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo}>
                <Upload className="w-4 h-4 mr-2" />
                {isUploadingLogo ? "Uploading…" : "Upload Logo"}
              </Button>
              <p className="text-xs text-muted-foreground">PNG, JPG, SVG. Max 10 MB.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Core Identity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Core Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="brandName" render={({ field }) => (
                  <FormItem><FormLabel>Brand Name</FormLabel><FormControl><Input placeholder="e.g. Furnili" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="industry" render={({ field }) => (
                  <FormItem><FormLabel>Industry</FormLabel><FormControl><Input placeholder="e.g. Luxury Furniture" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="brandValues" render={({ field }) => (
                <FormItem><FormLabel>Brand Values</FormLabel><FormControl>
                  <Textarea placeholder="e.g. Sustainable, High-quality craftsmanship, Minimalist design" {...field} value={field.value || ""} />
                </FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Voice & Audience */}
          <Card>
            <CardHeader><CardTitle className="text-base">Voice & Audience</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="voiceTone" render={({ field }) => (
                  <FormItem><FormLabel>Tone of Voice</FormLabel><FormControl><Input placeholder="e.g. Sophisticated, warm" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="targetAudience" render={({ field }) => (
                  <FormItem><FormLabel>Target Audience</FormLabel><FormControl><Input placeholder="e.g. Urban millennials" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* Colors & Typography */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Colors & Typography</CardTitle>
              <CardDescription>These are fed directly to the AI when generating images and captions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="primaryColor" render={({ field }) => (
                  <FormItem>
                    <ColorField label="Primary Color" value={field.value || ""} onChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="secondaryColor" render={({ field }) => (
                  <FormItem>
                    <ColorField label="Secondary Color" value={field.value || ""} onChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="accentColor" render={({ field }) => (
                  <FormItem>
                    <ColorField label="Accent Color" value={field.value || ""} onChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="fontStyle" render={({ field }) => (
                <FormItem><FormLabel>Font Style</FormLabel><FormControl>
                  <Input placeholder="e.g. Serif for headings, clean sans-serif for body" {...field} value={field.value || ""} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="designNotes" render={({ field }) => (
                <FormItem><FormLabel>Design Notes</FormLabel><FormControl>
                  <Textarea placeholder="Any specific design guidelines, do's and don'ts…" {...field} value={field.value || ""} rows={3} />
                </FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Visual & Market Context */}
          <Card>
            <CardHeader><CardTitle className="text-base">Visual & Market Context</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="visualStyle" render={({ field }) => (
                <FormItem><FormLabel>Visual Style</FormLabel><FormControl>
                  <Textarea placeholder="e.g. Earth tones, clean lines, well-lit photography" {...field} value={field.value || ""} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="competitors" render={({ field }) => (
                  <FormItem><FormLabel>Competitors</FormLabel><FormControl>
                    <Textarea placeholder="Who are your main competitors?" {...field} value={field.value || ""} rows={3} />
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="additionalContext" render={({ field }) => (
                  <FormItem><FormLabel>Additional Context</FormLabel><FormControl>
                    <Textarea placeholder="Any other details the AI should know?" {...field} value={field.value || ""} rows={3} />
                  </FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* Content Strategy */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Content Strategy</CardTitle>
              <CardDescription>These guide the AI when generating campaign plans, bulk content, and post copy.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="contentThemes" render={({ field }) => (
                <FormItem><FormLabel>Content Themes / Pillars</FormLabel><FormControl>
                  <Textarea placeholder="e.g. Product showcases, behind-the-scenes, customer stories, tips & education, seasonal promotions" {...field} value={field.value || ""} rows={2} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="postingCadence" render={({ field }) => (
                <FormItem><FormLabel>Posting Cadence</FormLabel><FormControl>
                  <Input placeholder="e.g. 3x per week on Instagram, 1x per week on LinkedIn" {...field} value={field.value || ""} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="audiencePersonas" render={({ field }) => (
                <FormItem><FormLabel>Audience Personas</FormLabel><FormControl>
                  <Textarea placeholder="e.g. Home decorators aged 30-45 interested in sustainability; interior designers seeking premium suppliers" {...field} value={field.value || ""} rows={2} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="campaignGoals" render={({ field }) => (
                <FormItem><FormLabel>Current Campaign Goals</FormLabel><FormControl>
                  <Textarea placeholder="e.g. Drive product awareness, increase website traffic, grow Instagram following by 20%" {...field} value={field.value || ""} rows={2} />
                </FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={upsertBrandDna.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {upsertBrandDna.isPending ? "Saving…" : "Save Brand DNA"}
            </Button>
          </div>
        </form>
      </Form>

      {/* Brand Assets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand Assets</CardTitle>
          <CardDescription>Upload logos, palettes, brochures, and reference images. The AI can reference these when generating content.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Upload controls */}
          <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-border space-y-3">
            <div className="flex gap-3 flex-wrap">
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference_image">Reference Image</SelectItem>
                  <SelectItem value="logo">Logo</SelectItem>
                  <SelectItem value="color_palette">Color Palette</SelectItem>
                  <SelectItem value="brochure">Brochure</SelectItem>
                  <SelectItem value="sample_post">Sample Post</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="flex-1 min-w-[160px]"
                placeholder="Notes (optional)"
                value={assetNotes}
                onChange={(e) => setAssetNotes(e.target.value)}
              />
            </div>
            <input
              ref={assetInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAssetUpload(f); e.target.value = ""; }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => assetInputRef.current?.click()}
              disabled={isUploadingAsset}
            >
              <Upload className="w-4 h-4 mr-2" />
              {isUploadingAsset ? "Uploading…" : "Upload Asset"}
            </Button>
          </div>

          {/* Asset grid */}
          {assetsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}
            </div>
          ) : assets && assets.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {assets.map((asset) => {
                const Icon = ASSET_TYPE_ICONS[asset.assetType] ?? ImageIcon;
                const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(asset.fileUrl);
                return (
                  <div key={asset.id} className="relative group rounded-lg border border-border bg-card overflow-hidden">
                    <div className="aspect-square">
                      {isImage ? (
                        <img src={asset.fileUrl} alt={asset.notes || asset.assetType} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-muted/30">
                          <Icon className="w-8 h-8 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                        {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                      </Badge>
                      {asset.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{asset.notes}</p>}
                    </div>
                    <button
                      onClick={() => handleDeleteAsset(asset.id)}
                      className={cn(
                        "absolute top-2 right-2 w-7 h-7 rounded-full bg-background/80 backdrop-blur-sm border border-border",
                        "flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity",
                        "hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                      )}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No assets uploaded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
