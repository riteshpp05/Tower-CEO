import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Link } from "react-router-dom";
import { Settings } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProposalProvider } from "@/contexts/ProposalContext";
import { CommercialRulesProvider } from "@/contexts/CommercialRulesContext";
import { AppLayout } from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import Dashboard from "@/pages/Dashboard";
import ProposalListPage from "@/pages/ProposalListPage";
import NewProposalPage from "@/pages/NewProposalPage";
import ProposalWorkspacePage from "@/pages/ProposalWorkspacePage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import CommercialRulesPage from "@/pages/CommercialRulesPage";
import LegalLibraryPage from "@/pages/LegalLibraryPage";
import ResourcesPage from "@/pages/ResourcesPage";
import TenderEnginePage from "@/pages/TenderEnginePage";
import TenderNewPage from "@/pages/TenderNewPage";
import TenderBriefPage from "@/pages/TenderBriefPage";
import TenderQualificationPage from "@/pages/TenderQualificationPage";
import TenderSubmissionPage from "@/pages/TenderSubmissionPage";
import ApprovalsPage from "@/pages/ApprovalsPage";
import ReportsPage from "@/pages/ReportsPage";
import AdminSettingsPage from "@/pages/AdminSettingsPage";
import TemplateManagementPage from "@/pages/TemplateManagementPage";
import PricingStrategyPage from "@/pages/PricingStrategyPage.tsx";
import { PricingStrategyProvider } from "@/contexts/PricingStrategyContext";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function AdminRoute() {
  const { user } = useAuth();
  if (user?.role !== 'Admin') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <div className="rounded-full bg-destructive/10 p-4">
          <Settings className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Only users with the <span className="font-medium">Admin</span> role can access Admin Settings.
          Contact your administrator for access.
        </p>
        <Link to="/" className="text-primary underline text-sm mt-2">Back to Dashboard</Link>
      </div>
    );
  }
  return <AdminSettingsPage />;
}

function AuthenticatedApp() {
  const { isAuthenticated } = useAuth();

  // Always render ResetPasswordPage on /reset-password regardless of auth state,
  // because the user arrives here without a session (just a recovery token).
  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {!isAuthenticated ? (
        // All other routes → login page when not signed in
        <Route path="*" element={<LoginPage />} />
      ) : (
        <Route
          path="*"
          element={
            <AppLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/proposals" element={<ProposalListPage />} />
                <Route path="/proposals/new" element={<NewProposalPage />} />
                <Route path="/proposals/:id" element={<ProposalWorkspacePage />} />
                <Route path="/knowledge" element={<KnowledgeBasePage />} />
                <Route path="/templates" element={<TemplateManagementPage />} />
                <Route path="/commercial" element={<CommercialRulesPage />} />
                <Route path="/pricing" element={<PricingStrategyPage />} />
                <Route path="/legal" element={<LegalLibraryPage />} />
                <Route path="/resources" element={<ResourcesPage />} />
                <Route path="/tender" element={<TenderEnginePage />} />
                <Route path="/tender/new" element={<TenderNewPage />} />
                <Route path="/tender/:id/brief" element={<TenderBriefPage />} />
                <Route path="/tender/:id/qualification" element={<TenderQualificationPage />} />
                <Route path="/tender/:id/submission" element={<TenderSubmissionPage />} />
                <Route path="/approvals" element={<ApprovalsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/admin" element={<AdminRoute />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          }
        />
      )}
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <CommercialRulesProvider>
        <PricingStrategyProvider>
            <ProposalProvider>
              <BrowserRouter>
                <AuthenticatedApp />
              </BrowserRouter>
            </ProposalProvider>
        </PricingStrategyProvider>
        </CommercialRulesProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;