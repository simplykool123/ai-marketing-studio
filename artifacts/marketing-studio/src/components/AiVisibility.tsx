import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  AlertCircle,
  CheckCircle2,
  Lightbulb,
  Loader2,
  Sparkles,
  TrendingUp,
  FileText,
  Instagram,
  Linkedin,
  Image as ImageIcon,
  Zap,
  Save,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VisibilityScore = {
  score: number;
  rating: "strong" | "needs_work" | "weak";
  checks: Array<{ check: string; status: "pass" | "fail" }>;
  maxScore: number;
};

type VisibilityAnalysis = {
  customerQuestions?: string[];
  faqIdeas?: Array<{ question: string; answerDirection: string }>;
  comparisonTopics?: string[];
  localSearchTopics?: string[];
  trustGaps?: string[];
  contentGaps?: string[];
  blogIdeas?: Array<{ title: string; outline: string }>;
  linkedInIdeas?: Array<{ topic: string; angle: string }>;
  instagramIdeas?: {
    carousels?: Array<{ title: string; slides: string }>;
    reels?: Array<{ concept: string; hook: string; storyboard: string }>;
  };
  imagePrompts?: Array<{ concept: string; prompt: string; purpose: string }>;
  raw?: string;
};

type Campaign = {
  campaignName?: string;
  blogOutline?: any;
  faqs?: any[];
  linkedInPosts?: any[];
  instagramPosts?: any[];
  carousel?: any;
  reel?: any;
  imagePrompts?: any[];
  schedule?: any[];
  raw?: string;
};

