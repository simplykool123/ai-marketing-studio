import { useState } from "react";
import { useParams } from "wouter";
import {
  Image as ImageIcon, Sparkles, RefreshCw, CheckCircle2,
  Download, Wand2, Lock, ExternalLink,
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

interface ImagePromptVariation {
  variation: number;
  style: string;
  prompt: string;
  rationale: string;
}

interface GeneratedPrompts {
  topic: string;
  brandContext: string;
  variations: ImagePromptVariation[];
}

interface ImageProvider {
  name: string;
  label: string;
  model: string;
  available: boolean;
  notes: string;
}

type ImagePreparedPrompt = {
  improvedPrompt?: string;
  negativePrompt?: string;
  headlineSuggestion?: string;
  sublineSuggestion?: string;
  styleDirection?: string;
  paletteSuggestion?: string;
  layoutSuggestion?: string;
  platformNotes?: string;
};

// ---------------------------------------------------------------------------
// Style colours
// ---------------------------------------------------------------------------

const STYLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  photorealistic:   { bg: "bg-blue-50",    border: "border-blue-300",  text: "text-blue-700" },
  illustration:     { bg: "bg-purple-50",  border: "border-purple-300", text: "text-purple-700" },
  "bold typography": { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700" },
  minimalist:       { bg: "bg-gray-50",    border: "border-gray-300",   text: "text-gray-700" },
};

function styleColor(style: string) {
  return STYLE_COLORS[style] ?? { bg: "bg-muted", border: "border-border", text: "text-foreground" };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ImageStudio() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();

  const [topic, setTopic] = useState("");
  const [qualityMode, setQualityMode] = useState("balanced");
  const [loading, setLoading] = useState(false);
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const [preparedPrompt, setPreparedPrompt] = useState<ImagePreparedPrompt | null>(null);
  const [gen, setGen] = useState<GeneratedPrompts | null>(null);
  const [providers, setProviders] = useState<ImageProvider[]>([]);

  // Per-variation state
  const [generating, setGenerating] = useState<number | null>(null); // variation index
  const [generatedImages, setGeneratedImages] = useState<Record<number, string>>({}); // variation index → url
  const [selectedVariation, setSelectedVariation] = useState<number | null>(null);

  async function generatePrompts() {
    if (!topic.trim()) {
      toast({ title: "Enter a topic or concept", variant: "destructive" });
      return;
    }
    setLoading(true);
    setGen(null);
    setGeneratedImages({});
    setSelectedVariation(null);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/generate-prompts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({ topic, qualityMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      setGen(data.generated);
      setProviders(data.providers ?? []);
      toast({ title: "4 prompt variations ready" });
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

  async function improveImagePrompt() {
    if (!topic.trim()) {
      toast({ title: "Enter a rough image idea first", variant: "destructive" });
      return;
    }
    setImprovingPrompt(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/creative/prepare-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({
          mode: "image",
          userIdea: topic,
          platform: "image",
          contentType: "image_asset",
          aspectRatio: "1:1",
        }),
      });
      const data = await res.json().catch(() => ({})) as { prepared?: ImagePreparedPrompt; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not improve prompt.");
      setPreparedPrompt(data.prepared ?? null);
      if (data.prepared?.improvedPrompt) setTopic(data.prepared.improvedPrompt);
      toast({ title: "Prompt improved", description: "Review and edit it before generating." });
    } catch (err) {
      toast({
        title: "Prompt improvement failed",
        description: err instanceof Error ? err.message : "Could not improve prompt.",
        variant: "destructive",
      });
    } finally {
      setImprovingPrompt(false);
    }
  }

  async function generateImage(variation: ImagePromptVariation, index: number) {
    setGenerating(index);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/image-studio/generate-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({ prompt: variation.prompt, style: variation.style, topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Image generation failed");

      setGeneratedImages(prev => ({ ...prev, [index]: data.imageUrl }));
      toast({ title: "Image generated" });
    } catch (err) {
      toast({
        title: "Image generation failed",
        description: err instanceof Error ? err.message : "Check your OpenAI API key in Settings",
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  }

  async function saveStyle(variation: ImagePromptVariation) {
    setSelectedVariation(variation.variation);
    try {
      await fetch(`${BASE}/api/clients/${clientId}/image-studio/save-style`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({ style: variation.style, rationale: variation.rationale, topic }),
      });
      toast({ title: `"${variation.style}" style saved to brand memory` });
    } catch {
      toast({ title: "Could not save style preference", variant: "destructive" });
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ImageIcon className="w-6 h-6 text-primary" /> Image Studio
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enter a topic and get 4 prompt variations across different visual styles. Generate images via DALL-E 3 or save the prompt to use elsewhere.
        </p>
      </div>

      {/* Input */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Topic / Concept</Label>
            <textarea
              className="min-h-[92px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. Product launch announcement for a sustainable coffee brand"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === "Enter" && generatePrompts()}
            />
          </div>
          {preparedPrompt && (
            <div className="rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground space-y-1.5">
              {preparedPrompt.styleDirection && <p><span className="font-medium text-foreground">Style:</span> {preparedPrompt.styleDirection}</p>}
              {preparedPrompt.paletteSuggestion && <p><span className="font-medium text-foreground">Palette:</span> {preparedPrompt.paletteSuggestion}</p>}
              {preparedPrompt.layoutSuggestion && <p><span className="font-medium text-foreground">Layout:</span> {preparedPrompt.layoutSuggestion}</p>}
              {preparedPrompt.headlineSuggestion && <p><span className="font-medium text-foreground">Headline:</span> {preparedPrompt.headlineSuggestion}</p>}
              {preparedPrompt.negativePrompt && <p><span className="font-medium text-foreground">Avoid:</span> {preparedPrompt.negativePrompt}</p>}
            </div>
          )}
          <div className="flex items-end gap-4">
            <div className="space-y-1.5 flex-1">
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
            <Button onClick={improveImagePrompt} disabled={improvingPrompt || loading} variant="outline" className="flex-1">
              {improvingPrompt
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Improving…</>
                : <><Wand2 className="w-4 h-4 mr-2" /> Improve prompt with AI</>}
            </Button>
            <Button onClick={generatePrompts} disabled={loading} className="flex-1">
              {loading
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating prompts…</>
                : <><Sparkles className="w-4 h-4 mr-2" /> Generate 4 Variations</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => (
            <Card key={i}><CardContent className="pt-4 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Prompt variations */}
      {gen && !loading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">4 Prompt Variations</h2>
            <span className="text-xs text-muted-foreground">for "{gen.topic}"</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {gen.variations.map((v, i) => {
              const colors = styleColor(v.style);
              const imgUrl = generatedImages[i];
              const isGenerating = generating === i;
              const isSelected = selectedVariation === v.variation;

              return (
                <Card
                  key={i}
                  className={cn(
                    "border-2 transition-colors",
                    isSelected ? "border-primary" : "border-border",
                  )}
                >
                  {imgUrl && (
                    <div className="aspect-square overflow-hidden rounded-t-lg">
                      <img src={imgUrl} alt={v.style} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <CardContent className={cn("pt-3 pb-3", imgUrl ? "" : "pt-4")}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn(
                        "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                        colors.bg, colors.border, colors.text
                      )}>
                        {v.style}
                      </span>
                      {isSelected && (
                        <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-[10px]">
                          <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Saved
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-2">{v.prompt}</p>
                    <p className="text-[10px] text-muted-foreground italic border-t pt-2">{v.rationale}</p>

                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        disabled={isGenerating}
                        onClick={() => generateImage(v, i)}
                      >
                        {isGenerating
                          ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Generating…</>
                          : <><Wand2 className="w-3 h-3 mr-1" /> Generate Image</>}
                      </Button>
                      <Button
                        size="sm"
                        variant={isSelected ? "default" : "ghost"}
                        className="h-7 text-xs"
                        onClick={() => saveStyle(v)}
                      >
                        {isSelected ? <CheckCircle2 className="w-3 h-3" /> : "Save Style"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Provider catalogue */}
      {providers.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Image Providers</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {providers.map(p => (
              <Card key={p.name} className={cn(!p.available && "opacity-60")}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{p.label}</span>
                    {p.available
                      ? <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-[10px]">Active</Badge>
                      : <Badge variant="outline" className="text-muted-foreground text-[10px]"><Lock className="w-2.5 h-2.5 mr-0.5" /> Coming soon</Badge>}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{p.notes}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
