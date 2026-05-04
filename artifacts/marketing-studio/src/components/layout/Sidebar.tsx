import { Link, useLocation } from "wouter";
import { useGetClient } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  LayoutDashboard,
  Dna,
  Sparkles,
  Calendar as CalendarIcon,
  Menu,
  X,
  ImageIcon,
  Settings,
  LogOut,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  BrainCircuit,
  Search,
  Newspaper,
  Mail,
  Share2,
  ListOrdered,
  Zap,
  BookOpen,
  Flag,
  FileText,
  Database,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchDashboardPendingCount(clientId: string): Promise<number> {
  try {
    const res = await fetch(`${BASE}/api/clients/${clientId}/dashboard`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.pendingApprovals ?? 0;
  } catch {
    return 0;
  }
}

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: number };

export function Sidebar({ clientId }: { clientId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const prevCountRef = useRef<number | null>(null);

  const { data: client } = useGetClient(clientId || "");

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["sidebar-pending", clientId],
    queryFn: () => fetchDashboardPendingCount(clientId!),
    enabled: !!clientId,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!clientId) return;
    if (prevCountRef.current !== null && pendingCount > prevCountRef.current) {
      const diff = pendingCount - prevCountRef.current;
      toast({
        title: `${diff} new post${diff > 1 ? "s" : ""} ready for review`,
        description: "Check the Approval Queue to review them.",
      });
    }
    prevCountRef.current = pendingCount;
  }, [pendingCount, clientId]);

  const primaryItems: NavItem[] = clientId ? [
    { href: `/clients/${clientId}`, label: "Dashboard", icon: LayoutDashboard },
    { href: `/clients/${clientId}/brand-dna`, label: "Brand Setup", icon: Dna },
    { href: `/clients/${clientId}/create`, label: "Create Content", icon: Sparkles },
    { href: `/clients/${clientId}/calendar`, label: "Calendar", icon: CalendarIcon },
    { href: `/clients/${clientId}/approvals`, label: "Approvals", icon: CheckSquare, badge: pendingCount > 0 ? pendingCount : undefined },
    { href: `/clients/${clientId}/assets`, label: "Assets", icon: ImageIcon },
  ] : [];

  const advancedItems: NavItem[] = clientId ? [
    { href: `/clients/${clientId}/brain`, label: "Brain", icon: BrainCircuit },
    { href: `/clients/${clientId}/research`, label: "Search", icon: Search },
    { href: `/clients/${clientId}/storylines`, label: "Storylines", icon: BookOpen },
    { href: `/clients/${clientId}/campaigns`, label: "Campaigns", icon: Flag },
    { href: `/clients/${clientId}/bulk-generate`, label: "Bulk Generate", icon: Zap },
    { href: `/clients/${clientId}/drafts`, label: "Drafts", icon: FileText },
    { href: `/clients/${clientId}/blog`, label: "Blog", icon: Newspaper },
    { href: `/clients/${clientId}/newsletters`, label: "Newsletters", icon: Mail },
    { href: `/clients/${clientId}/social-accounts`, label: "Social Accounts", icon: Share2 },
    { href: `/clients/${clientId}/queue`, label: "Posting Queue", icon: ListOrdered },
    { href: `/clients/${clientId}/memory`, label: "Memory", icon: Database },
  ] : [];

  function NavLink({ item }: { item: NavItem }) {
    const Icon = item.icon;
    const isActive = location === item.href;
    return (
      <Link
        href={item.href}
        onClick={() => setIsOpen(false)}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px] rounded-full">
            {item.badge}
          </Badge>
        )}
      </Link>
    );
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border text-sidebar-foreground w-64 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl text-primary">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-primary-foreground" />
          </div>
          <span>AI Studio</span>
        </Link>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsOpen(false)}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Client chip */}
      {client && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-sidebar-accent flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-sidebar-border">
            {(client as { logoUrl?: string }).logoUrl ? (
              <img
                src={(client as { logoUrl?: string }).logoUrl}
                alt={client.name}
                className="w-full h-full object-contain bg-white"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center font-bold text-white text-sm"
                style={{ backgroundColor: client.color || "hsl(var(--primary))" }}
              >
                {client.avatarInitials}
              </div>
            )}
          </div>
          <div className="overflow-hidden">
            <div className="font-semibold truncate text-sm">{client.name}</div>
            <div className="text-xs text-muted-foreground">Active Client</div>
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 pb-4 space-y-0.5">
        {/* All Clients */}
        <Link
          href="/"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors mb-2",
            location === "/"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Home className="w-4 h-4" />
          All Clients
        </Link>

        {/* Primary nav */}
        {primaryItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}

        {/* Settings always visible */}
        {clientId && (
          <NavLink item={{ href: `/clients/${clientId}/settings`, label: "Settings", icon: Settings }} />
        )}

        {/* Advanced / Coming Later */}
        {clientId && (
          <div className="pt-2">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-semibold hover:text-muted-foreground transition-colors rounded-md"
            >
              {advancedOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Advanced
              <span className="ml-1 text-[9px] bg-muted px-1 py-0.5 rounded text-muted-foreground/60 normal-case tracking-normal font-normal">
                coming later
              </span>
            </button>
            {advancedOpen && (
              <div className="space-y-0.5 mt-1">
                {advancedItems.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="mt-auto pt-3 border-t border-sidebar-border space-y-0.5 px-3 pb-3">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            location === "/settings"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          Settings
        </Link>
        {user && (
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{user.name || user.email}</p>
              {user.name && <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={logout}
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Nav */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2 font-semibold text-base">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
            <ImageIcon className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          AI Studio
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsOpen(true)}>
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Mobile Drawer */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div className="fixed inset-y-0 left-0 w-64 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:block h-screen fixed inset-y-0 left-0 z-40">
        <SidebarContent />
      </div>
    </>
  );
}
