import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  Brain, Sparkles, ArrowRight, Bookmark, Trash2, RefreshCw,
  Calendar, Lightbulb, Image as ImageIcon, AlertTriangle,
  Link2, Target, Heart, TrendingUp, Shield, BookOpen, Zap, Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useListStorylines } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiIdea = {
  id: string;
  clientId: string;
  title: string;
  idea: string;
  platforms: string;           // JSON array string
  rationale: string;
  captionAngle: string;
  imageDirection: string;
  suggestedDate: string | null;
  storylineConnection: string | null;
  avoidRepeatWarning: string | null;
  goal: string | null;
  confidenceScore: number | null;
  generationMode: string;
  status: string;
  dismissReason: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Goal config
// ---------------------------------------------------------------------------

type GoalKey = "awareness" | "engagement" | "lead_generation" | "trust_building" | "product_education";

const GOAL_CONFIG: Record<GoalKey, { label: string; color: string; icon: React.ElementType }> = {
  awareness:         { label: "Awareness",          color: "bg-blue-50 text-blue-700 border-blue-200",     icon: Target },
  engagement:        { label: "Engagement",          color: "bg-pink-50 text-pink-700 border-pink-200",     icon: Heart },
  lead_generation:   { label: "Lead Gen",            color: "bg-green-50 text-green-700 border-green-200",  icon: TrendingUp },
  trust_building:    { label: "Trust Building",      color: "bg-amber-50 text-amber-700 border-amber-200",  icon: Shield },
  product_education: { label: "Product Education",   color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: BookOpen },
};

function GoalBadge({ goal }: { goal: string | null }) {
  if (!goal) return null;
  const cfg = GOAL_CONFIG[goal as GoalKey];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-xs px-2 py-0.5 gap-1 ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Confidence score
// ---------------------------------------------------------------------------

function ConfidenceBar({ score }: { score: number | null }) {
  if (score === null) return null;
  const clamp = Math.min(100, Math.max(0, score));
  const color =
    clamp >= 80 ? "bg-green-500" :
    clamp >= 60 ? "bg-yellow-500" :
                  "bg-red-400";
  const label =
    clamp >= 80 ? "text-green-700" :
    clamp >= 60 ? "text-yellow-700" :
                  "text-red-600";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamp}%` }} />
      </div>
      <span className={`text-[10px] font-semibold tabular-nums ${label}`}>{clamp}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform chips
// ---------------------------------------------------------------------------

const PLATFORM_CHIP: Record<string, { label: string; color: string; symbol: string }> = {
  instagram:   { label: "Instagram",   color: "bg-pink-50 text-pink-700 border-pink-200",     symbol: "IG" },
  facebook:    { label: "Facebook",    color: "bg-blue-50 text-blue-700 border-blue-200",     symbol: "FB" },
  twitter:     { label: "Twitter/X",   color: "bg-sky-50 text-sky-700 border-sky-200",        symbol: "X" },
  linkedin:    { label: "LinkedIn",    color: "bg-indigo-50 text-indigo-700 border-indigo-200", symbol: "LI" },
  youtube:     { label: "YouTube",     color: "bg-red-50 text-red-700 border-red-200",        symbol: "YT" },
  blog:        { label: "Blog",        color: "bg-amber-50 text-amber-700 border-amber-200",  symbol: "BL" },
  newsletter:  { label: "Newsletter",  color: "bg-violet-50 text-violet-700 border-violet-200", symbol: "NL" },
};

function PlatformChips({ raw }: { raw: string }) {
  const platforms = parsePlatforms(raw);
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map((p) => {
        const cfg = PLATFORM_CHIP[p] ?? { label: p, color: "bg-gray-50 text-gray-600 border-gray-200", symbol: p.slice(0, 2).toUpperCase() };
        return (
          <span
            key={p}
            title={cfg.label}
            className={`inline-flex items-center justify-center text-[10px] font-bold border rounded px-1.5 py-0.5 ${cfg.color}`}
          >
            {cfg.symbol}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePlatforms(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Idea card
// ---------------------------------------------------------------------------

function IdeaCard({
  idea,
  onUse,
  onSave,
  onDismiss,
  saved = false,
}: {
  idea: AiIdea;
  onUse: (idea: AiIdea) => void;
  onSave: (idea: AiIdea) => void;
  onDismiss: (idea: AiIdea) => void;
  saved?: boolean;
}) {
  const r = idea.rationale.toLowerCase();
  const basis = [
    "Brand DNA",
    "AI Memory",
    idea.storylineConnection                                                       ? "Active Storyline"   : null,
    r.includes("gap") || r.includes("recent") || r.includes("missing")            ? "Past posts"         : null,
    r.includes("reject") || r.includes("dismiss") || r.includes("avoid")          ? "Rejected memory"    : null,
    r.includes("performance") || r.includes("worked") || r.includes("successful") ? "Approved memory"    : null,
  ].filter(Boolean);

  return (
    <Card className="border border-border/60 hover:border-primary/30 hover:shadow-sm transition-all group flex flex-col">
      <CardContent className="p-5 flex flex-col gap-3 flex-1">

        {/* ── Row 1: title + platform chips */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground leading-snug flex-1">{idea.title}</h3>
          <PlatformChips raw={idea.platforms} />
        </div>

        {/* ── Row 2: goal badge + confidence bar */}
        <div className="flex items-center gap-3">
          <GoalBadge goal={idea.goal} />
          {idea.confidenceScore !== null && (
            <div className="flex-1 min-w-0">
              <ConfidenceBar score={idea.confidenceScore} />
            </div>
          )}
          {idea.generationMode === "strategic" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-50 text-violet-700 border-violet-200 gap-1 shrink-0">
              <Zap className="w-2.5 h-2.5" />
              Strategic
            </Badge>
          )}
        </div>

        {/* ── Avoid repeat warning */}
        {idea.avoidRepeatWarning && (
          <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{idea.avoidRepeatWarning}</span>
          </div>
        )}

        {/* ── Idea description */}
        <p className="text-sm text-muted-foreground leading-relaxed">{idea.idea}</p>

        {/* ── Why this works */}
        <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-50 border border-amber-200">
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">Why this idea</p>
            <p className="text-xs text-amber-900/85 leading-relaxed">{idea.rationale}</p>
            {basis.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {basis.map((item) => (
                  <span key={item} className="text-[10px] rounded-full bg-white border border-amber-300 px-2 py-0.5 text-amber-800 font-medium">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Caption angle */}
        {idea.captionAngle && (
          <div className="bg-muted/50 rounded px-3 py-2">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-0.5">Caption angle</p>
            <p className="text-xs italic text-foreground/80">"{idea.captionAngle}"</p>
          </div>
        )}

        {/* ── Image direction */}
        {idea.imageDirection && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ImageIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{idea.imageDirection}</span>
          </div>
        )}

        {/* ── Meta: date + storyline */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {idea.suggestedDate && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Post by {formatDate(idea.suggestedDate)}
            </span>
          )}
          {idea.storylineConnection && (
            <span className="flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              Storyline: {idea.storylineConnection}
            </span>
          )}
        </div>

        {/* ── Actions (pinned to bottom) */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/40 mt-auto">
          <Button size="sm" className="h-7 text-xs gap-1.5 flex-1" onClick={() => onUse(idea)}>
            Create Draft
            <ArrowRight className="w-3 h-3" />
          </Button>
          {!saved && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onSave(idea)}>
              <Bookmark className="w-3 h-3" />
              Save
            </Button>
          )}
          <Button
            size="sm" variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
            onClick={() => onDismiss(idea)}
          >
            <Trash2 className="w-3 h-3" />
            Not useful
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function IdeaSkeleton() {
  return (
    <Card className="border border-border/40">
      <CardContent className="p-5 space-y-3">
        <div className="flex justify-between gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-5 w-12 rounded" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-2 flex-1 rounded-full self-center" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-12 w-full rounded" />
        <Skeleton className="h-8 w-full rounded" />
        <Skeleton className="h-3 w-2/3" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-7 flex-1 rounded" />
          <Skeleton className="h-7 w-14 rounded" />
          <Skeleton className="h-7 w-14 rounded" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AiBrainPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [ideas, setIdeas] = useState<AiIdea[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [strategic, setStrategic] = useState(false);

  const [dismissTarget, setDismissTarget] = useState<AiIdea | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const { data: storylines } = useListStorylines(clientId || "");
  const activeStoryline = storylines?.find((storyline) => storyline.isActive);

  const token = localStorage.getItem("ams_token");
  const authHeaders = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // ---------------------------------------------------------------------------
  // Error message helpers
  // ---------------------------------------------------------------------------

  function describeApiError(status: number, body: { error?: string; retryable?: boolean }): string {
    if (status === 503 || body.retryable) {
      return body.error ?? "Supabase connection failed — please retry in a moment.";
    }
    return body.error ?? `Request failed (${status})`;
  }

  // Load persisted ideas on mount
  const loadIdeas = useCallback(async () => {
    if (!clientId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/brain/ideas`, { headers: authHeaders });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; retryable?: boolean };
        throw new Error(describeApiError(res.status, body));
      }
      const data = await res.json() as { ideas: AiIdea[] };
      setIdeas(data.ideas ?? []);
    } catch (err) {
      toast({
        title: "Could not load ideas",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadIdeas(); }, [loadIdeas]);

  // Generate new ideas
  const handleGenerate = async () => {
    if (!clientId) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/brain/generate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ strategic }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; retryable?: boolean };
        throw new Error(describeApiError(res.status, body));
      }
      const data = await res.json() as { ideas: AiIdea[]; meta?: { mode: string; provider: string; fallbackUsed: boolean } };
      setIdeas((prev) => [...(data.ideas ?? []), ...prev]);
      const count = data.ideas?.length ?? 0;
      const modeLabel = strategic ? "strategic" : "standard";
      toast({ title: `${count} ${modeLabel} ideas generated` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const isRetryable = msg.toLowerCase().includes("retry") || msg.toLowerCase().includes("unreachable") || msg.toLowerCase().includes("connection");
      toast({
        title: isRetryable ? "Connection issue" : "Failed to generate ideas",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Optimistic update helper
  const updateIdea = async (ideaId: string, status: "saved" | "dismissed" | "used", reason?: string) => {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/clients/${clientId}/brain/ideas/${ideaId}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status, dismissReason: reason }),
      });
      if (!res.ok) throw new Error("Update failed");
      const data = await res.json() as { idea: AiIdea };
      setIdeas((prev) => prev.map((i) => (i.id === ideaId ? data.idea : i)));
    } catch {
      toast({ title: "Could not update idea", variant: "destructive" });
    }
  };

  const handleUse = (idea: AiIdea) => {
    if (!clientId) return;
    fetch(`/api/clients/${clientId}/brain/ideas/${idea.id}/use`, {
      method: "POST",
      headers: authHeaders,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "Failed to create draft");
        }
        return res.json();
      })
      .then((data: { idea: AiIdea }) => {
        setIdeas((prev) => prev.map((item) => (item.id === idea.id ? data.idea : item)));
        toast({ title: "Draft created from idea" });
        setLocation(`/clients/${clientId}/drafts`);
      })
      .catch((err) => {
        toast({
          title: "Could not use idea",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      });
  };

  const handleSave = (idea: AiIdea) => {
    updateIdea(idea.id, "saved");
    toast({ title: "Idea saved" });
  };

  const handleDismissConfirm = async () => {
    if (!dismissTarget) return;
    await updateIdea(dismissTarget.id, "dismissed", dismissReason.trim() || undefined);
    setDismissTarget(null);
    setDismissReason("");
  };

  const suggested = ideas.filter((i) => i.status === "suggested");
  const saved      = ideas.filter((i) => i.status === "saved");

  const generateButtonLabel = isGenerating
    ? "Thinking…"
    : strategic
      ? "Generate strategic plan"
      : "What should we post next?";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

      {/* ── Hero ── */}
      <div className="flex flex-col items-center text-center space-y-5 py-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center">
          <Brain className="w-7 h-7 text-violet-600" />
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Ideas</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            What should we post next, and why? Ideas combine Brand DNA, AI Memory, the active Storyline, past posts, approvals, and rejections.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 w-full max-w-2xl">
          {["Brand DNA", "AI Memory", "Storyline", "Past posts", "Approvals / rejects"].map((signal) => (
            <div key={signal} className="rounded-lg border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
              {signal}
            </div>
          ))}
        </div>

        <Card className="w-full max-w-2xl text-left border-violet-200 bg-violet-50/70">
          <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-white p-2 text-violet-700">
                <Flag className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                  {activeStoryline ? "Active storyline" : "No active storyline"}
                </p>
                <p className="text-sm font-semibold text-foreground mt-0.5">
                  {activeStoryline?.title ?? "Set a monthly theme for stronger ideas"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  AI Ideas uses the active storyline together with Brand DNA and AI Memory.
                </p>
              </div>
            </div>
            <Link href={`/clients/${clientId}/storylines`}>
              <Button variant="outline" size="sm" className="bg-white">
                Storylines
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Strategic mode toggle */}
        <div className="flex items-center gap-3 bg-muted/50 border border-border/50 rounded-lg px-4 py-2.5">
          <Switch
            id="strategic-mode"
            checked={strategic}
            onCheckedChange={setStrategic}
            disabled={isGenerating}
          />
          <div className="text-left">
            <Label htmlFor="strategic-mode" className="text-sm font-medium cursor-pointer">
              Strategic mode
            </Label>
            <p className="text-xs text-muted-foreground">
              {strategic
                ? "Deeper, targeted ideas — each tied to a specific business outcome"
                : "Broad mix of 8 ideas across formats and platforms"}
            </p>
          </div>
          {strategic && (
            <Badge variant="outline" className="ml-2 text-xs bg-violet-50 text-violet-700 border-violet-200 gap-1">
              <Zap className="w-3 h-3" />
              Agency
            </Badge>
          )}
        </div>

        <Button
          size="lg"
          className="gap-2 px-8 text-base min-w-[260px]"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Sparkles className="w-4 h-4" />}
          {generateButtonLabel}
        </Button>

        {ideas.length > 0 && !isGenerating && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleGenerate}
          >
            Generate fresh ideas
          </button>
        )}
      </div>

      {/* ── Idea grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <IdeaSkeleton key={i} />)}
        </div>
      ) : ideas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-2">
          <Brain className="w-10 h-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">No ideas yet</p>
          <p className="text-xs max-w-xs">
            Click the button above and the AI will read Brand DNA, AI Memory, past posts, and your active Storyline to suggest the next best content moves.
          </p>
        </div>
      ) : (
        <Tabs defaultValue="suggested">
          <TabsList>
            <TabsTrigger value="suggested">
              Suggested
              {suggested.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 font-medium">
                  {suggested.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="saved">
              Saved
              {saved.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 font-medium">
                  {saved.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggested" className="mt-4">
            {suggested.length === 0 ? (
              <p className="text-center py-12 text-muted-foreground text-sm">
                No suggested ideas. Generate new ideas to get strategy-backed draft starters.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suggested.map((idea) => (
                  <IdeaCard
                    key={idea.id} idea={idea}
                    onUse={handleUse} onSave={handleSave}
                    onDismiss={(i) => setDismissTarget(i)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="saved" className="mt-4">
            {saved.length === 0 ? (
              <p className="text-center py-12 text-muted-foreground text-sm">
                No saved ideas yet. Save strong angles here before turning them into drafts.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {saved.map((idea) => (
                  <IdeaCard
                    key={idea.id} idea={idea} saved
                    onUse={handleUse} onSave={handleSave}
                    onDismiss={(i) => setDismissTarget(i)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* ── Dismiss dialog ── */}
      <Dialog
        open={!!dismissTarget}
        onOpenChange={(open) => { if (!open) { setDismissTarget(null); setDismissReason(""); } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark this idea not useful?</DialogTitle>
            <DialogDescription>
              The AI remembers ideas marked not useful and avoids repeating them. Tell it why to improve future recommendations.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Why is this not useful? (optional — e.g. too salesy, already done, wrong platform)"
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            className="min-h-[80px] text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDismissTarget(null); setDismissReason(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDismissConfirm}>
              Mark not useful
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
