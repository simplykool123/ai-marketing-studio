import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, RefreshCw, ArrowRight, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Suggestion = {
  topic: string;
  platform: string;
  postType: string;
  rationale: string;
  hook: string;
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  twitter: "bg-sky-50 text-sky-700 border-sky-200",
  linkedin: "bg-indigo-50 text-indigo-700 border-indigo-200",
  blog: "bg-amber-50 text-amber-700 border-amber-200",
  newsletter: "bg-violet-50 text-violet-700 border-violet-200",
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", twitter: "Twitter/X",
  linkedin: "LinkedIn", blog: "Blog", newsletter: "Newsletter",
};

export default function AiBrainWidget({ clientId }: { clientId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const token = localStorage.getItem("ams_token");

  const fetchSuggestions = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/suggestions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { suggestions: Suggestion[] };
      setSuggestions(data.suggestions ?? []);
      setHasLoaded(true);
    } catch {
      toast({ title: "Could not generate suggestions", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = (topic: string) => {
    setLocation(`/clients/${clientId}/create?topic=${encodeURIComponent(topic)}`);
  };

  return (
    <Card className="border border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <CardTitle className="text-base">AI Brain</CardTitle>
            <p className="text-xs text-muted-foreground">What to post next</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSuggestions}
          disabled={isLoading}
          className="gap-1.5 text-xs"
        >
          {isLoading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {hasLoaded ? "Refresh" : "Generate Ideas"}
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="p-3 rounded-lg border border-border/40">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2 mb-3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !hasLoaded && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mb-3">
              <Brain className="w-6 h-6 text-violet-400" />
            </div>
            <p className="text-sm font-medium text-foreground">Get personalised content ideas</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
              The AI analyses your brand DNA, recent posts, and storyline to suggest what to create next.
            </p>
          </div>
        )}

        {!isLoading && suggestions.length > 0 && (
          <div className="space-y-2.5">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="group p-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-sm font-medium text-foreground leading-snug flex-1">{s.topic}</p>
                  <Badge
                    variant="outline"
                    className={`text-xs shrink-0 ${PLATFORM_COLORS[s.platform] ?? "bg-gray-50 text-gray-600"}`}
                  >
                    {PLATFORM_LABELS[s.platform] ?? s.platform}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{s.rationale}</p>
                {s.hook && (
                  <p className="text-xs italic text-foreground/60 mb-2 truncate">"{s.hook}"</p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2 text-primary hover:text-primary/80 -ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleCreate(s.topic)}
                >
                  Create Post <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
