import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isAfter, parseISO } from "date-fns";
import { CalendarDays, Loader2, Sparkles, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getListPostsQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Occasion = {
  id: string;
  title: string;
  date: string;
  source: "curated" | "holiday_api" | "manual";
  requiresYearlyUpdate: boolean;
  observanceType: string;
  country?: "IN" | "GLOBAL";
  region?: string | null;
  category: string;
  recommendedContentTypes: string[];
  notes?: string;
};

type OccasionsResponse = {
  year: number;
  sourceNote: string;
  occasions: Occasion[];
};

type GenerateOptions = {
  platforms: string[];
  contentTypes: string[];
  count: number;
  generateImagesNow: boolean;
};

const platformOptions = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X/Twitter" },
  { value: "blog", label: "Blog" },
  { value: "newsletter", label: "Newsletter" },
];

const contentTypeOptions = [
  { value: "social_post", label: "Social post" },
  { value: "carousel", label: "Carousel outline" },
  { value: "blog", label: "Blog intro" },
  { value: "video_script", label: "Video hook" },
  { value: "image_prompt", label: "Image artwork" },
];

async function fetchOccasions(clientId: string): Promise<OccasionsResponse> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/occasions`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load occasions");
  return res.json();
}

async function fetchSocialAccounts(clientId: string): Promise<Array<{ id: string; isActive: boolean }>> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/social-accounts`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  return res.json();
}

async function generateOccasionDrafts(clientId: string, occasionId: string, options: GenerateOptions) {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/occasions/${occasionId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to generate drafts");
  }
  return res.json() as Promise<{ createdDrafts: Array<{ id: string }>; warnings?: string[] }>;
}

function readableType(type: string) {
  return type.replace(/_/g, " ");
}

