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
import { Loader2, User, Bot, ImageIcon, Save, AlertTriangle, CheckCircle2, XCircle, FlaskConical } from "lucide-react";

type Settings = {
  id: string;
  userId: string;
  aiProvider: string;
  aiModel: string;
  imageProvider: string;
  imageModel: string;
};

type ProviderKeyStatus = { keyExists: boolean; source: "env" | "database" };
type ProviderStatus = {
  anthropic: ProviderKeyStatus;
  openai: ProviderKeyStatus;
  gemini: ProviderKeyStatus;
};

type TestResult = {
  success: boolean;
  provider: string;
  model: string;
  keyFound: boolean;
  error?: string;
};

// Current valid model IDs per provider
const AI_PROVIDERS = [
  {
    value: "anthropic",
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    value: "openai",
    label: "OpenAI (GPT)",
    models: [
      { id: "gpt-4o", label: "GPT-4o (recommended)" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    ],
  },
  {
    value: "gemini",
    label: "Google (Gemini)",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (recommended)" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
];

const IMAGE_PROVIDERS = [
  { value: "openai", label: "OpenAI (DALL-E 3)", models: [{ id: "dall-e-3", label: "DALL-E 3" }] },
  { value: "google", label: "Google (Imagen)", models: [{ id: "imagen-3.0", label: "Imagen 3.0" }] },
];

// Old model IDs that no longer work → what to migrate them to
const STALE_MODEL_MAP: Record<string, string> = {
  "claude-opus-4-5": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "claude-3-haiku-20240307": "claude-sonnet-4-6",
  "claude-3-opus-20240229": "claude-sonnet-4-6",
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const token = localStorage.getItem("ams_token");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  useEffect(() => {
    Promise.all([
      fetch("/api/settings", { headers }).then(r => r.json() as Promise<Settings>),
      fetch("/api/settings/provider-status", { headers }).then(r => r.json() as Promise<ProviderStatus>),
    ])
      .then(([s, ps]) => {
        setProviderStatus(ps);
        // Migrate stale model IDs transparently
        const migratedModel = STALE_MODEL_MAP[s.aiModel];
        if (migratedModel) {
          setSettings({ ...s, aiModel: migratedModel });
          toast({
            title: "AI model updated",
            description: `"${s.aiModel}" is no longer available and has been updated to "${migratedModel}". Save to confirm.`,
          });
        } else {
          setSettings(s);
        }
      })
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

  const testConnection = async () => {
    if (!settings) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-ai-provider", {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: settings.aiProvider, model: settings.aiModel }),
      });
      const data = await res.json() as TestResult;
      setTestResult(data);
    } catch {
      setTestResult({ success: false, provider: settings.aiProvider, model: settings.aiModel, keyFound: false, error: "Network error — could not reach server." });
    } finally {
      setIsTesting(false);
    }
  };

  const selectedAiProvider = AI_PROVIDERS.find(p => p.value === settings?.aiProvider);
  const selectedImageProvider = IMAGE_PROVIDERS.find(p => p.value === settings?.imageProvider);

  // Is the currently selected AI provider key actually configured in the backend?
  const aiProviderConfigured =
    !providerStatus ||
    !settings?.aiProvider ||
    providerStatus[settings.aiProvider as keyof ProviderStatus]?.keyExists === true;

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
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  {/* Provider key missing warning */}
                  {!aiProviderConfigured && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        Selected AI provider is not configured. Add the corresponding API key to your{" "}
                        <code className="text-xs font-mono">.env</code> file and restart the server.
                      </span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select
                      value={settings?.aiProvider ?? "anthropic"}
                      onValueChange={v => {
                        setTestResult(null);
                        setSettings(s =>
                          s
                            ? {
                                ...s,
                                aiProvider: v,
                                aiModel: AI_PROVIDERS.find(p => p.value === v)?.models[0].id ?? s.aiModel,
                              }
                            : s
                        );
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AI_PROVIDERS.map(p => (
                          <SelectItem key={p.value} value={p.value}>
                            <span className="flex items-center gap-2">
                              {p.label}
                              {providerStatus && !providerStatus[p.value as keyof ProviderStatus]?.keyExists && (
                                <span className="text-[10px] text-amber-600 font-medium">no key</span>
                              )}
                            </span>
                          </SelectItem>
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
                          <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      {settings?.aiProvider}/{settings?.aiModel}
                    </Badge>
                  </div>

                  {/* Test Connection */}
                  <div className="space-y-2">
                    <Button onClick={testConnection} disabled={isTesting || !aiProviderConfigured} variant="outline" size="sm">
                      {isTesting
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing…</>
                        : <><FlaskConical className="w-3.5 h-3.5 mr-1.5" />Test Connection</>}
                    </Button>

                    {testResult && (
                      <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${
                        testResult.success
                          ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                          : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
                      }`}>
                        {testResult.success
                          ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                          : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                        <span>
                          {testResult.success
                            ? `Connection successful — ${testResult.provider}/${testResult.model} is working.`
                            : (testResult.error ?? "Connection failed — check your API key.")}
                        </span>
                      </div>
                    )}
                  </div>

                  <Button onClick={save} disabled={isSaving} size="sm">
                    {isSaving
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                      : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Changes</>}
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
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select
                      value={settings?.imageProvider ?? "openai"}
                      onValueChange={v =>
                        setSettings(s =>
                          s
                            ? {
                                ...s,
                                imageProvider: v,
                                imageModel: IMAGE_PROVIDERS.find(p => p.value === v)?.models[0].id ?? s.imageModel,
                              }
                            : s
                        )
                      }
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
                          <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={save} disabled={isSaving} size="sm">
                    {isSaving
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                      : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Changes</>}
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
