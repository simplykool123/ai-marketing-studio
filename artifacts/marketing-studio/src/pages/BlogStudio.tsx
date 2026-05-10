import { useState } from "react";
import { useParams } from "wouter";
import {
  Newspaper, Sparkles, RefreshCw, Save, Copy, CheckCircle2,
  ChevronDown, ChevronRight, ExternalLink, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlogSection {
  heading: string;
  content: string;
}

interface BlogFaq {
  q: string;
  a: string;
}

interface GeneratedBlog {
  researchSummary: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  outline: string[];
  faq: BlogFaq[];
  schemaType: string;
  schemaSuggestion: string;
  fullDraft: string;
  sections: BlogSection[];
  estimatedReadTime: string;
  targetKeywords: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={copy}>
      {copied ? <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" /> : <Copy className="w-3 h-3 mr-1" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BlogStudio() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();

  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState("professional");
  const [wordCount, setWordCount] = useState("1200");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gen, setGen] = useState<GeneratedBlog | null>(null);
  const [postId, setPostId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [faqOpen, setFaqOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);

  async function generate() {
    if (!keyword.trim()) {
      toast({ title: "Enter a keyword or topic", variant: "destructive" });
      return;
    }
    setLoading(true);
    setGen(null);
    setPostId(null);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}/blog/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({ keyword, tone, wordCount: parseInt(wordCount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      setGen(data.generated);
      setEditDraft(data.generated.fullDraft ?? "");
      setPostId(data.post?.id ?? null);
      toast({ title: "Blog post generated", description: `${data.generated.estimatedReadTime} · Saved as draft` });
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

  async function saveDraft() {
    if (!postId) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/clients/${clientId}/blog/posts/${postId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("ams_token")}`,
        },
        body: JSON.stringify({
          longFormBody: JSON.stringify({ ...(gen ?? {}), fullDraft: editDraft }),
        }),
      });
      toast({ title: "Draft saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Newspaper className="w-6 h-6 text-primary" /> Blog Studio
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enter a keyword or topic and get a full SEO-optimised blog post with outline, FAQ, schema markup, and a publication-ready draft.
        </p>
      </div>

      {/* Input form */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Keyword / Topic</Label>
            <Input
              placeholder="e.g. How to build a morning routine for entrepreneurs"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && generate()}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="conversational">Conversational</SelectItem>
                  <SelectItem value="authoritative">Authoritative</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Word Count</Label>
              <Select value={wordCount} onValueChange={setWordCount}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="800">~800 words</SelectItem>
                  <SelectItem value="1200">~1,200 words</SelectItem>
                  <SelectItem value="1800">~1,800 words</SelectItem>
                  <SelectItem value="2500">~2,500 words</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 flex items-end pb-0.5">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Provider quality is configured per skill in Settings.
              </p>
            </div>
          </div>
          <Button onClick={generate} disabled={loading} className="w-full">
            {loading
              ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Writing blog post…</>
              : <><Sparkles className="w-4 h-4 mr-2" /> Generate Blog Post</>}
          </Button>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {gen && !loading && (
        <div className="space-y-4">
          {/* SEO meta strip */}
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base leading-tight">{gen.seoTitle}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{gen.metaDescription}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <code className="text-[10px] bg-muted px-2 py-0.5 rounded">/{gen.slug}</code>
                    <Badge variant="outline" className="text-xs">{gen.estimatedReadTime}</Badge>
                    <Badge variant="outline" className="text-xs">{gen.schemaType}</Badge>
                  </div>
                </div>
                <CopyButton text={gen.seoTitle} />
              </div>
              {gen.targetKeywords?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {gen.targetKeywords.map((k, i) => (
                    <span key={i} className="text-[10px] bg-white border border-green-200 text-green-800 px-2 py-0.5 rounded-full">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Research summary */}
          {gen.researchSummary && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Research Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{gen.researchSummary}</p>
                <p className="text-[10px] text-muted-foreground mt-2 italic">
                  Note: Live SERP research coming soon (Tavily/Exa integration). Currently uses brand context + AI knowledge.
                </p>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="draft">
            <TabsList>
              <TabsTrigger value="draft">Full Draft</TabsTrigger>
              <TabsTrigger value="outline">Outline</TabsTrigger>
              <TabsTrigger value="faq">FAQ</TabsTrigger>
              <TabsTrigger value="schema">Schema</TabsTrigger>
            </TabsList>

            <div className="mt-4">
              {/* Full Draft */}
              <TabsContent value="draft">
                <Card>
                  <CardHeader className="pb-2 flex-row items-center justify-between">
                    <CardTitle className="text-sm">Full Draft</CardTitle>
                    <div className="flex gap-2">
                      <CopyButton text={editDraft} />
                      {postId && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={saveDraft} disabled={saving}>
                          {saving ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                          {saving ? "Saving…" : "Save Draft"}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[500px] font-mono text-sm leading-relaxed"
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Outline */}
              <TabsContent value="outline">
                <Card>
                  <CardContent className="pt-4 space-y-2">
                    {gen.outline?.map((section, i) => (
                      <div key={i} className="flex items-start gap-3 py-1.5 border-b last:border-0">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm">{section}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* FAQ */}
              <TabsContent value="faq">
                <div className="space-y-3">
                  {gen.faq?.map((f, i) => (
                    <Card key={i}>
                      <CardContent className="py-3 px-4">
                        <p className="font-medium text-sm mb-1">{f.q}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              {/* Schema */}
              <TabsContent value="schema">
                <Card>
                  <CardHeader className="pb-2 flex-row items-center justify-between">
                    <CardTitle className="text-sm">JSON-LD Schema ({gen.schemaType})</CardTitle>
                    <CopyButton text={gen.schemaSuggestion ?? ""} />
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-3">
                      Paste this inside a <code className="bg-muted px-1 rounded">{"<script type=\"application/ld+json\">"}</code> tag in your page {"<head>"}.
                    </p>
                    <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto whitespace-pre-wrap">
                      {gen.schemaSuggestion}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}
