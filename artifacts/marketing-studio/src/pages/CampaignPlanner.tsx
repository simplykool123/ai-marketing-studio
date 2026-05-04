import { useState } from "react";
import { useParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Target, Calendar, FileText, Trash2, PenLine, Flag, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Campaign = {
  id: string;
  clientId: string;
  name: string;
  goal?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  platforms?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  active: "bg-green-50 text-green-700 border-green-200",
  completed: "bg-blue-50 text-blue-700 border-blue-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
};

const PLATFORM_OPTIONS = ["instagram", "facebook", "twitter", "linkedin", "blog", "newsletter"];

function getToken() { return localStorage.getItem("ams_token"); }
function authHeaders() {
  const t = getToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

export default function CampaignPlanner() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ name: "", goal: "", description: "", startDate: "", endDate: "", platforms: [] as string[], status: "draft" });
  const [generatePlanCampaignId, setGeneratePlanCampaignId] = useState<string | null>(null);
  const [planPostsCount, setPlanPostsCount] = useState("7");
  const [planPlatforms, setPlanPlatforms] = useState<string[]>(["instagram", "facebook", "linkedin"]);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/campaigns`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!clientId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`/api/clients/${clientId}/campaigns`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...data, platforms: data.platforms.join(",") }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", clientId] });
      toast({ title: "Campaign created" });
      handleClose();
    },
    onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      const res = await fetch(`/api/clients/${clientId}/campaigns/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ ...data, platforms: data.platforms.join(",") }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", clientId] });
      toast({ title: "Campaign updated" });
      handleClose();
    },
    onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/clients/${clientId}/campaigns/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", clientId] });
      toast({ title: "Campaign deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const handleOpen = (campaign?: Campaign) => {
    if (campaign) {
      setEditingCampaign(campaign);
      setForm({
        name: campaign.name,
        goal: campaign.goal ?? "",
        description: campaign.description ?? "",
        startDate: campaign.startDate ? campaign.startDate.slice(0, 10) : "",
        endDate: campaign.endDate ? campaign.endDate.slice(0, 10) : "",
        platforms: campaign.platforms ? campaign.platforms.split(",").filter(Boolean) : [],
        status: campaign.status,
      });
    } else {
      setEditingCampaign(null);
      setForm({ name: "", goal: "", description: "", startDate: "", endDate: "", platforms: [], status: "draft" });
    }
    setIsOpen(true);
  };

  const handleClose = () => { setIsOpen(false); setEditingCampaign(null); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editingCampaign) {
      updateMutation.mutate({ id: editingCampaign.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const togglePlatform = (p: string) => {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter(x => x !== p) : [...f.platforms, p],
    }));
  };

  const handleGeneratePlan = async () => {
    if (!clientId || !generatePlanCampaignId) return;
    setIsGeneratingPlan(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/campaigns/${generatePlanCampaignId}/generate-plan`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            postsCount: parseInt(planPostsCount),
            platforms: planPlatforms,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      toast({
        title: `Generated ${data.generatedCount} posts`,
        description: "All saved as drafts. Head to Drafts to review them.",
      });
      setGeneratePlanCampaignId(null);
    } catch {
      toast({ title: "Failed to generate plan", variant: "destructive" });
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const togglePlanPlatform = (p: string) => {
    setPlanPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaign Planner</h1>
          <p className="text-muted-foreground mt-1">Organise posts into focused campaigns</p>
        </div>
        <Button onClick={() => handleOpen()} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <Flag className="w-6 h-6 text-primary" />
            </div>
            <p className="font-medium text-foreground">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-xs">Create a campaign to group related posts and track them together.</p>
            <Button size="sm" onClick={() => handleOpen()} variant="outline" className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Create your first campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map(c => (
            <Card key={c.id} className="hover:shadow-sm transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[c.status])}>{c.status}</Badge>
                    </div>
                    <CardTitle className="text-base truncate">{c.name}</CardTitle>
                    {c.goal && <p className="text-xs text-muted-foreground mt-0.5 truncate">Goal: {c.goal}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 px-2"
                      onClick={() => { setGeneratePlanCampaignId(c.id); setPlanPlatforms(c.platforms ? c.platforms.split(",").filter(Boolean) : ["instagram", "facebook", "linkedin"]); }}
                      title="Generate AI content plan"
                    >
                      <Sparkles className="w-3 h-3" />
                      AI Plan
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleOpen(c)}>
                      <PenLine className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {c.description && <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {(c.startDate || c.endDate) && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {c.startDate ? format(new Date(c.startDate), "MMM d") : "?"} – {c.endDate ? format(new Date(c.endDate), "MMM d") : "ongoing"}
                    </span>
                  )}
                  {c.platforms && (
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      {c.platforms.split(",").filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCampaign ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Summer Launch 2025" required />
            </div>
            <div className="space-y-1.5">
              <Label>Goal</Label>
              <Input value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} placeholder="Drive product awareness" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Campaign notes…" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Platforms</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORM_OPTIONS.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs border transition-colors",
                      form.platforms.includes(p)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={isPending} >
                {isPending ? "Saving…" : editingCampaign ? "Save Changes" : "Create Campaign"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Generate AI Plan Dialog */}
      <Dialog open={!!generatePlanCampaignId} onOpenChange={(open) => { if (!open) setGeneratePlanCampaignId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Generate AI Content Plan
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Claude will generate post drafts for this campaign based on the brand DNA and campaign goal. All posts are saved as drafts for your review.
            </p>
            <div className="space-y-1.5">
              <Label>Number of posts</Label>
              <Select value={planPostsCount} onValueChange={setPlanPostsCount} disabled={isGeneratingPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 posts</SelectItem>
                  <SelectItem value="7">7 posts</SelectItem>
                  <SelectItem value="10">10 posts</SelectItem>
                  <SelectItem value="14">14 posts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Platforms</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORM_OPTIONS.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlanPlatform(p)}
                    disabled={isGeneratingPlan}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs border transition-colors",
                      planPlatforms.includes(p)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGeneratePlanCampaignId(null)} disabled={isGeneratingPlan}>
              Cancel
            </Button>
            <Button
              onClick={handleGeneratePlan}
              disabled={isGeneratingPlan || planPlatforms.length === 0}
              className="gap-2"
            >
              {isGeneratingPlan ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Generate {planPostsCount} Posts</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
