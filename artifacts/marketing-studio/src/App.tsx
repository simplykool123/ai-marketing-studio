import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
        {() => <ProtectedRoute><Layout><ClientDashboard /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/brand-dna">
        {() => <ProtectedRoute><Layout><BrandDna /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/storylines">
        {() => <ProtectedRoute><Layout><Storylines /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/create">
        {() => <ProtectedRoute><Layout><CreatePost /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/manual">
        {() => <ProtectedRoute><Layout><ManualPost /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/drafts">
        {() => <ProtectedRoute><Layout><Drafts /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/calendar">
        {() => <ProtectedRoute><Layout><Calendar /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/memory">
        {() => <ProtectedRoute><Layout><Memory /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/campaigns">
        {() => <ProtectedRoute><Layout><CampaignPlanner /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/queue">
        {() => <ProtectedRoute><Layout><PostingQueue /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/social-accounts">
        {() => <ProtectedRoute><Layout><SocialAccounts /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/bulk-generate">
        {() => <ProtectedRoute><Layout><BulkGenerate /></Layout></ProtectedRoute>}
      </Route>

      <Route path="/clients/:clientId/assets">
        {() => <ProtectedRoute><Layout><AssetLibrary /></Layout></ProtectedRoute>}
      </Route>

      <Route path="/clients/:clientId/brain">
        {() => <ProtectedRoute><Layout><PlaceholderPage title="Content Brain" /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/research">
        {() => <ProtectedRoute><Layout><PlaceholderPage title="Research Engine" /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/blog">
        {() => <ProtectedRoute><Layout><PlaceholderPage title="Blog" /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/newsletters">
        {() => <ProtectedRoute><Layout><PlaceholderPage title="Newsletters" /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/approvals">
        {() => <ProtectedRoute><Layout><ApprovalQueue /></Layout></ProtectedRoute>}
      </Route>
      <Route path="/clients/:clientId/settings">
        {() => <ProtectedRoute><Layout><PostingRulesPage /></Layout></ProtectedRoute>}
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
