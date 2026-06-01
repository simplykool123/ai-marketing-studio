import { useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  getListMemoryQueryKey,
  useAddMemory,
  useDeleteMemory,
  useGetBrandDna,
  useListMemory,
  useListPosts,
  useListStorylines,
  type BrandDna,
  type MemoryEntry,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  Image,
  Lightbulb,
  MessageSquareX,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";

type SectionId =
  | "brand"
  | "story"
  | "rules"
  | "performance"
  | "social"
  | "rejection"
  | "image"
  | "video"
  | "seo";

type SectionConfig = {
  id: SectionId;
  title: string;
  icon: typeof BrainCircuit;
  fields: string[];
  terms: string[];
};

const SECTIONS: SectionConfig[] = [
  {
    id: "brand",
    title: "Brand DNA",
    icon: ShieldCheck,
    fields: ["tone", "audience", "language", "USP", "content pillars", "visual colors/style"],
    terms: ["brand", "tone", "audience", "language", "usp", "pillar", "visual", "color", "style"],
  },
  {
    id: "story",
    title: "Story Memory",
    icon: BookOpen,
    fields: ["active storyline", "current month theme", "current chapter", "past storyline notes"],
    terms: ["story", "storyline", "theme", "chapter", "narrative"],
  },
  {
    id: "rules",
    title: "Content Rules",
    icon: Lightbulb,
    fields: ["always follow", "avoid", "approved phrases", "banned/generic phrases"],
    terms: ["rule", "always", "avoid", "banned", "generic", "phrase", "must", "never"],
  },
  {
    id: "performance",
    title: "Performance Memory",
    icon: BarChart3,
    fields: ["best performing posts", "weak posts", "what worked", "what did not work"],
    terms: ["performance", "worked", "weak", "approved", "published", "posted", "liked"],
  },
  {
    id: "social",
    title: "Social Intelligence",
    icon: Sparkles,
    fields: ["historical view", "recommendations", "platform gaps", "related topics"],
    terms: ["social intelligence", "content_strategy", "platform_learning", "avoid_repeat", "related topics", "campaign angles"],
  },
  {
    id: "rejection",
    title: "Rejection Memory",
    icon: MessageSquareX,
    fields: ["dismissed AI ideas", "dismiss reason", "avoid repeating similar ideas"],
    terms: ["rejection", "dismiss", "rejected", "too generic", "avoid repeating"],
  },
  {
    id: "image",
    title: "Image Style Memory",
    icon: Image,
    fields: ["preferred image style", "winning prompts", "rejected image styles", "brand visual rules"],
    terms: ["image", "visual", "photo", "prompt", "style"],
  },
  {
    id: "video",
    title: "Video Style Memory",
    icon: Video,
    fields: ["preferred short video style", "hook style", "scene style", "voice/subtitle preferences"],
    terms: ["video", "hook", "scene", "voice", "subtitle", "short"],
  },
  {
    id: "seo",
    title: "SEO Memory",
    icon: Search,
    fields: ["target keywords", "blog topics", "competitor angles", "internal link ideas", "SEO learnings"],
    terms: ["seo", "keyword", "blog", "competitor", "internal link", "search"],
  },
];

function matchesSection(memory: MemoryEntry, section: SectionConfig): boolean {
  const text = `${memory.key} ${memory.value}`.toLowerCase();
  return section.terms.some((term) => text.includes(term));
}

function brandFacts(brandDna: BrandDna | undefined): string[] {
  if (!brandDna) return ["Brand Setup has not been completed yet."];
  return [
    brandDna.voiceTone ? `Tone: ${brandDna.voiceTone}` : null,
    brandDna.targetAudience || brandDna.audiencePersonas
      ? `Audience: ${brandDna.targetAudience || brandDna.audiencePersonas}`
      : null,
    brandDna.additionalContext || brandDna.campaignGoals || brandDna.industry
      ? `USP: ${brandDna.additionalContext || brandDna.campaignGoals || brandDna.industry}`
      : null,
    brandDna.contentThemes ? `Content pillars: ${brandDna.contentThemes}` : null,
    [brandDna.primaryColor, brandDna.secondaryColor, brandDna.accentColor].filter(Boolean).length
      ? `Colors: ${[brandDna.primaryColor, brandDna.secondaryColor, brandDna.accentColor].filter(Boolean).join(", ")}`
      : null,
    brandDna.visualStyle || brandDna.designNotes
      ? `Visual style: ${[brandDna.visualStyle, brandDna.designNotes].filter(Boolean).join(" / ")}`
      : null,
  ].filter(Boolean) as string[];
}

const EMPTY_STATE: Partial<Record<SectionId, string>> = {
  brand:       "Complete Brand Setup or import a website to populate brand facts.",
  story:       "Create an active storyline so campaigns have a running narrative.",
  rules:       "Add strict rules the AI should always follow.",
  performance: "Approve drafts and mark posted content to teach AI what works.",
  social:      "Import connected social history to build strategic recommendations.",
  rejection:   "Reject drafts to teach AI which angles, tones, or formats to avoid.",
  image:       "Save final artwork or import website style notes to build visual memory.",
  video:       "Video memory is reserved for a later sprint.",
  seo:         "Use the website importer or blog drafts to build keyword memory.",
};

type SocialIntelligenceResponse = {
  importedPosts: number;
  platformsAnalyzed: string[];
  skipped: Array<{ platform: string; reason: string }>;
  historicalView: {
    summary: string;
    whatWorked: string[];
    whatDidNotWork: string[];
    whyNotPerforming: string[];
    contentGaps: string[];
    platformGaps: string[];
  };
  recommendationView: {
    nextBestTopics: string[];
    relatedTopics: string[];
    campaignIdeas: string[];
    quickWins: string[];
    longTermStrategy: string[];
  };
  memoryEntries: Array<{ key: string; value: string }>;
};

async function importSocialIntelligence(clientId: string): Promise<SocialIntelligenceResponse> {
  const token = localStorage.getItem("ams_token");
  const res = await fetch(`/api/clients/${clientId}/social/intelligence/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ limit: 25 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to import social intelligence");
  return data;
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

export default function Memory() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: memories = [], isLoading: memoryLoading } = useListMemory(clientId || "");
  const { data: brandDna, isLoading: brandLoading } = useGetBrandDna(clientId || "");
  const { data: storylines = [], isLoading: storyLoading } = useListStorylines(clientId || "");
  const { data: posts = [], isLoading: postsLoading } = useListPosts(clientId || "");
  const addMemory = useAddMemory();
  const deleteMemory = useDeleteMemory();

  const [selectedSection, setSelectedSection] = useState<SectionId>("rules");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [socialIntelligence, setSocialIntelligence] = useState<SocialIntelligenceResponse | null>(null);

  const activeStoryline = storylines.find((story) => story.isActive);
  const approvedPosts = posts.filter((post) => ["approved", "export_ready", "ready_to_post", "scheduled", "exported", "posted", "posted_manually", "published", "published_via_api"].includes(post.status));
  const rejectedPosts = posts.filter((post) => post.status === "rejected");
  const isLoading = memoryLoading || brandLoading || storyLoading || postsLoading;
  const socialMemories = memories.filter((memory) => `${memory.key} ${memory.value}`.toLowerCase().includes("social intelligence"));

  const socialImport = useMutation({
    mutationFn: () => importSocialIntelligence(clientId!),
    onSuccess: (result) => {
      setSocialIntelligence(result);
      queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey(clientId!) });
      toast({
        title: result.importedPosts ? "Social intelligence updated" : "No social posts imported",
        description: result.importedPosts
          ? `${result.importedPosts} past posts analyzed. Insights were saved to AI Memory.`
          : "Connect a platform with readable history, then try again.",
      });
    },
    onError: (err) => toast({
      title: "Social intelligence failed",
      description: err instanceof Error ? err.message : "Could not analyze connected social history.",
      variant: "destructive",
    }),
  });

  const groupedMemories = useMemo(() => {
    const groups = new Map<SectionId, MemoryEntry[]>();
    for (const section of SECTIONS) {
      groups.set(section.id, memories.filter((memory) => matchesSection(memory, section)));
    }
    return groups;
  }, [memories]);

  const memorySummary = [
    { label: "Brand DNA",    count: brandDna ? brandFacts(brandDna).length : 0,                                          icon: ShieldCheck,    color: "text-blue-600 bg-blue-50 border-blue-100" },
    { label: "Storyline",    count: activeStoryline ? 1 : 0,                                                               icon: BookOpen,       color: "text-violet-600 bg-violet-50 border-violet-100" },
    { label: "Rules",        count: groupedMemories.get("rules")?.length ?? 0,                                             icon: Lightbulb,      color: "text-amber-600 bg-amber-50 border-amber-100" },
    { label: "Rejections",   count: (groupedMemories.get("rejection")?.length ?? 0) + rejectedPosts.length,                icon: MessageSquareX, color: "text-red-500 bg-red-50 border-red-100" },
    { label: "Performance",  count: (groupedMemories.get("performance")?.length ?? 0) + approvedPosts.length,              icon: BarChart3,      color: "text-green-600 bg-green-50 border-green-100" },
    { label: "Social Intel",  count: socialMemories.length,                                                                 icon: Sparkles,       color: "text-purple-600 bg-purple-50 border-purple-100" },
    { label: "Image Style",  count: groupedMemories.get("image")?.length ?? 0,                                             icon: Image,          color: "text-pink-600 bg-pink-50 border-pink-100" },
    { label: "SEO",          count: groupedMemories.get("seo")?.length ?? 0,                                               icon: Search,         color: "text-sky-600 bg-sky-50 border-sky-100" },
  ];

  const handleAdd = (sectionId = selectedSection) => {
    if (!key.trim() || !value.trim() || !clientId) return;
    const section = SECTIONS.find((item) => item.id === sectionId);
    const nextKey = key.includes("/") ? key : `${section?.title ?? "Memory"} / ${key.trim()}`;

    addMemory.mutate(
      { clientId, data: { key: nextKey, value } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey(clientId) });
          setKey("");
          setValue("");
          toast({ title: "Memory added" });
        },
        onError: () => toast({ title: "Failed to add memory", variant: "destructive" }),
      },
    );
  };

  const handleDelete = (memoryId: string) => {
    if (!clientId) return;
    deleteMemory.mutate(
      { clientId, memoryId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey(clientId) });
          toast({ title: "Memory deleted" });
        },
        onError: () => toast({ title: "Failed to delete memory", variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Memory</h1>
        <p className="text-muted-foreground mt-1">
          The client knowledge base behind every suggestion: Brand DNA, storyline, approvals, rejections, rules, keywords, and visual style.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {memorySummary.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 ${item.color}`}>
              <div className="flex items-center justify-between">
                <Icon className="w-3.5 h-3.5 opacity-70" />
                <p className="text-lg font-bold leading-none">{item.count}</p>
              </div>
              <p className="text-[10px] font-semibold leading-tight">{item.label}</p>
            </div>
          );
        })}
      </div>

      {/* How memory powers AI */}
      <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3">
        <p className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5">
          <BrainCircuit className="w-3.5 h-3.5" />
          How memory powers the agency workflow
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {[
            { icon: Lightbulb, text: "Generates on-brand ideas" },
            { icon: BarChart3, text: "Avoids angles that fell flat" },
            { icon: MessageSquareX, text: "Learns from every approval and rejection" },
            { icon: Image, text: "Keeps tone and style consistent" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
              <Icon className="w-3 h-3 mt-0.5 shrink-0 text-primary/60" />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <Card className="border-primary/20">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Social Intelligence
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Analyze connected social history, then save concise strategic learnings into AI Memory.
              </p>
            </div>
            <Button
              onClick={() => socialImport.mutate()}
              disabled={!clientId || socialImport.isPending}
              className="gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              {socialImport.isPending ? "Analyzing..." : "Import & analyze past social content"}
            </Button>
          </div>

          {!socialIntelligence ? (
            <div className="rounded-md border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                {socialMemories.length
                  ? `${socialMemories.length} saved social intelligence memories are already available to AI Ideas, Campaign Planner, Marketing Calendar, and rewrite skills.`
                  : "Connect Instagram, Facebook, LinkedIn, or X/Twitter to import recent public content. YouTube import is coming later."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{socialIntelligence.importedPosts} posts analyzed</Badge>
                {socialIntelligence.platformsAnalyzed.map((platform) => (
                  <Badge key={platform} variant="secondary" className="capitalize">{platform}</Badge>
                ))}
              </div>
              {socialIntelligence.skipped.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900 mb-1">Skipped platforms</p>
                  <div className="space-y-1">
                    {socialIntelligence.skipped.map((item) => (
                      <p key={`${item.platform}-${item.reason}`} className="text-xs text-amber-800 capitalize">
                        {item.platform}: {item.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold">Historical View</p>
                    <p className="text-xs text-muted-foreground mt-1">{socialIntelligence.historicalView.summary}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">What worked</p>
                    <BulletList items={socialIntelligence.historicalView.whatWorked} empty="No strong pattern detected yet." />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">What did not work</p>
                    <BulletList items={socialIntelligence.historicalView.whatDidNotWork} empty="No weak pattern detected yet." />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">Why performance may be weak</p>
                    <BulletList items={socialIntelligence.historicalView.whyNotPerforming} empty="More history is needed." />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">Platform gaps</p>
                    <BulletList items={socialIntelligence.historicalView.platformGaps} empty="No platform gaps detected." />
                  </div>
                </div>

                <div className="rounded-lg border bg-primary/5 p-4 space-y-4">
                  <p className="text-sm font-semibold">Recommendations</p>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">Related topics</p>
                    <BulletList items={socialIntelligence.recommendationView.relatedTopics} empty="No related topics yet." />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">Next best content angles</p>
                    <BulletList items={socialIntelligence.recommendationView.nextBestTopics} empty="No recommendation yet." />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">Campaign ideas</p>
                    <BulletList items={socialIntelligence.recommendationView.campaignIdeas} empty="No campaign ideas yet." />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2">Quick wins</p>
                    <BulletList items={socialIntelligence.recommendationView.quickWins} empty="No quick wins yet." />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Memory section</Label>
              <select
                value={selectedSection}
                onChange={(event) => setSelectedSection(event.target.value as SectionId)}
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {SECTIONS.map((section) => (
                  <option key={section.id} value={section.id}>{section.title}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Key</Label>
              <Input value={key} onChange={(event) => setKey(event.target.value)} placeholder="e.g. Always follow" className="mt-2" />
            </div>
            <div>
              <Label>Learning</Label>
              <div className="flex gap-2 mt-2">
                <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="What should AI remember?" />
                <Button onClick={() => handleAdd()} disabled={!key.trim() || !value.trim() || addMemory.isPending}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const sectionMemories = groupedMemories.get(section.id) ?? [];
          const facts =
            section.id === "brand"
              ? brandFacts(brandDna)
              : section.id === "story"
                ? [
                    activeStoryline ? `Active storyline: ${activeStoryline.title}` : "No active storyline.",
                    activeStoryline?.narrative ? `Current chapter: ${activeStoryline.narrative}` : null,
                  ].filter(Boolean) as string[]
                : section.id === "performance"
                  ? [
                      `${approvedPosts.length} approved/post-ready posts available for learning.`,
                      rejectedPosts.length ? `${rejectedPosts.length} rejected drafts to avoid repeating.` : null,
                    ].filter(Boolean) as string[]
                  : [];

          return (
            <Card key={section.id} className="bg-card">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-semibold">{section.title}</h2>
                      <p className="text-xs text-muted-foreground">{section.fields.join(" · ")}</p>
                    </div>
                  </div>
                  <Badge variant="outline">{sectionMemories.length}</Badge>
                </div>

                {facts.length > 0 && (
                  <div className="space-y-1.5 rounded-md bg-muted/30 p-3">
                    {facts.map((fact) => (
                      <p key={fact} className="text-xs text-muted-foreground">{fact}</p>
                    ))}
                  </div>
                )}

                {sectionMemories.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 italic">
                    {EMPTY_STATE[section.id] ?? "No learnings yet. Add one above when there is a rule AI should remember."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sectionMemories.map((memory) => (
                      <div key={memory.id} className="group rounded-md border border-border/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-primary">{memory.key}</p>
                            <p className="text-sm mt-1 leading-relaxed">{memory.value}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(memory.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {section.id === selectedSection && (
                  <div className="pt-2 border-t border-border/60">
                    <Textarea
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={`Add a ${section.title.toLowerCase()} learning`}
                      className="min-h-[70px] text-sm"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
