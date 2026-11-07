import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

interface PipelineSummaryRow {
  stage_bucket: string;
  quarter_bucket: string;
  total_weighted_value: number;
}
interface WinRateRow {
  won_count: number;
  lost_count: number;
}
interface StallRow {
  amount: number | null;
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

export default function SalesCockpitPage() {
  const [pipeline, setPipeline] = useState<PipelineSummaryRow[]>([]);
  const [winRate, setWinRate] = useState<WinRateRow[]>([]);
  const [stalls, setStalls] = useState<StallRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [pipeRes, winRes, stallRes] = await Promise.all([
      supabase.from("v_crm_pipeline_summary").select("stage_bucket,quarter_bucket,total_weighted_value"),
      supabase.from("v_crm_win_rate_by_owner").select("won_count,lost_count"),
      supabase.from("v_crm_stall_candidates").select("amount,staleness"),
    ]);
    setPipeline((pipeRes.data as PipelineSummaryRow[]) || []);
    setWinRate((winRes.data as WinRateRow[]) || []);
    setStalls((stallRes.data as StallRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openWeighted = pipeline
    .filter(p => p.stage_bucket.startsWith("Open"))
    .reduce((s, p) => s + (p.total_weighted_value || 0), 0);
  const thisQuarterWeighted = pipeline
    .filter(p => p.stage_bucket.startsWith("Open") && p.quarter_bucket === "This Quarter")
    .reduce((s, p) => s + (p.total_weighted_value || 0), 0);

  const totalWon = winRate.reduce((s, r) => s + r.won_count, 0);
  const totalLost = winRate.reduce((s, r) => s + r.lost_count, 0);
  const overallWinRate = totalWon + totalLost > 0 ? Math.round((100 * totalWon) / (totalWon + totalLost)) : null;

  const staleCount = stalls.filter(s => s.staleness !== "Active").length;
  const staleValue = stalls.filter(s => s.staleness !== "Active").reduce((s, r) => s + (r.amount || 0), 0);

  if (loading) return <div className="text-ink-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Sales Cockpit</h1>
        <p className="text-xs text-ink-400 mt-0.5">Overview of pipeline, win rate, and deals needing attention.</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Link to="/pipeline-summary" className="border border-cream-200 rounded-lg p-4 bg-cream-100/40 hover:border-terra-100 transition">
          <div className="text-[11px] text-ink-400 uppercase mb-1">Open Weighted Pipeline</div>
          <div className="text-xl font-semibold text-ink-900">{fmtINR(openWeighted)}</div>
        </Link>
        <Link to="/pipeline-summary" className="border border-cream-200 rounded-lg p-4 bg-cream-100/40 hover:border-terra-100 transition">
          <div className="text-[11px] text-ink-400 uppercase mb-1">This Quarter (Weighted)</div>
          <div className="text-xl font-semibold text-ink-900">{fmtINR(thisQuarterWeighted)}</div>
        </Link>
        <Link to="/win-rate" className="border border-cream-200 rounded-lg p-4 bg-cream-100/40 hover:border-terra-100 transition">
          <div className="text-[11px] text-ink-400 uppercase mb-1">Overall Win Rate</div>
          <div className="text-xl font-semibold text-ink-900">{overallWinRate !== null ? `${overallWinRate}%` : "—"}</div>
        </Link>
        <Link to="/stalled-deals" className="border border-cream-200 rounded-lg p-4 bg-cream-100/40 hover:border-terra-100 transition">
          <div className="text-[11px] text-ink-400 uppercase mb-1">Stalled Deals</div>
          <div className="text-xl font-semibold text-rose-400">{staleCount}</div>
          <div className="text-[10px] text-ink-400 mt-0.5">{fmtINR(staleValue)} at risk</div>
        </Link>
      </div>

      <p className="text-xs text-ink-300">
        Data from Zoho CRM. Customer-account mapping is still in progress, so revenue-bridge figures
        (pipeline tied to signed contracts) aren't shown here yet.
      </p>
    </div>
  );
}