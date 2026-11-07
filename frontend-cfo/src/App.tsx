import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import CockpitPage from "./pages/CockpitPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import CustomersPage from "./pages/masters/CustomersPage";
import ProjectsPage from "./pages/masters/ProjectsPage";
import EmployeesPage from "./pages/masters/EmployeesPage";
import IntegrationPage from "./pages/IntegrationPage";
import MappingPage from "./pages/MappingPage";
import ProjectAssignmentPage from "./pages/ProjectAssignmentPage";
import SoMilestonePlanningPage from "./pages/SoMilestonePlanningPage";
import ForecastedPnlPage from "./pages/ForecastedPnlPage";
import ExceptionsPage from "./pages/ExceptionsPage";
import ZohoBooksDashboard from "./pages/ZohoBooksDashboard";
import FinancialDashboard from "./pages/FinancialDashboard";
import CashFlowDashboard from "./pages/CashFlowDashboard";
import SalesCockpitPage from "./pages/sales/SalesCockpitPage";
import PipelineSummaryPage from "./pages/sales/PipelineSummaryPage";
import WinRatePage from "./pages/sales/WinRatePage";
import StalledDealsPage from "./pages/sales/StalledDealsPage";
import WeeklySalesReviewPage from "./pages/sales/WeeklySalesReviewPage";

// A plain "sales" role lands on Sales Cockpit, never CFO Cockpit -- this
// is what actually keeps financial data out of a sales-only session,
// since NAV alone only hides links, it doesn't block direct navigation.
function IndexRedirect() {
  const { role } = useAuth();
  return <Navigate to={role === "sales" ? "/sales-cockpit" : "/cockpit"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/" element={<AppShell />}>
            <Route index element={<IndexRedirect />} />
            <Route path="cockpit" element={<CockpitPage />} />
            <Route path="zoho-books" element={<ZohoBooksDashboard />} />
            <Route path="financials" element={<FinancialDashboard />} />
            <Route path="cash-flow" element={<CashFlowDashboard />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="profitability" element={<PlaceholderPage title="Project Profitability" sprint="Sprint 5" />} />
            <Route path="collections" element={<PlaceholderPage title="Collection Control" sprint="Sprint 5" />} />
            <Route path="payables" element={<PlaceholderPage title="Vendor Payables" sprint="Sprint 6" />} />
            <Route path="resources" element={<PlaceholderPage title="Resource Utilization" sprint="Sprint 5" />} />
            <Route path="mapping" element={<MappingPage />} />
            <Route path="project-assignment" element={<ProjectAssignmentPage />} />
            <Route path="so-milestones" element={<SoMilestonePlanningPage />} />
            <Route path="forecast" element={<ForecastedPnlPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
            <Route path="actions" element={<PlaceholderPage title="Action Tracker" sprint="Sprint 6" />} />
            <Route path="integration" element={<IntegrationPage />} />
            <Route path="ai-analyst" element={<Navigate to="/cockpit" replace />} />

            {/* Sales vertical */}
            <Route path="sales-cockpit" element={<SalesCockpitPage />} />
            <Route path="pipeline-summary" element={<PipelineSummaryPage />} />
            <Route path="win-rate" element={<WinRatePage />} />
            <Route path="stalled-deals" element={<StalledDealsPage />} />
            <Route path="weekly-review" element={<WeeklySalesReviewPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}