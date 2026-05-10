import { Switch, Route, Router as WouterRouter, Redirect, useParams } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/Layout";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import LoginPage from "@/pages/LoginPage";
import ClientSelector from "@/pages/ClientSelector";
import ClientDashboard from "@/pages/ClientDashboard";
import BrandDna from "@/pages/BrandDna";
import Storylines from "@/pages/Storylines";
import CreatePost from "@/pages/CreatePost";
import ManualPost from "@/pages/ManualPost";
import Drafts from "@/pages/Drafts";
import Calendar from "@/pages/Calendar";
import Memory from "@/pages/Memory";
import SettingsPage from "@/pages/SettingsPage";
import CampaignPlanner from "@/pages/CampaignPlanner";
import PostingQueue from "@/pages/PostingQueue";
import SocialAccounts from "@/pages/SocialAccounts";
import BulkGenerate from "@/pages/BulkGenerate";
import AssetLibrary from "@/pages/AssetLibrary";
import ApprovalQueue from "@/pages/ApprovalQueue";
import PostingRulesPage from "@/pages/PostingRulesPage";
import AiBrainPage from "@/pages/AiBrainPage";
import CampaignGenerator from "@/pages/CampaignGenerator";
import BlogStudio from "@/pages/BlogStudio";
import ImageStudio from "@/pages/ImageStudio";
import VideoStudio from "@/pages/VideoStudio";
import MarketingCalendar from "@/pages/MarketingCalendar";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

async function verifyClientAccess(clientId: string): Promise<boolean> {
  const res = await fetch(`/api/clients/${clientId}`);
  if (res.status === 403 || res.status === 404) return false;
  if (!res.ok) {
    const error = new Error("Client access check failed") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return true;
}

function ClientAccessRoute({ children }: { children: ReactNode }) {
  const { clientId } = useParams<{ clientId?: string }>();
  const access = useQuery({
    queryKey: ["client-access", clientId],
    queryFn: () => verifyClientAccess(clientId!),
    enabled: !!clientId,
    retry: false,
  });

  if (!clientId) return <Redirect to="/" />;
  if (access.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (access.data === false) return <Redirect to="/" />;
  if ((access.error as { status?: number } | null)?.status === 401) return <Redirect to="/login" />;
  if (access.error) return <Redirect to="/" />;
  return <>{children}</>;
}

function ProtectedClientRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <ClientAccessRoute>
        <Layout>{children}</Layout>
      </ClientAccessRoute>
    </ProtectedRoute>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight mb-2">{title}</h1>
      <p className="text-muted-foreground">This section is coming soon.</p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />

      <Route path="/">
        {() => (
          <ProtectedRoute>
            <ClientSelector />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/settings">
        {() => (
          <ProtectedRoute>
            <Layout><SettingsPage /></Layout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/clients/:clientId">
        {() => <ProtectedClientRoute><ClientDashboard /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/brand-dna">
        {() => <ProtectedClientRoute><BrandDna /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/storylines">
        {() => <ProtectedClientRoute><Storylines /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/create">
        {() => <ProtectedClientRoute><CreatePost /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/manual">
        {() => <ProtectedClientRoute><ManualPost /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/drafts">
        {() => <ProtectedClientRoute><Drafts /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/calendar">
        {() => <ProtectedClientRoute><Calendar /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/marketing-calendar">
        {() => <ProtectedClientRoute><MarketingCalendar /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/memory">
        {() => <ProtectedClientRoute><Memory /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/campaigns">
        {() => <ProtectedClientRoute><CampaignPlanner /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/queue">
        {() => <ProtectedClientRoute><PostingQueue /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/social-accounts">
        {() => <ProtectedClientRoute><SocialAccounts /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/bulk-generate">
        {() => <ProtectedClientRoute><BulkGenerate /></ProtectedClientRoute>}
      </Route>

      <Route path="/clients/:clientId/assets">
        {() => <ProtectedClientRoute><AssetLibrary /></ProtectedClientRoute>}
      </Route>

      <Route path="/clients/:clientId/brain">
        {() => <ProtectedClientRoute><AiBrainPage /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/research">
        {() => <ProtectedClientRoute><PlaceholderPage title="Research Engine" /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/campaigns/generate">
        {() => <ProtectedClientRoute><CampaignGenerator /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/blog">
        {() => <ProtectedClientRoute><BlogStudio /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/image-studio">
        {() => <ProtectedClientRoute><ImageStudio /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/video-studio">
        {() => <ProtectedClientRoute><VideoStudio /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/newsletters">
        {() => <ProtectedClientRoute><PlaceholderPage title="Newsletters" /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/approvals">
        {() => <ProtectedClientRoute><ApprovalQueue /></ProtectedClientRoute>}
      </Route>
      <Route path="/clients/:clientId/settings">
        {() => <ProtectedClientRoute><PostingRulesPage /></ProtectedClientRoute>}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
