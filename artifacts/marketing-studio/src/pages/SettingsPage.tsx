import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Bot, ImageIcon, Save } from "lucide-react";

type Settings = {
  id: string;
  userId: string;
  aiProvider: string;
  aiModel: string;
  imageProvider: string;
  imageModel: string;
};

const AI_PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)", models: ["claude-opus-4-5", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"] },
  { value: "openai", label: "OpenAI (GPT)", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"] },
  { value: "gemini", label: "Google (Gemini)", models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"] },
];

const IMAGE_PROVIDERS = [
  { value: "openai", label: "OpenAI (DALL-E 3)", models: ["dall-e-3"] },
  { value: "google", label: "Google (Imagen)", models: ["imagen-3.0"] },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const token = localStorage.getItem("ams_token");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  useEffect(() => {
    fetch("/api/settings", { headers })
      .then(r => r.json())
      .then((d: Settings) => setSettings(d))
      .catch(() => toast({ title: "Failed to load settings", variant: "destructive" }))
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          aiProvider: settings.aiProvider,
          aiModel: settings.aiModel,
          imageProvider: settings.imageProvider,
          imageModel: settings.imageModel,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Settings saved" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedAiProvider = AI_PROVIDERS.find(p => p.value === settings?.aiProvider);
  const selectedImageProvider = IMAGE_PROVIDERS.find(p => p.value === settings?.imageProvider);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and AI preferences</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5"><User className="w-3.5 h-3.5" />Profile</TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5"><Bot className="w-3.5 h-3.5" />AI Provider</TabsTrigger>
          <TabsTrigger value="images" className="gap-1.5"><ImageIcon className="w-3.5 h-3.5" />Image AI</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>Your account information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={user?.name ?? ""} disabled className="bg-muted/40" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled className="bg-muted/40" />
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">To update your profile, contact support.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Text AI Provider</CardTitle>
              <CardDescription>Used for generating captions and content suggestions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select
                      value={settings?.aiProvider ?? "anthropic"}
                      onValueChange={v => setSettings(s => s ? { ...s, aiProvider: v, aiModel: AI_PROVIDERS.find(p => p.value === v)?.models[0] ?? s.aiModel } : s)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AI_PROVIDERS.map(p => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <Select
                      value={settings?.aiModel ?? ""}
                      onValueChange={v => setSettings(s => s ? { ...s, aiModel: v } : s)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(selectedAiProvider?.models ?? []).map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">{settings?.aiProvider}/{settings?.aiModel}</Badge>
                  </div>

                  <Button onClick={save} disabled={isSaving} size="sm">
                    {isSaving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Changes</>}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="images" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Image AI Provider</CardTitle>
              <CardDescription>Used for generating post images</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select
                      value={settings?.imageProvider ?? "openai"}
                      onValueChange={v => setSettings(s => s ? { ...s, imageProvider: v, imageModel: IMAGE_PROVIDERS.find(p => p.value === v)?.models[0] ?? s.imageModel } : s)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMAGE_PROVIDERS.map(p => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <Select
                      value={settings?.imageModel ?? ""}
                      onValueChange={v => setSettings(s => s ? { ...s, imageModel: v } : s)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(selectedImageProvider?.models ?? []).map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={save} disabled={isSaving} size="sm">
                    {isSaving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Changes</>}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
