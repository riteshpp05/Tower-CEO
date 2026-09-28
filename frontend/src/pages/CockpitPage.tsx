import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CockpitSummary } from "../types/database";

export default function CockpitPage() {
  const [data, setData] = useState<CockpitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("v_cfo_cockpit")
        .select("*")
        .single();
      if (error) setError(error.message);
      else setData(data as CockpitSummary);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="text-ink-400 text-sm">Loading cockpit…</div>;
  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-xs">
        ⚠ {error}
      </div>
    );
  }
  if (!data) return <div className="text-red-300 text-xs">No cockpit data returned.</div>;

  const cards = [
    { label: "Revenue billed (MTD)", value: fmtINR(data.revenue_billed_mtd) },
    { label: "Weighted pipeline",    value: fmtINR(data.weighted_pipeline) },
    { label: "Total outstanding",    value: fmtINR(data.total_outstanding) },
    { label: "Overdue >0 days",      value: fmtINR(data.total_overdue) },
    { label: "Vendor payables",      value: fmtINR(data.total_payables) },
    { label: "Critical exceptions",  value: data.critical_exceptions },
    { label: "Overdue actions",      value: data.overdue_actions },
    { label: "Billable headcount",   value: data.billable_headcount },
    { label: "Bench headcount",      value: data.bench_headcount },
    { label: "Open tickets",         value: data.open_tickets },
  ];

  const isEmpty = data.revenue_billed_mtd === 0 && data.total_outstanding === 0 && data.billable_headcount === 0;

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-medium m-0">CFO Cockpit</h2>
        <p className="text-xs text-ink-400 mt-1">Live from v_cfo_cockpit · Supabase</p>
      </div>

      {isEmpty && (
        <div className="bg-cream-100 border border-cream-200 rounded-lg px-4.5 py-3.5 mb-5 text-xs text-ink-500">
          All zeros — this is expected. No customers, projects, or invoices have been added yet.
          Once Sprint 2 (Master Data CRUD) is built, this will populate with real numbers.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-cream-100 border border-cream-200 rounded-lg px-4.5 py-4">
            <div className="font-mono text-2xl font-bold text-ink-900">{c.value}</div>
            <div className="text-[11px] text-ink-400 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}