export default function AiVisibility() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [score, setScore] = useState<VisibilityScore | null>(null);
  const [analysis, setAnalysis] = useState<VisibilityAnalysis | null>(null);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignSaved, setCampaignSaved] = useState(false);

  const handleAnalyze = async () => {
    if (!clientId) return;

    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/ai-visibility/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() || undefined }),
      });

      if (!res.ok) throw new Error("Analysis failed");

      const data = await res.json();
      setScore(data.score);
      setAnalysis(data.analysis);
      setRecommendations(data.recommendations || []);

      toast({
        title: "Analysis complete",
        description: `AI Visibility Score: ${data.score.score}/100`,
      });
    } catch (error: any) {
      toast({
        title: "Analysis failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCampaign = async () => {
    if (!clientId || !analysis) return;

    setCampaignLoading(true);
    setCampaignSaved(false);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/ai-visibility/generate-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() || undefined, analysis }),
      });

      if (!res.ok) throw new Error("Campaign generation failed");

      const data = await res.json();
      setCampaign(data.campaign);

      toast({
        title: "Campaign generated",
        description: "Review the campaign pack below",
      });
    } catch (error: any) {
      toast({
        title: "Campaign generation failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCampaignLoading(false);
    }
  };

  const handleSaveCampaign = async () => {
    if (!clientId || !campaign) return;

    setSaveLoading(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/ai-visibility/save-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign, topic: topic.trim() || undefined, score }),
      });

      if (!res.ok) throw new Error("Failed to save campaign");

      const data = await res.json();
      setCampaignSaved(true);

      toast({
        title: "Campaign saved to Review",
        description: `Created ${data.postsCreated} draft items`,
      });
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaveLoading(false);
    }
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case "strong":
        return "text-green-600 bg-green-50 border-green-200";
      case "needs_work":
        return "text-amber-600 bg-amber-50 border-amber-200";
      case "weak":
        return "text-red-600 bg-red-50 border-red-200";
      default:
        return "text-slate-600 bg-slate-50 border-slate-200";
    }
  };

  const getRatingLabel = (rating: string) => {
    switch (rating) {
      case "strong":
        return "Strong";
      case "needs_work":
        return "Needs Work";
      case "weak":
        return "Weak";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Visibility Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Optimize for SEO + AEO + GEO + Social Search + Brand Authority
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyze AI Visibility</CardTitle>
          <CardDescription>
            Analyze your brand's discoverability across Google, AI tools (ChatGPT, Gemini, Perplexity), and social platforms
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topic">Focus Topic (Optional)</Label>
            <Input
              id="topic"
              placeholder="e.g., interior design services, digital marketing agency"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for general brand analysis, or specify a topic for focused insights
            </p>
          </div>

          <Button onClick={handleAnalyze} disabled={loading} className="w-full sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Analyze AI Visibility
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {score && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Internal AI Visibility Readiness Score</CardTitle>
            <CardDescription>
              This is an internal assessment, not a Google score. It measures your brand's readiness for AI-powered discovery.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold">{score.score}/100</div>
              <Badge className={cn("text-sm px-3 py-1", getRatingColor(score.rating))}>
                {getRatingLabel(score.rating)}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {score.checks.map((check, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md text-sm",
                    check.status === "pass" ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-600"
                  )}
                >
                  {check.status === "pass" ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span>{check.check}</span>
                </div>
              ))}
            </div>

            {recommendations.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Recommendations</h3>
                <ul className="space-y-1">
                  {recommendations.map((rec, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <Lightbulb className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {analysis && !analysis.raw && (
        <>
          {analysis.customerQuestions && analysis.customerQuestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Customer Questions People Ask AI
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.customerQuestions.map((q, idx) => (
                    <li key={idx} className="text-sm p-2 bg-slate-50 rounded-md">
                      {q}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {analysis.faqIdeas && analysis.faqIdeas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">FAQ Ideas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis.faqIdeas.map((faq, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-md space-y-1">
                      <p className="font-medium text-sm">{faq.question}</p>
                      <p className="text-xs text-muted-foreground">{faq.answerDirection}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {analysis.trustGaps && analysis.trustGaps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Trust & Proof Gaps
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.trustGaps.map((gap, idx) => (
                    <li key={idx} className="text-sm p-2 bg-amber-50 rounded-md text-amber-900">
                      {gap}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-center">
            <Button
              onClick={handleGenerateCampaign}
              disabled={campaignLoading}
              size="lg"
              className="gap-2"
            >
              {campaignLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Campaign...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Create AI Visibility Campaign
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {campaign && !campaign.raw && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold">Campaign Pack: {campaign.campaignName || "AI Visibility Campaign"}</h2>
            </div>
            <div className="flex items-center gap-2">
              {campaignSaved && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation(`/clients/${clientId}/approvals`)}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Review Queue
                </Button>
              )}
              <Button
                onClick={handleSaveCampaign}
                disabled={saveLoading || campaignSaved}
                size="sm"
                className="gap-2"
              >
                {saveLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : campaignSaved ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save Campaign to Review
                  </>
                )}
              </Button>
            </div>
          </div>

          {campaign.blogOutline && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Blog/Article Outline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-slate-50 p-4 rounded-md overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(campaign.blogOutline, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {campaign.linkedInPosts && campaign.linkedInPosts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Linkedin className="h-4 w-4" />
                  LinkedIn Authority Posts ({campaign.linkedInPosts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {campaign.linkedInPosts.map((post: any, idx: number) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-md space-y-2">
                      <p className="text-sm font-medium">{post.topic || post.hook}</p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {post.content || post.angle}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {campaign.instagramPosts && campaign.instagramPosts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Instagram className="h-4 w-4" />
                  Instagram Posts ({campaign.instagramPosts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {campaign.instagramPosts.map((post: any, idx: number) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-md space-y-2">
                      <p className="text-xs whitespace-pre-wrap">{post.caption}</p>
                      {post.hashtags && (
                        <p className="text-xs text-blue-600">{post.hashtags}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {campaign.imagePrompts && campaign.imagePrompts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Image Prompt Directions ({campaign.imagePrompts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {campaign.imagePrompts.map((prompt: any, idx: number) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-md space-y-2">
                      <p className="text-sm font-medium">{prompt.concept}</p>
                      <p className="text-xs text-muted-foreground">{prompt.prompt}</p>
                      <Badge variant="outline" className="text-xs">{prompt.purpose}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {(analysis?.raw || campaign?.raw) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raw Output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-slate-50 p-4 rounded-md overflow-auto whitespace-pre-wrap max-h-96">
              {analysis?.raw || campaign?.raw}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
