import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isAfter, parseISO } from "date-fns";
import { CalendarDays, Loader2, Sparkles, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

async function fetchOccasions(clientId: string): Promise<OccasionsResponse> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/occasions`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load occasions");
  return res.json();
}

async function generateOccasionDrafts(clientId: string, occasionId: string) {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`${BASE}/api/clients/${clientId}/occasions/${occasionId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ count: 2 }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to generate drafts");
  }
  return res.json() as Promise<{ createdDrafts: Array<{ id: string }> }>;
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

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-occasions", clientId],
    queryFn: () => fetchOccasions(clientId!),
    enabled: !!clientId,
  });

  const occasions = data?.occasions ?? [];
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

  const handleGenerate = async (occasion: Occasion) => {
    if (!clientId) return;
    setGeneratingId(occasion.id);
    try {
      const result = await generateOccasionDrafts(clientId, occasion.id);
      setLastGenerated({ occasionId: occasion.id, count: result.createdDrafts.length });
      qc.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
      qc.invalidateQueries({ queryKey: ["enhanced-dashboard", clientId] });
      toast({
        title: "Drafts created",
        description: `${result.createdDrafts.length} ${occasion.title} draft${result.createdDrafts.length === 1 ? "" : "s"} moved to Review.`,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing Calendar</h1>
          <p className="text-muted-foreground mt-1">
            Marketing calendar includes curated Indian occasions and can be expanded yearly.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/clients/${clientId}/drafts?tab=drafts`}>
            Open Review
            <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </Button>
      </div>

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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Upcoming Occasions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.map((occasion) => {
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
                    <Link href={`/clients/${clientId}/drafts?tab=drafts`} className="mt-2 inline-flex text-sm font-medium text-primary hover:underline">
                      Review {lastGenerated.count} draft{lastGenerated.count === 1 ? "" : "s"}
                    </Link>
                  )}
                </div>
                <Button onClick={() => handleGenerate(occasion)} disabled={!!generatingId} className="md:w-40">
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Drafts
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
