import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";

interface StallRow {
  zoho_deal_id: string;
  deal_name: string;
  account_name: string | null;
  stage: string;
  amount: number | null;
  resolved_owner_name: string;
  days_since_update: number;
  staleness: string;
}

function fmtINR(n: number | null | undefined) {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

const STALENESS_COLOR: Record<string, string> = {
  "Stale 90+ days": "text-rose-400 bg-rose-950/40 border-rose-900",
  "Stale 60+ days": "text-amber-400 bg-amber-950/40 border-amber-900",
  "Stale 30+ days": "text-ink-700 bg-cream-200/60 border-terra-100",
  Active: "text-emerald-400 bg-emerald-950/40 border-emerald-900",
};

export default function StalledDealsPage() {
  const [stalls, setStalls] = useState<StallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("v_crm_stall_candidates").select("*").limit(100);
    if (error) setError(error.message);
    setStalls((data as StallRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return <div className="text-ink-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Stalled Deals</h1>
        <p className="text-xs text-ink-400 mt-0.5">
          Proxy for deal velocity — Zoho CRM doesn't provide stage-transition history, so this flags open
          deals by time since last update rather than true per-stage duration.
        </p>
      </div>

      {error && (
        <div className="border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-3 text-rose-300 text-xs">{error}</div>
      )}

      <div className="border border-cream-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-cream-100/60 text-ink-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Deal</th>
              <th className="text-left px-3 py-2 font-medium">Account</th>
              <th className="text-left px-3 py-2 font-medium">Stage</th>
              <th className="text-left px-3 py-2 font-medium">Owner</th>
              <th className="text-right px-3 py-2 font-medium">Amount</th>
              <th className="text-right px-3 py-2 font-medium">Days Idle</th>
              <th className="text-right px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {stalls.map(row => (
              <tr key={row.zoho_deal_id} className="border-t border-cream-200 text-ink-700">
                <td className="px-3 py-2">{row.deal_name}</td>
                <td className="px-3 py-2 text-ink-400">{row.account_name || "—"}</td>
                <td className="px-3 py-2 text-ink-400">{row.stage}</td>
                <td className="px-3 py-2">{row.resolved_owner_name}</td>
                <td className="px-3 py-2 text-right">{fmtINR(row.amount)}</td>
                <td className="px-3 py-2 text-right">{row.days_since_update}</td>
                <td className="px-3 py-2 text-right">
                  <span className={`inline-block px-2 py-0.5 rounded border text-[10px] ${STALENESS_COLOR[row.staleness] || "text-ink-500 bg-cream-200/60 border-terra-100"}`}>
                    {row.staleness}
                  </span>
                </td>
              </tr>
            ))}
            {stalls.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-300">No stalled deals — everything's active.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}