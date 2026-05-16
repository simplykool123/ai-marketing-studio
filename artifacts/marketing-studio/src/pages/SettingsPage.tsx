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
import { Loader2, User, Bot, ImageIcon, Save, AlertTriangle, CheckCircle2, XCircle, FlaskConical, Key, Eye, EyeOff, Trash2 } from "lucide-react";

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
  replicate?: ProviderKeyStatus;
  ideogram?: ProviderKeyStatus;
  serper?: ProviderKeyStatus;
  tavily?: ProviderKeyStatus;
  twitter?: ProviderKeyStatus;
  kling?: ProviderKeyStatus;
  elevenlabs?: ProviderKeyStatus;
};

type TestResult = {
  success: boolean;
  provider: string;
  model: string;
  keyFound: boolean;
  keySource?: "database" | "env";
  keyHint?: string;
  routeUsed?: string;
  warning?: string;
  envComparison?: {
    keySource: "env";
    keyHint: string;
    success: boolean;
    failureReason?: string;
  };
  error?: string;
};

type SavedKeyInfo = { masked: string; source: "database" } | null;
type ApiKeysState = Record<string, SavedKeyInfo>;

type KeyEditorState = {
  value: string;
  visible: boolean;
  saving: boolean;
  testing: boolean;
  testResult: TestResult | null;
};

type HealthStatus = "green" | "yellow" | "red";
type HealthItem = {
  id: string;
  label: string;
  status: HealthStatus;
  message: string;
};
type SettingsHealth = {
  status: HealthStatus;
  generatedAt: string;
  items: HealthItem[];
};

type ProviderCategory = "text" | "image" | "trend" | "video";
type ProviderControl = {
  provider: string;
  enabled: boolean;
  priority: number;
  category: ProviderCategory;
  bestFor?: string;
};
type ProviderControls = Record<ProviderCategory, ProviderControl[]>;

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
  { value: "flux", label: "Flux via Replicate", bestFor: "Photorealistic lifestyle, people, product, and natural social visuals.", models: [{ id: "black-forest-labs/flux-1.1-pro", label: "Flux 1.1 Pro" }] },
  { value: "ideogram", label: "Ideogram", bestFor: "Text-on-image, offer posts, banners, posters, and CTA graphics.", models: [{ id: "ideogram-v3", label: "Ideogram v3" }] },
  { value: "openai", label: "OpenAI (DALL-E 3)", bestFor: "Reliable fallback and general-purpose social images.", models: [{ id: "dall-e-3", label: "DALL-E 3" }] },
];

