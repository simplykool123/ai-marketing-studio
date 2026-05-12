import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  Video, Sparkles, RefreshCw, Lock, ChevronDown,
  ChevronRight, Mic, Eye, Type, Zap, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoScene {
  order: number;
  duration: string;
  visual: string;
  text: string;
  voiceover: string;
}

interface GeneratedVideoConcept {
  title: string;
  platform: string;
  hook: string;
  estimatedDuration: string;
  scenes: VideoScene[];
  voiceoverFull: string;
  subtitleStyle: string;
  cta: string;
  recommendedProvider: string;
  providerRationale: string;
  musicMood: string;
  colorGrading: string;
}

interface VideoProvider {
  name: string;
  label: string;
  available: boolean;
  website: string;
  notes: string;
}

type VideoAspectRatio = "9:16" | "1:1" | "16:9";
type VideoJobStatus = "queued" | "processing" | "completed" | "failed";

interface VideoGenerationJob {
  provider: "fal.ai";
  model: string;
  status: VideoJobStatus;
  videoUrl?: string;
  jobId?: string;
  error?: string;
}

type VideoPreparedPrompt = {
  improvedPrompt?: string;
  visualStory?: string;
  sceneBreakdown?: string[];
  cameraStyle?: string;
  motionStyle?: string;
  textOverlaySuggestions?: string[];
  brandOverlayNotes?: string;
  durationSuggestion?: string;
  platformNotes?: string;
};

