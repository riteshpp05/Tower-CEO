import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";

interface WinRateRow {
  resolved_owner_name: string;
  employee_id: string | null;
  won_count: number;
  lost_count: number;
  win_rate_pct: number | null;
  won_value: number | null;
}

function fmtINR(n: number | null | undefined) {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

export default function WinRatePage() {
  const [winRate, setWinRate] = useState<WinRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("v_crm_win_rate_by_owner").select("*");
    if (error) setError(error.message);
    setWinRate((data as WinRateRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return <div className="text-ink-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Win Rate by Owner</h1>
        <p className="text-xs text-ink-400 mt-0.5">Closed-won vs closed-lost, from Zoho CRM.</p>
      </div>

      {error && (
        <div className="border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-3 text-rose-300 text-xs">{error}</div>
      )}

      <div className="border border-cream-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-cream-100/60 text-ink-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Owner</th>
              <th className="text-right px-3 py-2 font-medium">Won</th>
              <th className="text-right px-3 py-2 font-medium">Lost</th>
              <th className="text-right px-3 py-2 font-medium">Win Rate</th>
              <th className="text-right px-3 py-2 font-medium">Won Value</th>
            </tr>
          </thead>
          <tbody>
            {winRate.map((row, i) => (
              <tr key={i} className="border-t border-cream-200 text-ink-700">
                <td className="px-3 py-2">
                  {row.resolved_owner_name}
                  {!row.employee_id && (
                    <span className="ml-2 text-[10px] text-amber-500" title="No linked employee record">unlinked</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-emerald-400">{row.won_count}</td>
                <td className="px-3 py-2 text-right text-rose-400">{row.lost_count}</td>
                <td className="px-3 py-2 text-right">{row.win_rate_pct !== null ? `${row.win_rate_pct}%` : "—"}</td>
                <td className="px-3 py-2 text-right font-medium text-ink-900">{fmtINR(row.won_value)}</td>
              </tr>
            ))}
            {winRate.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-300">No win/loss data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}