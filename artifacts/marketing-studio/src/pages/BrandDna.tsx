import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Upload, Trash2, ImageIcon, Palette, FileText, Image, BookOpen, Layers } from "lucide-react";
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

export default function BrandDna() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const [assetType, setAssetType] = useState<string>("reference_image");
  const [assetNotes, setAssetNotes] = useState("");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);

  const { data: brandDna, isLoading } = useGetBrandDna(clientId || "");
  const { data: client } = useGetClient(clientId || "");
  const { data: assets, isLoading: assetsLoading } = useListBrandAssets(clientId || "");
  const upsertBrandDna = useUpsertBrandDna();
  const deleteAsset = useDeleteBrandAsset();

  const form = useForm<BrandDnaFormValues>({
    resolver: zodResolver(brandDnaSchema),
    defaultValues: {
      brandName: "", voiceTone: "", targetAudience: "", industry: "",
      brandValues: "", visualStyle: "", competitors: "", additionalContext: "",
      primaryColor: "", secondaryColor: "", accentColor: "", fontStyle: "", designNotes: "",
      contentThemes: "", postingCadence: "", audiencePersonas: "", campaignGoals: "",
    },
  });

  useEffect(() => {
    if (brandDna) {
      form.reset({
        brandName: brandDna.brandName || "",
        voiceTone: brandDna.voiceTone || "",
        targetAudience: brandDna.targetAudience || "",
        industry: brandDna.industry || "",
        brandValues: brandDna.brandValues || "",
        visualStyle: brandDna.visualStyle || "",
        competitors: brandDna.competitors || "",
        additionalContext: brandDna.additionalContext || "",
        primaryColor: brandDna.primaryColor || "",
        secondaryColor: brandDna.secondaryColor || "",
        accentColor: brandDna.accentColor || "",
        fontStyle: brandDna.fontStyle || "",
        designNotes: brandDna.designNotes || "",
        contentThemes: brandDna.contentThemes || "",
        postingCadence: brandDna.postingCadence || "",
        audiencePersonas: brandDna.audiencePersonas || "",
        campaignGoals: brandDna.campaignGoals || "",
      });
    }
  }, [brandDna, form]);

  const onSubmit = (data: BrandDnaFormValues) => {
    if (!clientId) return;
    upsertBrandDna.mutate(
      { clientId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBrandDnaQueryKey(clientId) });
          toast({ title: "Brand DNA saved" });
        },
        onError: () => toast({ title: "Failed to save Brand DNA", variant: "destructive" }),
      }
    );
  };

  const handleLogoUpload = async (file: File) => {
    if (!clientId) return;
    setIsUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clients/${clientId}/upload/logo`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
      toast({ title: "Logo uploaded successfully" });
    } catch {
      toast({ title: "Failed to upload logo", variant: "destructive" });
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
      const res = await fetch(`/api/clients/${clientId}/upload/asset`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: getListBrandAssetsQueryKey(clientId) });
      setAssetNotes("");
      toast({ title: "Asset uploaded" });
    } catch {
      toast({ title: "Failed to upload asset", variant: "destructive" });
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card><CardContent className="p-6 space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      </div>
    );
  }

  const logoUrl = client?.logoUrl;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand DNA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Define voice, visuals, and brand colors. The AI uses all of this when generating content.
        </p>
      </div>

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
                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
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
