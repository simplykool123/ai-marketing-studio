import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Copy, MailPlus, Shield, Trash2, XCircle } from "lucide-react";

type ClientRole = "owner" | "admin" | "editor" | "approver" | "viewer";
type TeamMember = {
  userId: string;
  role: ClientRole;
  createdAt: string;
  name: string | null;
  email: string;
};
type TeamInvite = {
  id: string;
  email: string;
  role: ClientRole;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};
type TeamResponse = {
  members: TeamMember[];
  invites: TeamInvite[];
};

const ROLES: { value: ClientRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "full access" },
  { value: "admin", label: "Admin", description: "manage content/team" },
  { value: "editor", label: "Editor", description: "create/edit drafts" },
  { value: "approver", label: "Approver", description: "approve/schedule" },
  { value: "viewer", label: "Viewer", description: "view only" },
];

const ROLE_BADGE: Record<ClientRole, string> = {
  owner: "bg-purple-50 text-purple-700 border-purple-200",
  admin: "bg-blue-50 text-blue-700 border-blue-200",
  editor: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approver: "bg-amber-50 text-amber-800 border-amber-200",
  viewer: "bg-muted text-muted-foreground",
};

function inviteLinkKey(inviteId: string): string {
  return `ams_invite_link_${inviteId}`;
}

async function fetchTeam(clientId: string): Promise<TeamResponse> {
  const res = await fetch(`/api/clients/${clientId}/team`);
  if (!res.ok) throw new Error("Failed to load team");
  return res.json();
}

async function createInvite(clientId: string, email: string, role: ClientRole): Promise<{ invite: TeamInvite; inviteLink: string; message: string }> {
  const res = await fetch(`/api/clients/${clientId}/invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to create invite");
  return data;
}

async function cancelInvite(clientId: string, inviteId: string): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/invites/${inviteId}/cancel`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to cancel invite");
  }
}

async function updateMemberRole(clientId: string, userId: string, role: ClientRole): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/team/${userId}/role`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to update role");
  }
}

async function removeMember(clientId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/team/${userId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to remove member");
  }
}

export default function TeamAccess() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ClientRole>("editor");
  const [newInviteLink, setNewInviteLink] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["team-access", clientId],
    queryFn: () => fetchTeam(clientId!),
    enabled: !!clientId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["team-access", clientId] });

  const createInviteMutation = useMutation({
    mutationFn: () => createInvite(clientId!, email, role),
    onSuccess: (result) => {
      localStorage.setItem(inviteLinkKey(result.invite.id), result.inviteLink);
      setNewInviteLink(result.inviteLink);
      setEmail("");
      setRole("editor");
      invalidate();
      toast({ title: "Invite created", description: "Copy the invite link and send it manually." });
    },
    onError: (err) => toast({ title: "Invite failed", description: err instanceof Error ? err.message : "Could not create invite.", variant: "destructive" }),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => cancelInvite(clientId!, inviteId),
    onSuccess: (_, inviteId) => {
      localStorage.removeItem(inviteLinkKey(inviteId));
      invalidate();
      toast({ title: "Invite cancelled" });
    },
    onError: (err) => toast({ title: "Cancel failed", description: err instanceof Error ? err.message : "Could not cancel invite.", variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, nextRole }: { userId: string; nextRole: ClientRole }) => updateMemberRole(clientId!, userId, nextRole),
    onSuccess: () => {
      invalidate();
      toast({ title: "Role updated" });
    },
    onError: (err) => toast({ title: "Role update failed", description: err instanceof Error ? err.message : "Could not update role.", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(clientId!, userId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Member removed" });
    },
    onError: (err) => toast({ title: "Remove failed", description: err instanceof Error ? err.message : "Could not remove member.", variant: "destructive" }),
  });

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link);
    toast({ title: "Invite link copied" });
  };

  const pendingInvites = data?.invites.filter((invite) => invite.status === "pending") ?? [];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Access</h1>
        <p className="text-muted-foreground mt-1">Invite people into this client workspace and set their role.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite teammate or client</CardTitle>
            <CardDescription>Email is link-only in V1. No email provider is required.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as ClientRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label} - {item.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => createInviteMutation.mutate()} disabled={createInviteMutation.isPending || !email.trim()} className="gap-2">
              <MailPlus className="w-4 h-4" />
              Create invite
            </Button>
            {newInviteLink && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium">Copy invite link</p>
                <div className="mt-2 flex gap-2">
                  <Input value={newInviteLink} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyLink(newInviteLink)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Role guide</CardTitle>
            <CardDescription>Keep access simple and workspace-specific.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((item) => (
              <div key={item.value} className="rounded-md border p-3">
                <Badge variant="outline" className={cn("capitalize", ROLE_BADGE[item.value])}>{item.label}</Badge>
                <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            [1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />)
          ) : data?.members.length ? (
            data.members.map((member) => (
              <div key={member.userId} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium truncate">{member.name ?? member.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("capitalize", ROLE_BADGE[member.role])}>
                    <Shield className="mr-1 w-3 h-3" />
                    {member.role}
                  </Badge>
                  <Select value={member.role} onValueChange={(nextRole) => roleMutation.mutate({ userId: member.userId, nextRole: nextRole as ClientRole })}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeMutation.mutate(member.userId)} title="Remove member">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No members found.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending invites</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendingInvites.length ? (
            pendingInvites.map((invite) => {
              const storedLink = localStorage.getItem(inviteLinkKey(invite.id));
              return (
                <div key={invite.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">Expires {format(new Date(invite.expiresAt), "MMM d, h:mm a")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("capitalize", ROLE_BADGE[invite.role])}>{invite.role}</Badge>
                    <Button variant="outline" size="sm" disabled={!storedLink} onClick={() => storedLink && copyLink(storedLink)} className="gap-1.5">
                      <Copy className="w-3.5 h-3.5" />
                      Copy invite link
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancelInviteMutation.mutate(invite.id)}>
                      <XCircle className="mr-1.5 w-3.5 h-3.5" />
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
