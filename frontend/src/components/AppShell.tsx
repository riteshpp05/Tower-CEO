import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import type { RoleName } from "../types/database";
import ChatWidget from "./ChatWidget";
import SalesChatWidget from "./SalesChatWidget";

interface NavItem {
  to?: string;
  icon: string;
  label: string;
  roles?: RoleName[];
  action?: "open-chat";
}

const NAV_FINANCE: NavItem[] = [
  { to: "/cockpit",       icon: "⬡", label: "CFO Cockpit" },
  { to: "/zoho-books",    icon: "◆", label: "Zoho Books Dashboard", roles: ["md","cfo","finance","admin"] },
  { to: "/financials",    icon: "⬢", label: "Financial Dashboard",  roles: ["md","cfo","finance","admin"] },
  { to: "/cash-flow",     icon: "◐", label: "Cash Flow Dashboard",  roles: ["md","cfo","finance","admin"] },
  { to: "/customers",     icon: "▣", label: "Customer Master",       roles: ["md","cfo","finance","sales","admin"] },
  { to: "/projects",      icon: "▢", label: "Project Master",        roles: ["md","cfo","finance","delivery_head","admin"] },
  { to: "/employees",     icon: "▤", label: "Employee Master",       roles: ["md","cfo","hr","delivery_head","admin"] },
  { to: "/profitability", icon: "◈", label: "Project Profitability", roles: ["md","cfo","finance","delivery_head","pm","admin"] },
  { to: "/collections",   icon: "◎", label: "Collection Control",    roles: ["md","cfo","finance","admin"] },
  { to: "/payables",      icon: "◷", label: "Vendor Payables",       roles: ["md","cfo","finance","admin"] },
  { to: "/resources",     icon: "◈", label: "Resource Utilization", roles: ["md","cfo","delivery_head","hr","admin"] },
  { to: "/mapping",       icon: "⊕", label: "Mapping Workbench",     roles: ["md","cfo","finance","admin"] },
  { to: "/project-assignment", icon: "⊞", label: "Project Assignment", roles: ["md","cfo","finance","admin"] },
  { to: "/so-milestones", icon: "◷", label: "SO Milestone Planning", roles: ["md","cfo","finance","admin"] },
  { to: "/forecast", icon: "⬢", label: "Forecasted P&L", roles: ["md","cfo","finance","admin"] },
  { to: "/exceptions",    icon: "◬", label: "Data Exceptions" },
  { to: "/actions",       icon: "◉", label: "Action Tracker" },
  { to: "/integration",   icon: "⊞", label: "Integration Monitor",   roles: ["md","cfo","admin"] },
  { action: "open-chat",  icon: "◆", label: "AI Analyst",            roles: ["md","cfo","finance","admin"] },
];

// Deliberately does NOT include any P&L, cash flow, payables, or vendor
// data -- a sales-only user should never see those, even via a
// roles-filter mistake, because this list simply doesn't contain them.
const NAV_SALES: NavItem[] = [
  { to: "/sales-cockpit",     icon: "◭", label: "Sales Cockpit" },
  { to: "/pipeline-summary",  icon: "◫", label: "Pipeline Summary" },
  { to: "/win-rate",          icon: "◧", label: "Win Rate" },
  { to: "/stalled-deals",     icon: "◩", label: "Stalled Deals" },
  { to: "/weekly-review",     icon: "◪", label: "Weekly Sales Review" },
  { to: "/customers",         icon: "▣", label: "Customer Master" },
];

// Roles that legitimately need both towers and get the switcher.
// A plain "sales" role never sees this toggle -- they're locked into
// NAV_SALES with no path back to financial data through the UI.
const CAN_TOGGLE: RoleName[] = ["md", "cfo", "admin"];