const TESTABLE_TEXT_PROVIDERS = new Set(["anthropic", "openai", "gemini"]);

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
  const [health, setHealth] = useState<SettingsHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [providerControls, setProviderControls] = useState<ProviderControls | null>(null);
  const [providerControlsSaving, setProviderControlsSaving] = useState(false);

  // AI Keys tab state
  const [apiKeys, setApiKeys] = useState<ApiKeysState>({ anthropic: null, openai: null, gemini: null, replicate: null, ideogram: null, serper: null, tavily: null, twitter: null, kling: null, elevenlabs: null });
  const [keysLoading, setKeysLoading] = useState(false);
  // editing[provider] = true means the input row is shown
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [keyEditors, setKeyEditors] = useState<Record<string, KeyEditorState>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});

  const token = localStorage.getItem("ams_token");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  useEffect(() => {
    Promise.all([
      fetch("/api/settings", { headers }).then(r => r.json() as Promise<Settings>),
      fetch("/api/settings/provider-status", { headers }).then(r => r.json() as Promise<ProviderStatus>),
      fetch("/api/settings/health", { headers }).then(r => r.json() as Promise<SettingsHealth>),
      fetch("/api/settings/provider-controls", { headers }).then(r => r.json() as Promise<{ controls: ProviderControls; status: ProviderStatus }>),
    ])
      .then(([s, ps, h, pc]) => {
        setProviderStatus(ps);
        setHealth(h);
        setProviderControls(pc.controls);
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

  const loadApiKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await fetch("/api/settings/api-keys", { headers });
      const data = await res.json() as ApiKeysState;
      setApiKeys(data);
    } catch {
      toast({ title: "Failed to load API keys", variant: "destructive" });
    } finally {
      setKeysLoading(false);
    }
  };

  const startEditing = (provider: string) => {
    setEditing(e => ({ ...e, [provider]: true }));
    setKeyEditors(ed => ({ ...ed, [provider]: { value: "", visible: false, saving: false, testing: false, testResult: null } }));
  };

  const cancelEditing = (provider: string) => {
    setEditing(e => ({ ...e, [provider]: false }));
  };

  const saveApiKey = async (provider: string) => {
    const editor = keyEditors[provider];
    if (!editor?.value.trim()) return;
    setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], saving: true } }));
    try {
      const res = await fetch(`/api/settings/api-keys/${provider}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ key: editor.value.trim() }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json() as { masked: string; source: "database" };
      setApiKeys(k => ({ ...k, [provider]: data }));
      setEditing(e => ({ ...e, [provider]: false }));
      toast({ title: "API key saved", description: `${provider} key saved and encrypted.` });
    } catch {
      toast({ title: "Failed to save key", variant: "destructive" });
    } finally {
      setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], saving: false } }));
    }
  };

  const deleteApiKey = async (provider: string) => {
    try {
      await fetch(`/api/settings/api-keys/${provider}`, { method: "DELETE", headers });
      setApiKeys(k => ({ ...k, [provider]: null }));
      setEditing(e => ({ ...e, [provider]: false }));
      toast({ title: "API key removed", description: `${provider} key has been deleted.` });
    } catch {
      toast({ title: "Failed to remove key", variant: "destructive" });
    }
  };

  const testApiKey = async (provider: string) => {
    if (!TESTABLE_TEXT_PROVIDERS.has(provider)) {
      toast({ title: "Key saved for feature use", description: "This provider is tested when its feature runs." });
      return;
    }
    const model = AI_PROVIDERS.find(p => p.value === provider)?.models[0].id ?? "";
    setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], testing: true, testResult: null } }));
    try {
      const res = await fetch("/api/settings/test-ai-provider", {
        method: "POST",
        headers,
        body: JSON.stringify({ provider, model }),
      });
      const data = await res.json() as TestResult;
      setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], testResult: data } }));
    } catch {
      setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], testResult: { success: false, provider, model, keyFound: false, error: "Network error." } } }));
    } finally {
      setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], testing: false } }));
    }
  };

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/settings/health", { headers });
      const data = await res.json() as SettingsHealth;
      setHealth(data);
    } catch {
      toast({ title: "Failed to load health check", variant: "destructive" });
    } finally {
      setHealthLoading(false);
    }
  };

  const loadProviderControls = async () => {
    try {
      const res = await fetch("/api/settings/provider-controls", { headers });
      const data = await res.json() as { controls: ProviderControls; status: ProviderStatus };
      setProviderControls(data.controls);
      setProviderStatus(data.status);
    } catch {
      toast({ title: "Failed to load provider controls", variant: "destructive" });
    }
  };

  const setProviderEnabled = (category: ProviderCategory, provider: string, enabled: boolean) => {
    setProviderControls((current) => {
      if (!current) return current;
      return {
        ...current,
        [category]: current[category].map((item) =>
          item.provider === provider ? { ...item, enabled } : item
        ),
      };
    });
  };

  const moveProvider = (category: ProviderCategory, provider: string, direction: -1 | 1) => {
    setProviderControls((current) => {
      if (!current) return current;
      const items = [...current[category]].sort((a, b) => a.priority - b.priority);
      const index = items.findIndex((item) => item.provider === provider);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return current;
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return {
        ...current,
        [category]: items.map((item, idx) => ({ ...item, priority: idx + 1 })),
      };
    });
  };

  const saveProviderControls = async () => {
    if (!providerControls) return;
    setProviderControlsSaving(true);
    try {
      const res = await fetch("/api/settings/provider-controls", {
        method: "PUT",
        headers,
        body: JSON.stringify({ controls: providerControls }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json() as { controls: ProviderControls };
      setProviderControls(data.controls);
      await loadProviderControls();
      toast({ title: "Provider controls saved", description: "Disabled providers will not be used for fallback." });
    } catch {
      toast({ title: "Failed to save provider controls", variant: "destructive" });
    } finally {
      setProviderControlsSaving(false);
    }
  };

  const selectedAiProvider = AI_PROVIDERS.find(p => p.value === settings?.aiProvider);
  const selectedImageProvider = IMAGE_PROVIDERS.find(p => p.value === settings?.imageProvider);
  const imageProviderConfigured =
    !providerStatus ||
    !settings?.imageProvider ||
    (settings.imageProvider === "openai"
      ? providerStatus.openai?.keyExists === true
      : settings.imageProvider === "flux"
        ? providerStatus.replicate?.keyExists === true
        : providerStatus.ideogram?.keyExists === true);
  const healthTone = (status: HealthStatus) => {
    if (status === "green") return "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400";
    if (status === "yellow") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400";
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400";
  };
  const HealthIcon = ({ status }: { status: HealthStatus }) => {
    if (status === "green") return <CheckCircle2 className="w-4 h-4 shrink-0" />;
    if (status === "yellow") return <AlertTriangle className="w-4 h-4 shrink-0" />;
    return <XCircle className="w-4 h-4 shrink-0" />;
  };

  // Is the currently selected AI provider key actually configured in the backend?
  const aiProviderConfigured =
    !providerStatus ||
    !settings?.aiProvider ||
    providerStatus[settings.aiProvider as keyof ProviderStatus]?.keyExists === true;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and AI preferences</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5"><User className="w-3.5 h-3.5" />Profile</TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5"><Bot className="w-3.5 h-3.5" />AI Provider</TabsTrigger>
          <TabsTrigger value="images" className="gap-1.5"><ImageIcon className="w-3.5 h-3.5" />Image AI</TabsTrigger>
          <TabsTrigger value="providers" className="gap-1.5" onClick={loadProviderControls}><Bot className="w-3.5 h-3.5" />Provider Control</TabsTrigger>
          <TabsTrigger value="keys" className="gap-1.5" onClick={loadApiKeys}><Key className="w-3.5 h-3.5" />AI Keys</TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5" onClick={loadHealth}><CheckCircle2 className="w-3.5 h-3.5" />Health</TabsTrigger>
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
                          <SelectItem key={p.value} value={p.value}>
                            <span className="flex items-center gap-2">
                              {p.label}
                              {providerStatus && ((p.value === "openai" && !providerStatus.openai?.keyExists) || (p.value === "flux" && !providerStatus.replicate?.keyExists) || (p.value === "ideogram" && !providerStatus.ideogram?.keyExists)) && (
                                <span className="text-[10px] text-amber-600 font-medium">no key</span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedImageProvider?.bestFor && (
                      <p className="text-xs text-muted-foreground">Best for: {selectedImageProvider.bestFor}</p>
                    )}
                  </div>

                  {!imageProviderConfigured && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Add key in Settings → AI Keys. The app will fall back to another configured image provider when possible.</span>
                    </div>
                  )}

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

        <TabsContent value="providers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider Control Center</CardTitle>
              <CardDescription>Only connected and enabled providers are eligible. Missing-key providers are skipped automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!providerControls ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading provider controls…
                </div>
              ) : (
                <>
                  {(["text", "image", "trend", "video"] as ProviderCategory[]).map((category) => (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold capitalize">{category === "trend" ? "Trend/Search" : `${category} AI`}</h3>
                        {category === "trend" && <Badge variant="outline">Free fallback always available</Badge>}
                      </div>
                      <div className="space-y-2">
                        {providerControls[category].sort((a, b) => a.priority - b.priority).map((item) => {
                          const keyProvider = item.provider === "flux" ? "replicate" : item.provider;
                          const keyStatus = keyProvider === "free" ? { keyExists: true, source: "env" as const } : providerStatus?.[keyProvider as keyof ProviderStatus];
                          const connected = keyProvider === "free" || keyStatus?.keyExists === true;
                          const eligible = connected && item.enabled;
                          return (
                            <div key={`${category}-${item.provider}`} className="rounded-md border p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-medium capitalize">{item.provider}</p>
                                    <Badge variant={eligible ? "default" : "outline"} className="text-[10px]">
                                      {eligible ? "Eligible" : connected ? "Disabled" : "Missing key"}
                                    </Badge>
                                    {keyStatus?.source && keyProvider !== "free" && (
                                      <Badge variant="outline" className="text-[10px]">{keyStatus.source}</Badge>
                                    )}
                                  </div>
                                  {item.bestFor && <p className="mt-1 text-xs text-muted-foreground">{item.bestFor}</p>}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button variant="outline" size="sm" onClick={() => moveProvider(category, item.provider, -1)} disabled={item.priority === 1}>Up</Button>
                                  <Button variant="outline" size="sm" onClick={() => moveProvider(category, item.provider, 1)}>Down</Button>
                                  <Button
                                    variant={item.enabled ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setProviderEnabled(category, item.provider, !item.enabled)}
                                    disabled={keyProvider === "free"}
                                  >
                                    {item.enabled ? "Enabled" : "Disabled"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <Button onClick={saveProviderControls} disabled={providerControlsSaving} size="sm">
                    {providerControlsSaving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Provider Controls</>}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI API Keys</CardTitle>
              <CardDescription>
                Keys are encrypted before storage. DB-stored keys take priority over .env keys.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {keysLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  {[
                    { provider: "anthropic", label: "Anthropic (Claude)", placeholder: "sk-ant-api03-…" },
                    { provider: "openai",    label: "OpenAI (GPT / DALL-E)", placeholder: "sk-proj-…" },
                    { provider: "gemini",    label: "Google Gemini", placeholder: "AIzaSy…" },
                    { provider: "replicate", label: "Replicate (Flux)", placeholder: "r8_…" },
                    { provider: "ideogram",  label: "Ideogram", placeholder: "ideogram_…" },
                    { provider: "serper",    label: "Serper (Live Trends)", placeholder: "serper key" },
                    { provider: "tavily",    label: "Tavily (optional research)", placeholder: "tvly-…" },
                    { provider: "twitter",   label: "Twitter/X Bearer (optional)", placeholder: "bearer token" },
                    { provider: "kling",     label: "Kling Video (placeholder)", placeholder: "kling key" },
                    { provider: "elevenlabs", label: "ElevenLabs Voice (placeholder)", placeholder: "elevenlabs key" },
                  ].map(({ provider, label, placeholder }) => {
                    const saved = apiKeys[provider];
                    const isEditing = editing[provider];
                    const editor = keyEditors[provider] ?? { value: "", visible: false, saving: false, testing: false, testResult: null };
                    const tr = editor.testResult;

                    return (
                      <div key={provider} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">{label}</Label>
                          {saved && (
                            <Badge variant="outline" className="text-[10px] font-mono text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">
                              encrypted · DB
                            </Badge>
                          )}
                        </div>

                        {/* Saved state — show masked key + action buttons */}
                        {saved && !isEditing && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono text-muted-foreground select-all">
                                {keyVisible[provider] ? "••••••••" /* never show plaintext */ : saved.masked}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0"
                                title={keyVisible[provider] ? "Hide" : "Show hint"}
                                onClick={() => setKeyVisible(v => ({ ...v, [provider]: !v[provider] }))}
                              >
                                {keyVisible[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </Button>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button variant="outline" size="sm" onClick={() => startEditing(provider)}>
                                Change Key
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={editor.testing || !TESTABLE_TEXT_PROVIDERS.has(provider)}
                                onClick={() => testApiKey(provider)}
                              >
                                {editor.testing
                                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing…</>
                                  : <><FlaskConical className="w-3.5 h-3.5 mr-1.5" />Test</>}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => deleteApiKey(provider)}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" />Remove
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* No saved key — show input directly */}
                        {!saved && !isEditing && (
                          <Button variant="outline" size="sm" onClick={() => startEditing(provider)}>
                            <Key className="w-3.5 h-3.5 mr-1.5" />Add Key
                          </Button>
                        )}

                        {/* Input editor */}
                        {isEditing && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <Input
                                  type={editor.visible ? "text" : "password"}
                                  placeholder={placeholder}
                                  value={editor.value}
                                  autoComplete="off"
                                  spellCheck={false}
                                  onChange={e => setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], value: e.target.value } }))}
                                  className="pr-10 font-mono text-sm"
                                />
                                <button
                                  type="button"
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                  onClick={() => setKeyEditors(ed => ({ ...ed, [provider]: { ...ed[provider], visible: !ed[provider].visible } }))}
                                  title={editor.visible ? "Hide key" : "Show key"}
                                >
                                  {editor.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={editor.saving || !editor.value.trim()}
                                onClick={() => saveApiKey(provider)}
                              >
                                {editor.saving
                                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                                  : <><Save className="w-3.5 h-3.5 mr-1.5" />Save</>}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => cancelEditing(provider)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Test result */}
                        {tr && (
                          <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                            tr.success
                              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
                          }`}>
                            {tr.success
                              ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                              : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                            <span className="space-y-1">
                              <span className="block">
                                {tr.success
                                  ? `Connected — ${tr.provider}/${tr.model} is working via ${tr.keySource ?? "unknown"} key${tr.keyHint ? ` ending ${tr.keyHint}` : ""}.`
                                  : (tr.error ?? "Connection failed.")}
                              </span>
                              {tr.routeUsed && (
                                <span className="block text-xs opacity-80">Route: {tr.routeUsed}</span>
                              )}
                              {tr.envComparison && (
                                <span className="block text-xs opacity-80">
                                  Env OpenAI key ending {tr.envComparison.keyHint}: {tr.envComparison.success ? "also works" : `failed (${tr.envComparison.failureReason ?? "unknown"})`}
                                </span>
                              )}
                              {tr.warning && (
                                <span className="block text-xs font-medium">{tr.warning}</span>
                              )}
                            </span>
                          </div>
                        )}

                        {provider !== "gemini" && <Separator />}
                      </div>
                    );
                  })}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Settings Health</CardTitle>
                <CardDescription>Environment and operational readiness. Secrets are never shown.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadHealth} disabled={healthLoading}>
                {healthLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5 mr-1.5" />}
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {!health ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading health check…
                </div>
              ) : (
                <>
                  <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${healthTone(health.status)}`}>
                    <HealthIcon status={health.status} />
                    <span>
                      {health.status === "green"
                        ? "Core setup looks ready."
                        : health.status === "yellow"
                          ? "Setup is usable, with optional or production-readiness items to review."
                          : "One or more required services need attention before reliable use."}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {health.items.map((item) => (
                      <div key={item.id} className={`rounded-md border p-3 ${healthTone(item.status)}`}>
                        <div className="flex items-center gap-2">
                          <HealthIcon status={item.status} />
                          <p className="text-sm font-semibold">{item.label}</p>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed opacity-90">{item.message}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Last checked {new Date(health.generatedAt).toLocaleString()}.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