export default function MarketingCalendar() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<{ occasionId: string; count: number } | null>(null);
  const [selectedOccasion, setSelectedOccasion] = useState<Occasion | null>(null);
  const [options, setOptions] = useState<GenerateOptions>({
    platforms: ["instagram", "linkedin"],
    contentTypes: ["social_post", "image_prompt"],
    count: 2,
    generateImagesNow: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-occasions", clientId],
    queryFn: () => fetchOccasions(clientId!),
    enabled: !!clientId,
  });

  const occasions = data?.occasions ?? [];
  const { data: socialAccounts = [] } = useQuery({
    queryKey: ["calendar-social-accounts", clientId],
    queryFn: () => fetchSocialAccounts(clientId!),
    enabled: !!clientId,
  });
  const hasSocialAccounts = socialAccounts.some((account) => account.isActive);
  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return occasions
      .filter((occasion) => {
        const date = parseISO(occasion.date);
        return isAfter(date, today) || date.getTime() === today.getTime();
      })
      .slice(0, 12);
  }, [occasions]);

  const featured = upcoming.slice(0, 3);

  const toggleOption = (key: "platforms" | "contentTypes", value: string) => {
    setOptions((current) => {
      const values = current[key];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [key]: next };
    });
  };

  const openGenerateModal = (occasion: Occasion) => {
    setOptions({
      platforms: ["instagram", "linkedin"],
      contentTypes: ["social_post", "image_prompt"],
      count: 2,
      generateImagesNow: false,
    });
    setSelectedOccasion(occasion);
  };

  const handleGenerate = async () => {
    const occasion = selectedOccasion;
    if (!clientId) return;
    if (!occasion) return;
    if (!options.platforms.length || !options.contentTypes.length) {
      toast({
        title: "Choose options",
        description: "Select at least one platform and one draft type.",
        variant: "destructive",
      });
      return;
    }
    setGeneratingId(occasion.id);
    try {
      const result = await generateOccasionDrafts(clientId, occasion.id, options);
      setLastGenerated({ occasionId: occasion.id, count: result.createdDrafts.length });
      qc.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
      qc.invalidateQueries({ queryKey: ["enhanced-dashboard", clientId] });
      setSelectedOccasion(null);
      toast({
        title: `${result.createdDrafts.length} drafts created for ${occasion.title}`,
        description: `Review before publishing.${result.warnings?.length ? ` ${result.warnings.length} image warning${result.warnings.length === 1 ? "" : "s"}.` : ""}`,
      });
    } catch (err) {
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Could not generate occasion drafts.",
        variant: "destructive",
      });
    } finally {
      setGeneratingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing Calendar</h1>
          <p className="text-muted-foreground mt-1">
            Turn timely occasions into brand-safe drafts using Brand DNA, AI Memory, and the active Storyline.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/clients/${clientId}/drafts?tab=drafts`}>
            Review drafts
            <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </Button>
      </div>

      {featured.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {featured.map((occasion) => (
          <Card key={occasion.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">{format(parseISO(occasion.date), "MMM d")}</div>
                  <div className="font-semibold leading-tight mt-1">{occasion.title}</div>
                </div>
                <CalendarDays className="w-4 h-4 text-primary shrink-0" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="secondary">{occasion.category}</Badge>
                <Badge variant="outline">{readableType(occasion.observanceType)}</Badge>
              </div>
            </CardContent>
          </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Upcoming occasions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <CalendarDays className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="font-medium">No upcoming occasions found</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                This page creates occasion-based drafts for Review. Use Campaign Planner while no upcoming moments are available.
              </p>
            </div>
          ) : upcoming.map((occasion) => {
            const isGenerating = generatingId === occasion.id;
            const generated = lastGenerated?.occasionId === occasion.id;
            return (
              <div key={occasion.id} className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{occasion.title}</span>
                    <Badge variant="secondary">{format(parseISO(occasion.date), "MMM d, yyyy")}</Badge>
                    <Badge variant="outline">{readableType(occasion.observanceType)}</Badge>
                    {occasion.country === "IN" && <Badge>India</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {occasion.category}
                    {occasion.region ? ` · ${occasion.region}` : ""}
                    {occasion.recommendedContentTypes.length ? ` · ${occasion.recommendedContentTypes.map(readableType).join(", ")}` : ""}
                  </div>
                  {occasion.requiresYearlyUpdate && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {occasion.notes ?? "Verify this date yearly."}
                    </div>
                  )}
                  {generated && (
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">drafts created</Badge>
                      <Link href={`/clients/${clientId}/drafts?tab=drafts`} className="inline-flex text-sm font-medium text-primary hover:underline">
                        Review {lastGenerated.count} draft{lastGenerated.count === 1 ? "" : "s"}
                      </Link>
                    </div>
                  )}
                </div>
                <Button onClick={() => openGenerateModal(occasion)} disabled={!!generatingId} className="md:w-40">
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Create drafts
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!selectedOccasion} onOpenChange={(open) => !open && !generatingId && setSelectedOccasion(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selectedOccasion && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedOccasion.title}</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {format(parseISO(selectedOccasion.date), "MMMM d, yyyy")} · Uses Brand DNA and AI Memory
                </p>
              </DialogHeader>

              <div className="space-y-5">
                {!hasSocialAccounts && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    No accounts connected yet — you can still generate and export manually.
                  </div>
                )}
                {selectedOccasion.requiresYearlyUpdate && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    This date may shift yearly. Verify before publishing.
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium mb-2">Platforms</div>
                  <div className="flex flex-wrap gap-2">
                    {platformOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => toggleOption("platforms", item.value)}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          options.platforms.includes(item.value)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Create</div>
                  <div className="flex flex-wrap gap-2">
                    {contentTypeOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => toggleOption("contentTypes", item.value)}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          options.contentTypes.includes(item.value)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Draft count</div>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setOptions((current) => ({ ...current, count }))}
                        className={`h-9 w-12 rounded-md border text-sm font-medium ${
                          options.count === count ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Generate images now</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Uses image credits. You can also create or refine final artwork later from Review.
                    </p>
                  </div>
                  <Switch
                    checked={options.generateImagesNow}
                    onCheckedChange={(checked) => setOptions((current) => ({ ...current, generateImagesNow: checked }))}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  This creates drafts only. Approve in Review to teach AI what works, then finish in Publish Queue.
                </p>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={() => setSelectedOccasion(null)} disabled={!!generatingId}>
                    Cancel
                  </Button>
                  <Button onClick={handleGenerate} disabled={!!generatingId} className="gap-2">
                    {generatingId === selectedOccasion.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate drafts
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
