import { useState } from "react";
import { useParams } from "wouter";
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
