import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link2, CheckCircle2, AlertCircle, FlaskConical, Trash2, Save, Loader2 } from "lucide-react";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

type BlogConnection = {
  id: string;
  siteName: string;
  siteUrl: string;
  endpointUrl: string;
  platform: "wordpress" | "ghost" | "webhook" | string;
  status: string;
  lastTestStatus: "ok" | "failed" | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function fetchConnection(clientId: string): Promise<{ connection: BlogConnection | null }> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/blog/site-connection`);
  if (!res.ok) throw new Error("Failed to load blog connection");
  return res.json();
}

async function saveConnection(clientId: string, body: { siteName: string; siteUrl: string; endpointUrl: string; platform: string }) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/blog/site-connection`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to save connection");
  return data as { connection: BlogConnection; secret: string };
}

async function testConnection(clientId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/blog/site-connection/test`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Connection test failed");
  return data as { ok: boolean; status: number; message: string };
}

async function disconnect(clientId: string) {
  const res = await fetch(`${BASE}/api/clients/${clientId}/blog/site-connection`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to disconnect");
  }
}

export function BlogConnectionCard({ clientId }: { clientId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["blog-connection", clientId],
    queryFn: () => fetchConnection(clientId),
    enabled: !!clientId,
  });
  const connection = data?.connection ?? null;

  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [platform, setPlatform] = useState<"wordpress" | "ghost" | "webhook">("webhook");
  const [editing, setEditing] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: () => saveConnection(clientId, { siteName, siteUrl, endpointUrl, platform }),
    onSuccess: (data) => {
      setRevealedSecret(data.secret);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["blog-connection", clientId] });
      toast({ title: "Blog connection saved", description: "Copy the signing secret now — it will not be shown again." });
    },
    onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: () => testConnection(clientId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["blog-connection", clientId] });
      toast({
        title: result.ok ? "Connection works" : "Connection test failed",
        description: result.message,
        variant: result.ok ? "default" : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnect(clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blog-connection", clientId] });
      toast({ title: "Website disconnected" });
    },
    onError: (err: Error) => toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" }),
  });

  const statusBadge = (() => {
    if (!connection) return { label: "Not configured", className: "bg-amber-50 text-amber-800 border-amber-200" };
    if (connection.lastTestStatus === "failed") return { label: "Last test failed", className: "bg-red-50 text-red-700 border-red-200" };
    if (connection.lastTestStatus === "ok") return { label: "Connected", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    return { label: "Saved (untested)", className: "bg-sky-50 text-sky-700 border-sky-200" };
  })();

  return (
    <Card className="bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="w-4 h-4 text-primary" />
          Website / Blog Connection
        </CardTitle>
        <CardDescription>
          Blog drafts will only publish to the website you connect here. Credentials are encrypted server-side and never returned to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading connection…</div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={statusBadge.className}>{statusBadge.label}</Badge>
              {connection && (
                <span className="text-xs text-muted-foreground">
                  {connection.siteName} — {connection.platform}
                  {connection.lastTestedAt && ` · tested ${new Date(connection.lastTestedAt).toLocaleString()}`}
                </span>
              )}
            </div>

            {connection && !editing ? (
              <div className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Site URL:</span> <span className="font-mono">{connection.siteUrl}</span></div>
                <div><span className="text-muted-foreground">Endpoint:</span> <span className="font-mono">{connection.endpointUrl}</span></div>
                {connection.lastTestMessage && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {connection.lastTestStatus === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
                    {connection.lastTestMessage}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => testMut.mutate()} disabled={testMut.isPending} variant="outline" size="sm">
                    {testMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5 mr-1.5" />}
                    Test Connection
                  </Button>
                  <Button onClick={() => { setSiteName(connection.siteName); setSiteUrl(connection.siteUrl); setEndpointUrl(connection.endpointUrl); setPlatform((connection.platform as any) ?? "webhook"); setEditing(true); }} variant="outline" size="sm">
                    Edit
                  </Button>
                  <Button onClick={() => { if (confirm("Disconnect this website? Blog publishing will be disabled until reconnected.")) disconnectMut.mutate(); }} disabled={disconnectMut.isPending} variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Platform</Label>
                    <Select value={platform} onValueChange={(v) => setPlatform(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wordpress">WordPress</SelectItem>
                        <SelectItem value="ghost">Ghost</SelectItem>
                        <SelectItem value="webhook">Custom webhook</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Display name</Label>
                    <Input placeholder="My Brand Blog" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Website URL</Label>
                  <Input placeholder="https://example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Receiver endpoint URL</Label>
                  <Input placeholder="https://example.com/wp-json/ams/v1/publish" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Public URL on your site that accepts the signed JSON payload. WordPress and Ghost need a small adapter plugin/route.</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !siteUrl || !endpointUrl} size="sm">
                    {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                    Save Connection
                  </Button>
                  {connection && (
                    <Button onClick={() => setEditing(false)} variant="ghost" size="sm">Cancel</Button>
                  )}
                </div>
              </div>
            )}

            {revealedSecret && (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs">
                <div className="font-medium text-emerald-900 mb-1">Signing secret (shown once — copy now)</div>
                <code className="block break-all font-mono text-emerald-900">{revealedSecret}</code>
                <p className="text-emerald-800 mt-2">Configure this secret on your receiver. Incoming requests include header <code>x-ams-signature: sha256=&lt;HMAC&gt;</code>.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => { navigator.clipboard.writeText(revealedSecret); toast({ title: "Secret copied" }); }}>Copy</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
