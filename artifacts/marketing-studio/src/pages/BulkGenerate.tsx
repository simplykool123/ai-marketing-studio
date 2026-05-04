import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Zap, CheckCircle, Instagram, Facebook, Twitter, Linkedin, Globe, FileText, Loader2, ImageIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getListPostsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";

function getToken() { return localStorage.getItem("ams_token"); }
function authHeaders() {
  const t = getToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-500" },
  { value: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-600" },
  { value: "twitter", label: "Twitter / X", icon: Twitter, color: "text-sky-500" },
  { value: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-indigo-600" },
  { value: "blog", label: "Blog", icon: Globe, color: "text-amber-600" },
];

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  twitter: "bg-sky-50 text-sky-700 border-sky-200",
  linkedin: "bg-indigo-50 text-indigo-700 border-indigo-200",
  blog: "bg-amber-50 text-amber-700 border-amber-200",
};

type GeneratedPost = {
  id: string;
  topic: string;
  caption: string;
  hashtags?: string;
  platform?: string;
  status: string;
  generationStatus?: string;
  selectedImageUrl?: string;
  createdAt: string;
};

const POLL_INTERVAL_MS = 2500;

export default function BulkGenerate() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [weeks, setWeeks] = useState("1");
  const [postsPerWeek, setPostsPerWeek] = useState("5");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["instagram", "facebook", "linkedin"]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [isDone, setIsDone] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const postIdsRef = useRef<Set<string>>(new Set());

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const totalPosts = parseInt(weeks) * parseInt(postsPerWeek);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/posts?status=draft`, {
          headers: authHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        const allPosts: GeneratedPost[] = Array.isArray(data) ? data : (data.posts ?? []);
        const relevant = allPosts.filter((p) => postIdsRef.current.has(p.id));

        if (relevant.length > 0) {
          setGeneratedPosts(relevant);
          queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId ?? "") });
        }

        const allSettled = relevant.every(
          (p) => p.generationStatus === "ready" || p.generationStatus === "failed"
        );
        if (allSettled && relevant.length === postIdsRef.current.size) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          const readyCount = relevant.filter((p) => p.generationStatus === "ready").length;
          toast({
            title: `${readyCount} images generated`,
            description: "All posts now have images ready for review.",
          });
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL_MS);
  };

  const handleGenerate = async () => {
    if (!clientId || selectedPlatforms.length === 0) return;
    setIsGenerating(true);
    setGeneratedPosts([]);
    setIsDone(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    postIdsRef.current = new Set();

    try {
      const res = await fetch(`/api/clients/${clientId}/generate-bulk`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          weeks: parseInt(weeks),
          postsPerWeek: parseInt(postsPerWeek),
          platforms: selectedPlatforms,
        }),
      });

      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();

      const posts: GeneratedPost[] = data.posts ?? [];
      postIdsRef.current = new Set(posts.map((p) => p.id));
      setGeneratedPosts(posts);
      setIsDone(true);
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey(clientId) });
      toast({ title: `Generated ${data.generatedCount} posts`, description: "Generating images in the background…" });

      // Start polling for image generation status
      startPolling();
    } catch {
      toast({ title: "Generation failed", description: "Check your AI provider settings.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const allImagesReady = generatedPosts.length > 0 &&
    generatedPosts.every(p => p.generationStatus === "ready" || p.generationStatus === "failed");
  const generatingCount = generatedPosts.filter(p => p.generationStatus === "generating").length;
  const readyCount = generatedPosts.filter(p => p.generationStatus === "ready").length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk Generate</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Generate a full week or month of content for this brand in one click. Posts are saved as drafts with images generated automatically.
        </p>
      </div>

      {/* Config Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configure Content Calendar</CardTitle>
          <CardDescription>The AI will generate unique, on-brand posts and images for each platform using the brand DNA and content strategy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={weeks} onValueChange={setWeeks} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 week</SelectItem>
                  <SelectItem value="2">2 weeks</SelectItem>
                  <SelectItem value="4">4 weeks (1 month)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Posts per week</Label>
              <Select value={postsPerWeek} onValueChange={setPostsPerWeek} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 posts / week</SelectItem>
                  <SelectItem value="5">5 posts / week</SelectItem>
                  <SelectItem value="7">7 posts / week</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map(p => {
                const Icon = p.icon;
                const selected = selectedPlatforms.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePlatform(p.value)}
                    disabled={isGenerating}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {p.label}
                  </button>
                );
              })}
            </div>
            {selectedPlatforms.length === 0 && (
              <p className="text-xs text-destructive">Select at least one platform</p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Will generate <span className="font-semibold text-foreground">{totalPosts} posts</span> across {selectedPlatforms.length} platform{selectedPlatforms.length !== 1 ? "s" : ""}
            </p>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || selectedPlatforms.length === 0}
              className="gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Generate Content
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Generating State */}
      {isGenerating && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
            <div>
              <p className="font-medium">Generating {totalPosts} posts…</p>
              <p className="text-sm text-muted-foreground mt-1">Claude is crafting content tailored to this brand. This may take up to 30 seconds.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {isDone && generatedPosts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              {allImagesReady ? (
                <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              )}
              <h2 className="text-base font-semibold">{generatedPosts.length} posts generated</h2>
              {!allImagesReady && generatingCount > 0 && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                  {generatingCount} image{generatingCount !== 1 ? "s" : ""} generating…
                </Badge>
              )}
              {allImagesReady && (
                <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">
                  {readyCount} with images
                </Badge>
              )}
            </div>
            <Link href={`/clients/${clientId}/drafts`}>
              <Button variant="outline" size="sm">
                <FileText className="w-4 h-4 mr-2" />
                Review in Drafts
              </Button>
            </Link>
          </div>

          <div className="space-y-2">
            {generatedPosts.map((post) => {
              const isPostGenerating = post.generationStatus === "generating";
              const isFailed = post.generationStatus === "failed";
              const isReady = post.generationStatus === "ready";
              return (
                <Card key={post.id} className="overflow-hidden">
                  <CardContent className="p-4 flex items-start gap-3">
                    {/* Status indicator */}
                    <div className="shrink-0 mt-0.5">
                      {isPostGenerating && (
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                        </div>
                      )}
                      {isReady && post.selectedImageUrl ? (
                        <img
                          src={post.selectedImageUrl}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover border border-border"
                        />
                      ) : isReady ? (
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        </div>
                      ) : null}
                      {isFailed && (
                        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {post.platform && (
                          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", PLATFORM_COLORS[post.platform] || "bg-muted text-muted-foreground")}>
                            {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{format(new Date(post.createdAt), "MMM d")}</span>
                        {isPostGenerating && (
                          <span className="text-[10px] text-blue-600 font-medium">Generating image…</span>
                        )}
                        {isReady && post.selectedImageUrl && (
                          <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5">
                            <ImageIcon className="w-3 h-3" /> Image ready
                          </span>
                        )}
                        {isFailed && (
                          <span className="text-[10px] text-red-500 font-medium">Image failed</span>
                        )}
                      </div>
                      {post.topic && <p className="text-xs font-medium text-muted-foreground mb-0.5 truncate">{post.topic}</p>}
                      <p className="text-sm line-clamp-2 leading-relaxed">{post.caption}</p>
                      {post.hashtags && <p className="text-xs text-primary/70 mt-1 line-clamp-1">{post.hashtags}</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex justify-center pt-2">
            <Link href={`/clients/${clientId}/drafts`}>
              <Button>
                <FileText className="w-4 h-4 mr-2" />
                Review & Schedule All Posts
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
