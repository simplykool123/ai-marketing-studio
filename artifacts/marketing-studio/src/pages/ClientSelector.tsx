import { useState, useRef } from "react";
import { Link } from "wouter";
import { useListClients, useCreateClient, useUpdateClient, useDeleteClient, getListClientsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users, Pencil, Trash2, Archive, RotateCcw, Eye, EyeOff, Upload, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#14b8a6", "#0ea5e9", "#10b981",
  "#f59e0b", "#a855f7",
];

type Client = {
  id: string;
  name: string;
  industry?: string | null;
  color: string;
  avatarInitials: string;
  logoUrl?: string | null;
  archived: boolean;
  createdAt: string;
};

async function uploadLogo(clientId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/clients/${clientId}/upload/logo`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Logo upload failed");
  const data = await res.json();
  return data.url as string;
}

async function archiveClient(clientId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/archive`, { method: "POST" });
  if (!res.ok) throw new Error("Archive failed");
}

async function restoreClient(clientId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/clients/${clientId}/restore`, { method: "POST" });
  if (!res.ok) throw new Error("Restore failed");
}

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

function EditClientDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const [name, setName] = useState(client.name);
  const [industry, setIndustry] = useState(client.industry ?? "");
  const [color, setColor] = useState(client.color);
  const [logoUrl, setLogoUrl] = useState<string | null>(client.logoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const updateClient = useUpdateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadLogo(client.id, file);
      setLogoUrl(url);
      toast({ title: "Logo uploaded" });
    } catch {
      toast({ title: "Logo upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    updateClient.mutate(
      { clientId: client.id, data: { name, color, industry, logoUrl } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["client", client.id] });
          toast({ title: "Client updated" });
          onClose();
        },
        onError: () => toast({ title: "Failed to update client", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-4 py-2">
      {/* Logo */}
      <div className="space-y-2">
        <Label>Logo</Label>
        <div className="flex items-center gap-3">
          <div
            className="w-16 h-16 rounded-xl overflow-hidden border border-border flex items-center justify-center shrink-0"
            style={{ backgroundColor: logoUrl ? undefined : color }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="w-full h-full object-contain bg-white" />
            ) : (
              <span className="font-bold text-white text-xl">
                {name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase()).join("")}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
              {uploading ? "Uploading…" : "Upload logo"}
            </Button>
            {logoUrl && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setLogoUrl(null)}>
                Remove logo
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoChange} />
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label>Brand Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Furnili" />
      </div>

      {/* Industry */}
      <div className="space-y-2">
        <Label>Industry <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Fashion, SaaS, Food & Beverage" />
      </div>

      {/* Color */}
      <div className="space-y-2">
        <Label>Brand Color</Label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-8 h-8 rounded-full border-2 transition-all hover:scale-110 focus:outline-none"
              style={{ backgroundColor: c, borderColor: color === c ? "white" : "transparent", boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
            />
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={!name.trim() || updateClient.isPending}>
          {updateClient.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────

function DeleteConfirmDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const deleteClient = useDeleteClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDelete = () => {
    deleteClient.mutate(
      { clientId: client.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: `"${client.name}" deleted` });
          onClose();
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Delete failed";
          const isDataError = err?.response?.data?.code === "HAS_RELATED_DATA";
          toast({
            title: isDataError ? "Cannot delete — client has data" : "Delete failed",
            description: isDataError ? "Archive the client instead to keep its data." : msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        This will permanently delete <strong>{client.name}</strong>. This action cannot be undone.
      </p>
      <p className="text-sm text-muted-foreground">
        If this client has any posts, campaigns, or other data, the delete will be blocked and you'll need to archive instead.
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" onClick={handleDelete} disabled={deleteClient.isPending}>
          {deleteClient.isPending ? "Deleting…" : "Delete permanently"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Client Card ──────────────────────────────────────────────────────────────

function ClientCard({ client, showArchived }: { client: Client; showArchived: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await archiveClient(client.id);
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      toast({ title: `"${client.name}" archived` });
    } catch {
      toast({ title: "Failed to archive client", variant: "destructive" });
    }
  };

  const handleRestore = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await restoreClient(client.id);
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      toast({ title: `"${client.name}" restored` });
    } catch {
      toast({ title: "Failed to restore client", variant: "destructive" });
    }
  };

  const cardContent = (
    <Card className={cn(
      "cursor-pointer transition-all border-border group h-full",
      client.archived ? "opacity-60" : "hover-elevate hover:border-primary/50"
    )}>
      <CardContent className="p-5 flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-border">
          {client.logoUrl ? (
            <img src={client.logoUrl} alt={client.name} className="w-full h-full object-contain bg-white" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center font-bold text-xl text-white group-hover:scale-105 transition-transform"
              style={{ backgroundColor: client.color }}
            >
              {client.avatarInitials}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-lg font-semibold truncate group-hover:text-primary transition-colors">{client.name}</h3>
            {client.archived && <Badge variant="secondary" className="text-xs shrink-0">Archived</Badge>}
          </div>
          {client.industry && (
            <p className="text-xs text-muted-foreground truncate mb-1">{client.industry}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Created {new Date(client.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Action buttons — stop propagation so card link doesn't fire */}
        <div
          className={cn(
            "flex flex-col gap-1 shrink-0 transition-opacity",
            client.archived ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {!client.archived && (
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit client">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Edit Client</DialogTitle></DialogHeader>
                <EditClientDialog client={client} onClose={() => setEditOpen(false)} />
              </DialogContent>
            </Dialog>
          )}

          {client.archived ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:text-emerald-700" onClick={handleRestore}>
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Restore client</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600 hover:text-amber-700" onClick={handleArchive}>
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Archive client</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {!client.archived && (
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete client">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Delete Client</DialogTitle></DialogHeader>
                <DeleteConfirmDialog client={client} onClose={() => setDeleteOpen(false)} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (client.archived) return <div>{cardContent}</div>;
  return <Link href={`/clients/${client.id}`}>{cardContent}</Link>;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

function ClientSelectorContent() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: allClients = [], isLoading } = useListClients(
    showArchived ? ({ includeArchived: "true" } as any) : undefined
  );
  const createClient = useCreateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);

  const clients = allClients as unknown as Client[];
  const active = clients.filter(c => !c.archived);
  const archived = clients.filter(c => c.archived);

  const handleCreate = () => {
    if (!name.trim()) return;
    createClient.mutate({ data: { name, color } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        setIsOpen(false);
        setName("");
        setColor(COLORS[0]);
        toast({ title: "Client created successfully" });
      },
      onError: () => {
        toast({ title: "Failed to create client", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-1">Select a brand to manage content.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchived(v => !v)}
            className={showArchived ? "bg-muted" : ""}
          >
            {showArchived ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Client
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Client</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Brand Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Furnili"
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Brand Color</Label>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className="w-8 h-8 rounded-full border-2 border-transparent transition-all hover:scale-110 focus:outline-none"
                        style={{
                          backgroundColor: c,
                          borderColor: color === c ? "white" : "transparent",
                          boxShadow: color === c ? `0 0 0 2px ${c}` : undefined,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <Button
                  className="w-full mt-4"
                  onClick={handleCreate}
                  disabled={!name.trim() || createClient.isPending}
                >
                  {createClient.isPending ? "Creating..." : "Create Client"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : active.length === 0 && !showArchived ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border rounded-xl border-dashed border-border bg-card/50">
          <Users className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No clients yet</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            Create your first client to start generating brand-specific content, managing drafts, and planning your calendar.
          </p>
          <Button onClick={() => setIsOpen(true)}>Add your first client</Button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Active clients */}
          {active.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {active.map((client) => (
                <ClientCard key={client.id} client={client} showArchived={showArchived} />
              ))}
            </div>
          )}

          {/* Archived section */}
          {showArchived && archived.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Archived ({archived.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {archived.map((client) => (
                  <ClientCard key={client.id} client={client} showArchived={showArchived} />
                ))}
              </div>
            </div>
          )}

          {showArchived && archived.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No archived clients.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClientSelector() {
  return (
    <Layout>
      <ClientSelectorContent />
    </Layout>
  );
}
