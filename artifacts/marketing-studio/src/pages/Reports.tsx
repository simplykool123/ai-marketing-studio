import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart3, CalendarDays, Copy, Download, FileText, ImageIcon, Printer } from "lucide-react";
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
    draftsGenerated?: number;
    approvedDrafts?: number;
    rejectedDrafts?: number;
    campaignCount?: number;
    platformMix?: Record<string, number>;
    formatMix?: Record<string, number>;
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
  const token = localStorage.getItem("ams_token");
  const params = new URLSearchParams({ period });
  if (period === "custom") {
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
  }
  const res = await fetch(`${BASE}/api/clients/${clientId}/reports/summary?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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

function metricText(value: number): string {
  return value > 0 ? value.toLocaleString() : "Still building";
}

function engagementText(value: number | null): string {
  if (value === null || value <= 0) return "Still building";
  return `${value}%`;
}

function periodText(report: ClientReport): string {
  return `${format(new Date(report.startDate), "MMM d, yyyy")} to ${format(new Date(report.endDate), "MMM d, yyyy")}`;
}

function firstItems(items: string[], fallback: string, limit = 4): string[] {
  return items.length ? items.slice(0, limit) : [fallback];
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
  const hasPublishedPosts = (report?.publishedPosts.length ?? 0) > 0;
  const hasAnalytics = !!report && !report.insights.analyticsMissing && (
    report.summary.totalReach > 0 ||
    report.summary.totalImpressions > 0 ||
    (report.summary.engagementRate ?? 0) > 0
  );

  const executiveSummary = useMemo(() => {
    if (!report) return "";
    const workDone = report.summary.postsPublished > 0
      ? `${report.summary.postsPublished.toLocaleString()} post${report.summary.postsPublished === 1 ? " was" : "s were"} published during this period`
      : "No published posts are recorded for this period yet";
    const scheduled = report.summary.scheduledPosts > 0
      ? `, with ${report.summary.scheduledPosts.toLocaleString()} scheduled for upcoming activity`
      : "";
    const performance = hasAnalytics
      ? `Available performance shows ${metricText(report.summary.totalReach).toLowerCase()} reach, ${metricText(report.summary.totalImpressions).toLowerCase()} impressions, and ${engagementText(report.summary.engagementRate).toLowerCase()} engagement.`
      : "Performance metrics are still being collected as connected platforms return analytics.";
    return `${workDone}${scheduled}. ${performance}`;
  }, [hasAnalytics, report]);

  const clientSummaryText = useMemo(() => {
    if (!report) return "";
    const whatPerformed = hasAnalytics
      ? [
          `Reach: ${numberText(report.summary.totalReach)}`,
          `Impressions: ${numberText(report.summary.totalImpressions)}`,
          `Engagement rate: ${report.summary.engagementRate === null ? "Not available yet" : `${report.summary.engagementRate}%`}`,
          `Best platform: ${report.summary.bestPerformingPlatform ?? "Still building"}`,
          ...firstItems(report.insights.whatWorked, "Performance signals are still building as more results come in.", 3),
        ]
      : ["Analytics will appear after connected platforms return metrics."];
    const needsImprovement = [
      ...firstItems(report.insights.whatDidNotWork, "No clear underperforming pattern has been identified yet.", 3),
      ...report.insights.whyPerformanceMayBeWeak.slice(0, 2),
    ];
    const nextPlan = [
      ...firstItems(report.recommendations.recommendedTopics, "Keep publishing consistently so stronger patterns can emerge.", 3),
      ...report.recommendations.campaignIdeas.slice(0, 2),
      ...report.recommendations.contentFormatsToTry.slice(0, 2),
    ];
    return [
      `Client Report: ${periodText(report)}`,
      "",
      "What was done:",
      report.summary.postsPublished > 0
        ? `- ${report.summary.postsPublished.toLocaleString()} post${report.summary.postsPublished === 1 ? " was" : "s were"} published.`
        : "- No published posts in this period yet.",
      report.summary.scheduledPosts > 0
        ? `- ${report.summary.scheduledPosts.toLocaleString()} post${report.summary.scheduledPosts === 1 ? " is" : "s are"} scheduled for upcoming publishing.`
        : "- No scheduled posts are included in this period summary.",
      "",
      "What performed:",
      ...whatPerformed.map((item) => `- ${item}`),
      "",
      "What needs improvement:",
      ...needsImprovement.map((item) => `- ${item}`),
      "",
      "Next month plan:",
      ...nextPlan.map((item) => `- ${item}`),
    ].join("\n");
  }, [hasAnalytics, report]);

  const copyClientSummary = async () => {
    if (!clientSummaryText) return;
    try {
      await navigator.clipboard.writeText(clientSummaryText);
      toast({ title: "Client summary copied" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access is unavailable.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 print-report">
      <style>{`
        @media print {
          @page { margin: 0.6in; }
          body { background: #fff !important; color: #111827 !important; }
          nav, aside, .no-print { display: none !important; }
          .print-report { margin: 0 !important; max-width: none !important; padding: 0 !important; }
          .print-card { break-inside: avoid; box-shadow: none !important; border-color: #d4d4d8 !important; }
          .print-section { break-inside: avoid; page-break-inside: avoid; }
          .print-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 12px !important; }
          .print-muted { color: #4b5563 !important; }
        }
      `}</style>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between no-print">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-1">
            Client-ready summary of published content, available analytics, and next steps.
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
            Export report JSON
          </Button>
          <Button variant="outline" onClick={copyClientSummary} disabled={!report}>
            <Copy className="h-4 w-4 mr-2" />
            Copy client summary
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!report}>
            <Printer className="h-4 w-4 mr-2" />
            Print / Save PDF
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
          <section className="rounded-xl border bg-card p-5 print-card print-section">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground print-muted">Client-ready report</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight">Marketing Performance Report</h2>
                <p className="mt-2 text-sm text-muted-foreground print-muted">
                  Prepared from published content, available platform analytics, and planning notes.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground print-muted">
                <CalendarDays className="h-4 w-4" />
                {periodText(report)}
              </div>
            </div>
          </section>

          <Card className="print-card print-section">
            <CardHeader>
              <CardTitle className="text-lg">Executive Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed text-muted-foreground print-muted">{executiveSummary}</p>
              {report.insights.analyticsMissing && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Analytics will appear after connected platforms return metrics.
                </div>
              )}
              {!hasPublishedPosts && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground print-muted">
                  No published posts in this period yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="print-card print-section">
            <CardHeader>
              <CardTitle className="text-lg">Period Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-5 print-grid">
                {[
                  ["AI created", (report.summary.draftsGenerated ?? 0).toLocaleString()],
                  ["Approved", (report.summary.approvedDrafts ?? 0).toLocaleString()],
                  ["Rejected", (report.summary.rejectedDrafts ?? 0).toLocaleString()],
                  ["Posts published", report.summary.postsPublished.toLocaleString()],
                  ["Scheduled posts", report.summary.scheduledPosts.toLocaleString()],
                  ["Campaigns", (report.summary.campaignCount ?? 0).toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground print-muted">{label}</p>
                    <p className="mt-2 text-2xl font-semibold capitalize">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Format mix</p>
                  <BulletList
                    items={Object.entries(report.summary.formatMix ?? {}).map(([formatName, count]) => `${formatName}: ${count}`)}
                    empty="No generated formats in this period yet."
                  />
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Platform mix</p>
                  <BulletList
                    items={Object.entries(report.summary.platformMix ?? {}).map(([platformName, count]) => `${platformName}: ${count}`)}
                    empty="No platform mix yet."
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="print-card print-section">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-4 w-4 text-primary" />
                Published Content
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.publishedPosts.length === 0 ? (
                <p className="text-sm text-muted-foreground print-muted">No published posts in this period yet.</p>
              ) : (
                <div className="space-y-3">
                  {report.publishedPosts.map((post) => (
                    <div key={post.id} className="flex gap-3 rounded-lg border p-3 print-section">
                      <Preview url={post.previewUrl} contentType={post.contentType} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="capitalize">{post.platform}</Badge>
                          {post.publishedAt && <span className="text-xs text-muted-foreground print-muted">{format(new Date(post.publishedAt), "MMM d, yyyy")}</span>}
                        </div>
                        <p className="mt-1 text-sm font-medium line-clamp-1">{post.topic}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2 print-muted">{post.caption}</p>
                        <p className="mt-1 text-xs text-muted-foreground print-muted">
                          Reach {metricText(post.metrics.reach)} · Impressions {metricText(post.metrics.impressions)} · Likes {post.metrics.likes.toLocaleString()} · Comments {post.metrics.comments.toLocaleString()} · Shares {post.metrics.shares.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="print-card print-section">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Performance Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">What performed</p>
                  <BulletList items={report.insights.whatWorked} empty={hasAnalytics ? "No standout winning pattern yet." : "Analytics will appear after connected platforms return metrics."} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Needs improvement</p>
                  <BulletList items={report.insights.whatDidNotWork} empty="No clear underperforming pattern has been identified yet." />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Missing or limited data</p>
                  <BulletList
                    items={report.insights.analyticsMissing ? ["Analytics will appear after connected platforms return metrics.", ...report.insights.whyPerformanceMayBeWeak] : report.insights.whyPerformanceMayBeWeak}
                    empty="No missing data concerns are flagged for this period."
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Repeat risks and top topics</p>
                  <BulletList items={[...report.insights.repeatRisks, ...report.insights.topTopics].slice(0, 8)} empty="No repeat risks detected." />
                </div>
              </CardContent>
            </Card>

            <Card className="print-card print-section">
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
