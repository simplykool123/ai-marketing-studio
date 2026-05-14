import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart3, Copy, Download, FileText, ImageIcon, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ReportPeriod = "this_month" | "last_month" | "custom";

type ClientReport = {
  period: ReportPeriod;
  startDate: string;
  endDate: string;
  summary: {
    postsPublished: number;
    scheduledPosts: number;
    totalReach: number;
    totalImpressions: number;
    engagementRate: number | null;
    bestPerformingPlatform: string | null;
  };
  publishedPosts: Array<{
    id: string;
    platform: string;
    caption: string;
    topic: string;
    contentType: string;
    previewUrl: string;
    publishedAt: string | null;
    publishedUrl?: string | null;
    metrics: {
      reach: number;
      impressions: number;
      likes: number;
      comments: number;
      shares: number;
    };
  }>;
  insights: {
    whatWorked: string[];
    whatDidNotWork: string[];
    whyPerformanceMayBeWeak: string[];
    repeatRisks: string[];
    topTopics: string[];
    analyticsMissing: boolean;
  };
  recommendations: {
    recommendedTopics: string[];
    campaignIdeas: string[];
    contentFormatsToTry: string[];
    platformSpecificSuggestions: string[];
    avoidRepeating: string[];
  };
};

async function fetchReport(clientId: string, period: ReportPeriod, startDate: string, endDate: string): Promise<ClientReport> {
  const params = new URLSearchParams({ period });
  if (period === "custom") {
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
  }
  const res = await fetch(`${BASE}/api/clients/${clientId}/reports/summary?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to build report");
  return res.json();
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function numberText(value: number): string {
  return value > 0 ? value.toLocaleString() : "Not available";
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground italic">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 6).map((item) => (
        <li key={item} className="text-sm text-muted-foreground leading-relaxed">- {item}</li>
      ))}
    </ul>
  );
}

function Preview({ url, contentType }: { url: string; contentType: string }) {
  const isVideo = contentType === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(url);
  if (url && isVideo) return <video src={url} controls className="h-16 w-16 rounded-md border object-cover" />;
  if (url) return <img src={url} alt="" className="h-16 w-16 rounded-md border object-cover" />;
  return (
    <div className="h-16 w-16 rounded-md border bg-muted flex items-center justify-center">
      <ImageIcon className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

export default function Reports() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const [period, setPeriod] = useState<ReportPeriod>("this_month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const reportQuery = useQuery({
    queryKey: ["client-report", clientId, period, startDate, endDate],
    queryFn: () => fetchReport(clientId!, period, startDate, endDate),
    enabled: !!clientId,
  });

  const report = reportQuery.data;
  const reportText = useMemo(() => {
    if (!report) return "";
    return [
      `Client Report: ${format(new Date(report.startDate), "MMM d, yyyy")} - ${format(new Date(report.endDate), "MMM d, yyyy")}`,
      `Published posts: ${report.summary.postsPublished}`,
      `Scheduled posts: ${report.summary.scheduledPosts}`,
      `Reach: ${numberText(report.summary.totalReach)}`,
      `Impressions: ${numberText(report.summary.totalImpressions)}`,
      `Engagement rate: ${report.summary.engagementRate === null ? "Not available" : `${report.summary.engagementRate}%`}`,
      "",
      "What worked:",
      ...(report.insights.whatWorked.length ? report.insights.whatWorked.map((item) => `- ${item}`) : ["- Not enough data yet"]),
      "",
      "Next recommendations:",
      ...report.recommendations.recommendedTopics.map((item) => `- ${item}`),
    ].join("\n");
  }, [report]);

  const copySummary = async () => {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      toast({ title: "Report summary copied" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access is unavailable.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-1">
            Client-facing summary of published content, available analytics, social intelligence, and next steps.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Select value={period} onValueChange={(value) => setPeriod(value as ReportPeriod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="last_month">Last month</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-40" />
              <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-40" />
            </>
          )}
          <Button variant="outline" onClick={() => report && downloadJson("client-report.json", report)} disabled={!report}>
            <Download className="h-4 w-4 mr-2" />
            Download JSON
          </Button>
          <Button variant="outline" onClick={copySummary} disabled={!report}>
            <Copy className="h-4 w-4 mr-2" />
            Copy summary
          </Button>
        </div>
      </div>

      {reportQuery.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : reportQuery.error ? (
        <Card className="border-destructive/30">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Report could not be loaded. Try again after refreshing the page.
          </CardContent>
        </Card>
      ) : report ? (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ["Posts published", report.summary.postsPublished.toLocaleString()],
              ["Scheduled posts", report.summary.scheduledPosts.toLocaleString()],
              ["Reach", numberText(report.summary.totalReach)],
              ["Engagement rate", report.summary.engagementRate === null ? "Not available" : `${report.summary.engagementRate}%`],
              ["Best platform", report.summary.bestPerformingPlatform ?? "Not available"],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold capitalize">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {report.insights.analyticsMissing && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4 text-sm text-amber-900">
                Analytics will appear after connected platforms return metrics.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-4 w-4 text-primary" />
                Content Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.publishedPosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No posts were published in this period yet.</p>
              ) : (
                <div className="space-y-3">
                  {report.publishedPosts.map((post) => (
                    <div key={post.id} className="flex gap-3 rounded-lg border p-3">
                      <Preview url={post.previewUrl} contentType={post.contentType} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="capitalize">{post.platform}</Badge>
                          {post.publishedAt && <span className="text-xs text-muted-foreground">{format(new Date(post.publishedAt), "MMM d, yyyy")}</span>}
                        </div>
                        <p className="mt-1 text-sm font-medium line-clamp-1">{post.topic}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{post.caption}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reach {numberText(post.metrics.reach)} · Impressions {numberText(post.metrics.impressions)} · Likes {post.metrics.likes.toLocaleString()} · Comments {post.metrics.comments.toLocaleString()} · Shares {post.metrics.shares.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Performance Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">What worked</p>
                  <BulletList items={report.insights.whatWorked} empty="Not enough performance memory yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">What did not work</p>
                  <BulletList items={report.insights.whatDidNotWork} empty="No weak patterns saved yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Why performance may be weak</p>
                  <BulletList items={report.insights.whyPerformanceMayBeWeak} empty="No weakness analysis available yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Repeat risks and top topics</p>
                  <BulletList items={[...report.insights.repeatRisks, ...report.insights.topTopics].slice(0, 8)} empty="No repeat risks detected." />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Next Month Recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Recommended topics</p>
                  <BulletList items={report.recommendations.recommendedTopics} empty="No recommendations yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Campaign ideas</p>
                  <BulletList items={report.recommendations.campaignIdeas} empty="No campaign ideas yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Formats and platform suggestions</p>
                  <BulletList items={[...report.recommendations.contentFormatsToTry, ...report.recommendations.platformSpecificSuggestions]} empty="No format suggestions yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Avoid repeating</p>
                  <BulletList items={report.recommendations.avoidRepeating} empty="No avoid-repeat guidance yet." />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