export default function AppShell() {
  const { session, profile, role, loading, signOut } = useAuth();
  const [chatOpenSignal, setChatOpenSignal] = useState(0);

  const canToggle = !!role && CAN_TOGGLE.includes(role);
  const isSalesOnly = role === "sales";

  const [manualView, setManualView] = useState<"finance" | "sales" | null>(null);
  const activeView: "finance" | "sales" = isSalesOnly ? "sales" : (manualView ?? "finance");

  const navSet = activeView === "sales" ? NAV_SALES : NAV_FINANCE;
  const visibleNav = useMemo(
    () => navSet.filter(n => !n.roles || (role && n.roles.includes(role))),
    [navSet, role]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center text-ink-500 text-sm">
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  if (profile && !role) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center text-ink-700 text-sm leading-relaxed">
          <div className="text-3xl mb-3">⬡</div>
          <p className="text-ink-900 font-medium mb-2">Account pending role assignment</p>
          <p>Your account is created but no role has been assigned yet. Ask an administrator to assign your role in Supabase before you can access modules.</p>
          <button
            onClick={signOut}
            className="mt-4 border border-terra-100 rounded-lg px-4 py-2 text-ink-500 text-xs hover:bg-cream-200 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const headerTitle = activeView === "sales" ? "Sales Pipeline Tower" : "CFO Ops Control Tower";

  return (
    <div className="bg-cream-50 min-h-screen text-ink-900">
      <div className="px-5 py-3.5 border-b border-cream-200 flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-terra-500 to-terra-700 flex items-center justify-center text-sm">⬡</div>
        <div>
          <div className="text-sm font-semibold">{headerTitle}</div>
          <div className="text-[11px] text-ink-400">Tower-CEO Enterprise</div>
        </div>

        {canToggle && (
          <div className="ml-6 flex bg-cream-100 border border-cream-200 rounded-md p-0.5">
            <button
              onClick={() => setManualView("finance")}
              className={`px-3 py-1 rounded text-[11px] transition ${
                activeView === "finance" ? "bg-terra-100 text-ink-900" : "text-ink-400 hover:text-ink-700"
              }`}
            >
              Finance
            </button>
            <button
              onClick={() => setManualView("sales")}
              className={`px-3 py-1 rounded text-[11px] transition ${
                activeView === "sales" ? "bg-terra-100 text-ink-900" : "text-ink-400 hover:text-ink-700"
              }`}
            >
              Sales
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          <div className="text-right">
            <div className="text-xs text-ink-700">{profile?.full_name}</div>
            <div className="text-[10px] text-ink-400 uppercase">{role}</div>
          </div>
          <button
            onClick={signOut}
            className="bg-cream-200 hover:bg-terra-100 rounded-md px-3 py-1.5 text-ink-700 text-[11px] transition"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="flex">
        <div className="w-52 min-h-[calc(100vh-57px)] bg-cream-50 border-r border-cream-200 p-2 flex-shrink-0">
          {visibleNav.map(n => (
            n.action === "open-chat" ? (
              <button
                key={n.label}
                onClick={() => setChatOpenSignal(s => s + 1)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 text-sm transition text-ink-400 hover:text-ink-700 w-full text-left bg-transparent border-none cursor-pointer"
              >
                <span className="text-sm">{n.icon}</span>
                {n.label}
              </button>
            ) : (
              <NavLink
                key={n.to}
                to={n.to!}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 text-sm transition ${
                    isActive ? "bg-cream-200 text-ink-900" : "text-ink-400 hover:text-ink-700"
                  }`
                }
              >
                <span className="text-sm">{n.icon}</span>
                {n.label}
              </NavLink>
            )
          ))}
        </div>

        <div className="flex-1 p-7 overflow-y-auto max-h-[calc(100vh-57px)]">
          <Outlet />
        </div>
      </div>

      {activeView === "finance" && <ChatWidget openSignal={chatOpenSignal} />}
      {activeView === "sales" && <SalesChatWidget openSignal={0} />}
    </div>
  );
}