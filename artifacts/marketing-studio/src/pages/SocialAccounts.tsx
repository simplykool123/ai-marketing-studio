import { useState, useEffect } from "react";
import { useParams, useSearch } from "wouter";
import {
  useListSocialAccounts,
  useConnectSocialAccount,
  useDisconnectSocialAccount,
  useUpdateSocialAccount,
  getListSocialAccountsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  Plus,
  Trash2,
  Users,
  Globe,
  ExternalLink,
  KeyRound,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";

const PLATFORMS = [
  {
    id: "instagram" as const,
    label: "Instagram",
    icon: Instagram,
    color: "#E1306C",
    bg: "bg-pink-500/10",
    text: "text-pink-600",
    oauthEnvKey: "INSTAGRAM_APP_ID",
  },
  {
    id: "facebook" as const,
    label: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    bg: "bg-blue-500/10",
    text: "text-blue-600",
    oauthEnvKey: "FACEBOOK_APP_ID",
  },
  {
    id: "twitter" as const,
    label: "Twitter / X",
    icon: Twitter,
    color: "#1DA1F2",
    bg: "bg-sky-500/10",
    text: "text-sky-600",
    oauthEnvKey: "TWITTER_CLIENT_ID",
  },
  {
    id: "linkedin" as const,
    label: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    bg: "bg-blue-700/10",
    text: "text-blue-700",
    oauthEnvKey: "LINKEDIN_CLIENT_ID",
  },
] as const;

type PlatformId = (typeof PLATFORMS)[number]["id"];

function platformMeta(platformId: string) {
  return (
    PLATFORMS.find((p) => p.id === platformId) ?? {
      id: platformId,
      label: platformId,
      icon: Globe,
      color: "#888",
      bg: "bg-muted",
      text: "text-muted-foreground",
    }
  );
}

async function startOAuth(platform: string, clientId: string, token: string | null): Promise<string> {
  const res = await fetch(`/api/auth/oauth/${platform}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ clientId }),
  });
  const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
  if (!res.ok || !data.redirectUrl) {
    throw new Error(data.error ?? `OAuth start failed (${res.status})`);
  }
  return data.redirectUrl;
}

export default function SocialAccounts() {
  const { clientId } = useParams<{ clientId: string }>();
  const search = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: accounts, isLoading } = useListSocialAccounts(clientId ?? "");
  const connect = useConnectSocialAccount();
  const disconnect = useDisconnectSocialAccount();
  const updateAccount = useUpdateSocialAccount();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>("instagram");
  const [accountName, setAccountName] = useState("");
  const [accountHandle, setAccountHandle] = useState("");
  const [followerCount, setFollowerCount] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!search) return;
    const params = new URLSearchParams(search);
    const success = params.get("oauth_success");
    const error = params.get("oauth_error");
    const platform = params.get("platform") ?? "";

    if (success) {
      invalidate();
      toast({
        title: `${platformMeta(platform).label} connected`,
        description: "Your account was connected via OAuth.",
      });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      toast({
        title: "Connection failed",
        description:
          error === "not_configured"
            ? `OAuth credentials for ${platformMeta(platform).label} are not configured. Use manual entry below.`
            : decodeURIComponent(error),
        variant: "destructive",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search]);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListSocialAccountsQueryKey(clientId ?? ""),
    });

  const { token } = useAuth();
  const handleOAuthConnect = async (platform: PlatformId) => {
    try {
      const url = await startOAuth(platform, clientId ?? "", token);
      window.location.href = url;
    } catch (err) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Could not start OAuth flow.",
        variant: "destructive",
      });
    }
  };

  const handleConnect = () => {
    if (!accountName.trim()) return;
    connect.mutate(
      {
        clientId: clientId ?? "",
        data: {
          platform: selectedPlatform,
          accountName: accountName.trim(),
          accountHandle: accountHandle.trim() || undefined,
          followerCount: followerCount ? parseInt(followerCount, 10) : undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setIsOpen(false);
          setAccountName("");
          setAccountHandle("");
          setFollowerCount("");
          toast({ title: "Account connected successfully" });
        },
        onError: () => {
          toast({ title: "Failed to connect account", variant: "destructive" });
        },
      }
    );
  };

  const handleToggle = (accountId: string, isActive: boolean) => {
    updateAccount.mutate(
      {
        clientId: clientId ?? "",
        accountId,
        data: { isActive },
      },
      {
        onSuccess: () => invalidate(),
        onError: () =>
          toast({ title: "Failed to update account", variant: "destructive" }),
      }
    );
  };

  const handleDisconnect = (accountId: string) => {
    disconnect.mutate(
      { clientId: clientId ?? "", accountId },
      {
        onSuccess: () => {
          invalidate();
          setDeleteId(null);
          toast({ title: "Account disconnected" });
        },
        onError: () =>
          toast({ title: "Failed to disconnect", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Social Accounts</h1>
          <p className="text-muted-foreground mt-1">
            Manage connected social media accounts for this brand.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Connect Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Connect a Social Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              {/* OAuth connect buttons */}
              <div>
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <KeyRound className="w-4 h-4" />
                  Connect via OAuth
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PLATFORMS.map((p) => {
                    const Icon = p.icon;
                    return (
                      <Button
                        key={p.id}
                        variant="outline"
                        className="flex items-center gap-2 justify-start"
                        onClick={() => {
                          setIsOpen(false);
                          handleOAuthConnect(p.id);
                        }}
                      >
                        <Icon className="w-4 h-4 shrink-0" style={{ color: p.color }} />
                        <span className="truncate">{p.label}</span>
                        <ExternalLink className="w-3 h-3 ml-auto shrink-0 opacity-40" />
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  OAuth connect requires platform credentials configured in environment settings.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground px-2">or add manually</span>
                <Separator className="flex-1" />
              </div>

              {/* Manual form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {PLATFORMS.map((p) => {
                      const Icon = p.icon;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPlatform(p.id)}
                          className={`flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                            selectedPlatform === p.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <Icon className="w-4 h-4" style={{ color: p.color }} />
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="e.g. Acme Corp Official"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Handle / Username</Label>
                  <Input
                    value={accountHandle}
                    onChange={(e) => setAccountHandle(e.target.value)}
                    placeholder="@acmecorp"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Follower Count (optional)</Label>
                  <Input
                    type="number"
                    value={followerCount}
                    onChange={(e) => setFollowerCount(e.target.value)}
                    placeholder="e.g. 12500"
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleConnect}
                  disabled={!accountName.trim() || connect.isPending}
                >
                  {connect.isPending ? "Connecting..." : "Add Account Manually"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : accounts?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border rounded-xl border-dashed border-border bg-card/50">
          <Users className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No accounts connected</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            Connect Instagram, Facebook, Twitter, or LinkedIn accounts to start
            scheduling content across platforms.
          </p>
          <Button onClick={() => setIsOpen(true)}>Connect first account</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts?.map((account) => {
            const meta = platformMeta(account.platform);
            const Icon = meta.icon;
            const hasOAuth = account.hasOauth;
            const isExpired = account.tokenExpired;
            return (
              <Card
                key={account.id}
                className={`border ${!account.isActive ? "opacity-60" : ""}`}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}
                  >
                    <Icon className={`w-6 h-6 ${meta.text}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-semibold text-sm truncate">
                        {account.accountName}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 capitalize shrink-0"
                      >
                        {meta.label}
                      </Badge>
                      {isExpired ? (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-0.5">
                          <AlertCircle className="w-2.5 h-2.5" /> Token expired
                        </Badge>
                      ) : hasOAuth ? (
                        <Badge className="text-[10px] px-1.5 py-0 gap-0.5 bg-green-50 text-green-700 border-green-200">
                          <CheckCircle2 className="w-2.5 h-2.5" /> OAuth
                        </Badge>
                      ) : null}
                    </div>
                    {account.accountHandle && (
                      <p className="text-xs text-muted-foreground">
                        {account.accountHandle}
                      </p>
                    )}
                    {account.followerCount != null && (
                      <p className="text-xs text-muted-foreground">
                        {account.followerCount.toLocaleString()} followers
                      </p>
                    )}
                    {isExpired && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2 mt-1 text-primary"
                        onClick={() => handleOAuthConnect(account.platform as PlatformId)}
                      >
                        Reconnect via OAuth →
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      checked={account.isActive}
                      onCheckedChange={(v) => handleToggle(account.id, v)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(account.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the connected account from this brand. You can
              reconnect it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && handleDisconnect(deleteId)}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
