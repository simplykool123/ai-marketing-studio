import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, AlertCircle, Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type NotificationSeverity = "info" | "warning" | "error" | "success";
type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  readAt: string | null;
  createdAt: string;
};

async function fetchNotifications(clientId: string): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const res = await fetch(`/api/clients/${clientId}/notifications`);
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
}

async function markRead(clientId: string, id: string): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/notifications/${id}/read`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to mark notification read");
}

async function markAllRead(clientId: string): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/notifications/read-all`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to mark notifications read");
}

function severityClass(severity: NotificationSeverity): string {
  if (severity === "error") return "text-red-700 bg-red-50 border-red-200";
  if (severity === "warning") return "text-amber-800 bg-amber-50 border-amber-200";
  if (severity === "success") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  return "text-blue-700 bg-blue-50 border-blue-200";
}

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  if (severity === "error") return <AlertCircle className="w-4 h-4" />;
  if (severity === "warning") return <AlertTriangle className="w-4 h-4" />;
  if (severity === "success") return <CheckCircle2 className="w-4 h-4" />;
  return <Info className="w-4 h-4" />;
}

export function NotificationsBell({ clientId }: { clientId?: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["notifications", clientId];
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchNotifications(clientId!),
    enabled: !!clientId,
    refetchInterval: 30000,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => markRead(clientId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const readAllMutation = useMutation({
    mutationFn: () => markAllRead(clientId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (!clientId) return null;

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative h-9 w-9 bg-background shadow-sm" title="Notifications">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" disabled={unreadCount === 0 || readAllMutation.isPending} onClick={() => readAllMutation.mutate()}>
            <CheckCheck className="w-3.5 h-3.5" />
            Read all
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No important app events yet.</div>
          ) : (
            <div className="divide-y">
              {notifications.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "w-full p-3 text-left transition-colors hover:bg-muted/50",
                    !item.readAt && "bg-primary/5"
                  )}
                  onClick={() => {
                    if (!item.readAt) readMutation.mutate(item.id);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className={cn("mt-0.5 rounded-full border p-1.5", severityClass(item.severity))}>
                      <SeverityIcon severity={item.severity} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{item.title}</span>
                        {!item.readAt && <Badge variant="secondary" className="text-[10px]">New</Badge>}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.message}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