// ---------------------------------------------------------------------------
// Platform display labels
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
  instagram_reels: "Instagram Reels",
  youtube_shorts:  "YouTube Shorts",
  tiktok:          "TikTok",
  instagram:       "Instagram",
  linkedin:        "LinkedIn",
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function VideoStudio() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();

  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("instagram_reels");
  const [duration, setDuration] = useState("30s");
  const [qualityMode, setQualityMode] = useState("balanced");
  const [loading, setLoading] = useState(false);
  const [concept, setConcept] = useState<GeneratedVideoConcept | null>(null);
  const [videoProviders, setVideoProviders] = useState<VideoProvider[]>([]);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  const [showFullVO, setShowFullVO] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoImageUrl, setVideoImageUrl] = useState("");
  const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>("9:16");
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<5 | 10>(5);
  const [submittingVideo, setSubmittingVideo] = useState(false);
  const [improvingVideoPrompt, setImprovingVideoPrompt] = useState(false);
  const [preparedVideoPrompt, setPreparedVideoPrompt] = useState<VideoPreparedPrompt | null>(null);
  const [videoJob, setVideoJob] = useState<VideoGenerationJob | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [fetchingVideoResult, setFetchingVideoResult] = useState(false);
  const [videoDraftTitle, setVideoDraftTitle] = useState("");
  const [videoDraftCaption, setVideoDraftCaption] = useState("");
  const [videoDraftPlatform, setVideoDraftPlatform] = useState("instagram");
  const [savingVideoDraft, setSavingVideoDraft] = useState(false);
  const [savedVideoPostId, setSavedVideoPostId] = useState<string | null>(null);

  async function generate() {
    if (!topic.trim()) {
      toast({ title: "Enter a video topic", variant: "destructive" });
      return;
    }
    setLoading(true);
    setConcept(null);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/video-studio/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({ topic, platform, duration, qualityMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      setConcept(data.generated);
      setVideoProviders(data.videoProviders ?? []);
      toast({ title: "Video concept ready", description: `${data.generated.scenes?.length ?? 0} scenes · ${data.generated.estimatedDuration}` });
    } catch (err) {
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function generateProviderVideo() {
    if (!videoPrompt.trim()) {
      toast({ title: "Enter a video prompt", variant: "destructive" });
      return;
    }
    setSubmittingVideo(true);
    setVideoError(null);
    setVideoJob(null);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/video/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({
          prompt: videoPrompt,
          imageUrl: videoImageUrl.trim() || undefined,
          durationSeconds: videoDurationSeconds,
          aspectRatio: videoAspectRatio,
        }),
      });
      const data = await res.json().catch(() => ({})) as VideoGenerationJob;
      if (!res.ok) {
        const message = data.error === "FAL_KEY is not configured"
          ? "fal.ai is not configured. Add FAL_KEY on the API server to test video generation."
          : data.error ?? "Video generation failed.";
        throw new Error(message);
      }
      setVideoJob(data);
      setSavedVideoPostId(null);
      setVideoDraftTitle((current) => current || "Generated video draft");
      setVideoDraftCaption((current) => current || videoPrompt.trim());
      toast({
        title: data.status === "completed" ? "Video generated" : "Video job queued",
        description: data.jobId ? `Job ${data.jobId}` : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Video generation failed.";
      setVideoError(message);
      toast({ title: "Video generation failed", description: message, variant: "destructive" });
    } finally {
      setSubmittingVideo(false);
    }
  }

  async function improveVideoPrompt() {
    if (!videoPrompt.trim()) {
      toast({ title: "Enter a rough video story first", variant: "destructive" });
      return;
    }
    setImprovingVideoPrompt(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/creative/prepare-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({
          mode: "video",
          userIdea: videoPrompt,
          platform,
          contentType: "video",
          aspectRatio: videoAspectRatio,
        }),
      });
      const data = await res.json().catch(() => ({})) as { prepared?: VideoPreparedPrompt; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not improve video prompt.");
      setPreparedVideoPrompt(data.prepared ?? null);
      if (data.prepared?.improvedPrompt) setVideoPrompt(data.prepared.improvedPrompt);
      toast({ title: "Video prompt improved", description: "Review and edit it before generating." });
    } catch (err) {
      toast({
        title: "Prompt improvement failed",
        description: err instanceof Error ? err.message : "Could not improve video prompt.",
        variant: "destructive",
      });
    } finally {
      setImprovingVideoPrompt(false);
    }
  }

  async function fetchVideoStatus(job: VideoGenerationJob) {
    if (!job.jobId || !job.model) return;
    const res = await fetch(`${BASE}/api/clients/${clientId}/video/status/${encodeURIComponent(job.jobId)}?model=${encodeURIComponent(job.model)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("ams_token")}` },
    });
    const data = await res.json().catch(() => ({})) as VideoGenerationJob;
    if (!res.ok) {
      const message = data.error === "FAL_KEY is not configured"
        ? "fal.ai is not configured. Add FAL_KEY on the API server to test video generation."
        : data.error ?? "Could not check video status.";
      setVideoError(message);
      setVideoJob((current) => current ? { ...current, status: "failed", error: message } : current);
      return;
    }
    setVideoJob((current) => current ? { ...current, ...data } : data);
  }

  async function fetchVideoResult(job: VideoGenerationJob) {
    if (!job.jobId || !job.model || fetchingVideoResult) return;
    setFetchingVideoResult(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/video/result/${encodeURIComponent(job.jobId)}?model=${encodeURIComponent(job.model)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("ams_token")}` },
      });
      const data = await res.json().catch(() => ({})) as VideoGenerationJob;
      if (!res.ok) {
        throw new Error(data.error ?? "Could not retrieve video result.");
      }
      setVideoJob((current) => current ? { ...current, ...data } : data);
      if (data.videoUrl) setSavedVideoPostId(null);
      if (!data.videoUrl && data.status !== "completed") {
        setVideoError("Video is not ready yet. Keep polling for the final result.");
      }
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Could not retrieve video result.");
    } finally {
      setFetchingVideoResult(false);
    }
  }

  async function saveVideoToReview() {
    if (!videoJob?.videoUrl) return;
    setSavingVideoDraft(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/video/save-to-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({
          videoUrl: videoJob.videoUrl,
          prompt: videoPrompt,
          platform: videoDraftPlatform,
          aspectRatio: videoAspectRatio,
          title: videoDraftTitle,
          caption: videoDraftCaption,
          provider: videoJob.provider,
          model: videoJob.model,
          jobId: videoJob.jobId,
        }),
      });
      const data = await res.json().catch(() => ({})) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save video to Review.");
      setSavedVideoPostId(data.id ?? null);
      toast({ title: "Video draft saved to Review." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save video to Review.";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSavingVideoDraft(false);
    }
  }

  useEffect(() => {
    if (!videoJob?.jobId || !videoJob.model) return;
    if (videoJob.status !== "queued" && videoJob.status !== "processing") return;
    const timer = window.setInterval(() => {
      void fetchVideoStatus(videoJob);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [videoJob?.jobId, videoJob?.model, videoJob?.status]);

  useEffect(() => {
    if (!videoJob?.jobId || !videoJob.model) return;
    if (videoJob.status !== "completed" || videoJob.videoUrl) return;
    void fetchVideoResult(videoJob);
  }, [videoJob?.jobId, videoJob?.model, videoJob?.status, videoJob?.videoUrl]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Video className="w-6 h-6 text-primary" /> Video Studio
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Generate a complete short-form video blueprint: hook, scene-by-scene storyboard, voiceover script, subtitle style, CTA, and AI provider recommendation.
        </p>
      </div>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Video Generation Test
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Generate a provider video, preview it, then save it to Review only when you are ready.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
            <p>Video generation may take 1-3 minutes and may use credits.</p>
            <p>Generated provider URLs may expire until you save the video to Review.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Prompt</Label>
            <textarea
              className="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Describe the short video scene, motion, camera style, mood, and subject."
              value={videoPrompt}
              onChange={(event) => setVideoPrompt(event.target.value)}
            />
          </div>
          {preparedVideoPrompt && (
            <div className="rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground space-y-2">
              {preparedVideoPrompt.visualStory && <p><span className="font-medium text-foreground">Visual story:</span> {preparedVideoPrompt.visualStory}</p>}
              {preparedVideoPrompt.sceneBreakdown?.length ? (
                <div>
                  <p className="font-medium text-foreground">Scene breakdown</p>
                  <ul className="list-disc pl-4 space-y-1">
                    {preparedVideoPrompt.sceneBreakdown.map((scene, index) => <li key={index}>{scene}</li>)}
                  </ul>
                </div>
              ) : null}
              {preparedVideoPrompt.cameraStyle && <p><span className="font-medium text-foreground">Camera:</span> {preparedVideoPrompt.cameraStyle}</p>}
              {preparedVideoPrompt.motionStyle && <p><span className="font-medium text-foreground">Motion:</span> {preparedVideoPrompt.motionStyle}</p>}
              {preparedVideoPrompt.brandOverlayNotes && <p><span className="font-medium text-foreground">Brand overlay:</span> {preparedVideoPrompt.brandOverlayNotes}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Aspect Ratio</Label>
              <Select value={videoAspectRatio} onValueChange={(value) => setVideoAspectRatio(value as VideoAspectRatio)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 vertical</SelectItem>
                  <SelectItem value="1:1">1:1 square</SelectItem>
                  <SelectItem value="16:9">16:9 landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={String(videoDurationSeconds)} onValueChange={(value) => setVideoDurationSeconds(Number(value) === 10 ? 10 : 5)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 seconds</SelectItem>
                  <SelectItem value="10">10 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Optional Image URL</Label>
              <Input
                placeholder="https://..."
                value={videoImageUrl}
                onChange={(event) => setVideoImageUrl(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={improveVideoPrompt} disabled={improvingVideoPrompt || submittingVideo} variant="outline">
              {improvingVideoPrompt
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Improving prompt...</>
                : <><Sparkles className="w-4 h-4 mr-2" /> Improve video prompt with AI</>}
            </Button>
            <Button onClick={generateProviderVideo} disabled={submittingVideo}>
              {submittingVideo
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Submitting video job...</>
                : <><Video className="w-4 h-4 mr-2" /> Generate Video</>}
            </Button>
          </div>

          {(videoJob || videoError) && (
            <div className="rounded-lg border bg-background p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {videoJob?.status && (
                  <Badge
                    variant="outline"
                    className={cn(
                      videoJob.status === "completed" && "bg-green-50 text-green-700 border-green-200",
                      (videoJob.status === "queued" || videoJob.status === "processing") && "bg-blue-50 text-blue-700 border-blue-200",
                      videoJob.status === "failed" && "bg-red-50 text-red-700 border-red-200"
                    )}
                  >
                    {videoJob.status}
                  </Badge>
                )}
                {videoJob?.provider && <Badge variant="secondary">{videoJob.provider}</Badge>}
                {videoJob?.model && <span className="text-xs text-muted-foreground break-all">{videoJob.model}</span>}
              </div>
              {videoJob?.jobId && (
                <p className="text-xs text-muted-foreground break-all">Job ID: {videoJob.jobId}</p>
              )}
              {(videoJob?.status === "queued" || videoJob?.status === "processing") && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  Polling provider status every few seconds...
                </div>
              )}
              {videoError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {videoError}
                </div>
              )}
              {videoJob?.error && !videoError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {videoJob.error}
                </div>
              )}
              {videoJob?.status === "completed" && !videoJob.videoUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchVideoResult(videoJob)}
                  disabled={fetchingVideoResult}
                >
                  {fetchingVideoResult ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-1.5" />}
                  Fetch video result
                </Button>
              )}
              {videoJob?.videoUrl && (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-lg border bg-black">
                    <video src={videoJob.videoUrl} controls className="w-full max-h-[520px]" />
                  </div>
                  <a
                    href={videoJob.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Open provider video URL <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Review title</Label>
                        <Input
                          value={videoDraftTitle}
                          onChange={(event) => setVideoDraftTitle(event.target.value)}
                          placeholder="Generated video draft"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Platform</Label>
                        <Select value={videoDraftPlatform} onValueChange={setVideoDraftPlatform}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="instagram">Instagram</SelectItem>
                            <SelectItem value="facebook">Facebook</SelectItem>
                            <SelectItem value="linkedin">LinkedIn</SelectItem>
                            <SelectItem value="youtube">YouTube</SelectItem>
                            <SelectItem value="tiktok">TikTok</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Caption</Label>
                      <textarea
                        className="min-h-[82px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={videoDraftCaption}
                        onChange={(event) => setVideoDraftCaption(event.target.value)}
                        placeholder="Caption for Review"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button onClick={saveVideoToReview} disabled={savingVideoDraft || !!savedVideoPostId} className="flex-1">
                        {savingVideoDraft ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Video className="w-4 h-4 mr-2" />}
                        {savedVideoPostId ? "Saved to Review" : "Save to Review"}
                      </Button>
                      {savedVideoPostId && (
                        <Button asChild variant="outline" className="flex-1">
                          <Link href={`/clients/${clientId}/drafts?tab=drafts`}>
                            Open Review
                          </Link>
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Saving downloads the provider video and stores a durable Review draft. It does not publish or add the video to Publish Queue automatically.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Input form */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Video Topic</Label>
            <Input
              placeholder="e.g. 3 reasons our product saves you 2 hours a day"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === "Enter" && generate()}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram_reels">Instagram Reels</SelectItem>
                  <SelectItem value="youtube_shorts">YouTube Shorts</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15s">15 seconds</SelectItem>
                  <SelectItem value="30s">30 seconds</SelectItem>
                  <SelectItem value="60s">60 seconds</SelectItem>
                  <SelectItem value="90s">90 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>AI Quality</Label>
              <Select value={qualityMode} onValueChange={setQualityMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cheap">Cheap / Fast</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="best_quality">Best Quality</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={generate} disabled={loading} className="w-full">
            {loading
              ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Building video concept…</>
              : <><Sparkles className="w-4 h-4 mr-2" /> Generate Video Blueprint</>}
          </Button>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {concept && !loading && (
        <div className="space-y-4">
          {/* Top strip */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge variant="outline">{PLATFORM_LABELS[concept.platform] ?? concept.platform}</Badge>
                <Badge variant="outline">{concept.estimatedDuration}</Badge>
                <Badge variant="outline" className="capitalize">{concept.subtitleStyle?.replace("_", " ")}</Badge>
              </div>
              <h2 className="text-base font-semibold mb-1">{concept.title}</h2>
              <div className="text-sm font-medium text-primary mb-1">
                Hook: <span className="text-foreground font-normal">{concept.hook}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                CTA: <span className="text-foreground">{concept.cta}</span>
              </div>
              <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                <span>🎵 {concept.musicMood}</span>
                <span>🎨 {concept.colorGrading}</span>
              </div>
            </CardContent>
          </Card>

          {/* Storyboard */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Eye className="w-4 h-4" /> Storyboard — {concept.scenes?.length ?? 0} scenes
            </h3>
            <div className="space-y-2">
              {concept.scenes?.map((scene, i) => (
                <Card key={i} className="overflow-hidden">
                  <button
                    className="w-full text-left"
                    onClick={() => setExpandedScene(expandedScene === i ? null : i)}
                  >
                    <CardContent className="py-3 px-4 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                        {scene.order}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">{scene.duration}</span>
                          <span className="text-sm truncate">{scene.visual}</span>
                        </div>
                        {!expandedScene && scene.text && (
                          <p className="text-[11px] text-muted-foreground truncate">{scene.text}</p>
                        )}
                      </div>
                      {expandedScene === i
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </CardContent>
                  </button>
                  {expandedScene === i && (
                    <div className="px-4 pb-3 pt-0 space-y-2 bg-muted/30 border-t">
                      <div className="flex items-start gap-2">
                        <Eye className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground">{scene.visual}</p>
                      </div>
                      {scene.text && (
                        <div className="flex items-start gap-2">
                          <Type className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-xs font-medium">{scene.text}</p>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <Mic className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                        <p className="text-xs text-foreground leading-relaxed">"{scene.voiceover}"</p>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>

          {/* Full voiceover */}
          {concept.voiceoverFull && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Mic className="w-4 h-4 text-primary" /> Full Voiceover Script
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowFullVO(!showFullVO)}>
                    {showFullVO ? "Hide" : "Show"}
                  </Button>
                </div>
              </CardHeader>
              {showFullVO && (
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground italic">"{concept.voiceoverFull}"</p>
                </CardContent>
              )}
            </Card>
          )}

          {/* Provider recommendation */}
          {videoProviders.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4" /> AI Video Providers
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                  Recommended: {concept.recommendedProvider}
                </Badge>
              </h3>
              {concept.providerRationale && (
                <p className="text-xs text-muted-foreground mb-3">{concept.providerRationale}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {videoProviders.map(p => (
                  <Card
                    key={p.name}
                    className={cn(
                      "transition-all",
                      p.name === concept.recommendedProvider
                        ? "border-amber-300 bg-amber-50/50"
                        : "opacity-70"
                    )}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{p.label}</span>
                        {p.name === concept.recommendedProvider
                          ? <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">Recommended</Badge>
                          : <Badge variant="outline" className="text-[10px]"><Lock className="w-2.5 h-2.5 mr-0.5" /> Soon</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-2">{p.notes}</p>
                      <a
                        href={p.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary flex items-center gap-1 hover:underline"
                      >
                        {p.website.replace("https://", "")}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
