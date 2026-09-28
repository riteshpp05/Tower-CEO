import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";

interface PipelineSummaryRow {
  stage_bucket: string;
  stage: string;
  quarter_bucket: string;
  deal_count: number;
  total_deal_value: number;
  total_weighted_value: number;
}

function fmtINR(n: number | null | undefined) {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

const BUCKET_ORDER = ["Open - Late", "Open - Mid", "Open - Early", "Won", "Lost", "Unclassified"];
const QUARTER_ORDER = ["Past Due", "This Quarter", "Next Quarter", "Beyond Next Quarter"];

export default function PipelineSummaryPage() {
  const [pipeline, setPipeline] = useState<PipelineSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("v_crm_pipeline_summary").select("*");
    if (error) setError(error.message);
    setPipeline((data as PipelineSummaryRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return <div className="text-ink-500 text-sm">Loading pipeline…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Pipeline Summary</h1>
        <p className="text-xs text-ink-400 mt-0.5">Weighted pipeline by stage and quarter, from Zoho CRM.</p>
      </div>

      {error && (
        <div className="border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-3 text-rose-300 text-xs">{error}</div>
      )}

      <div className="border border-cream-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-cream-100/60 text-ink-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Stage Bucket</th>
              <th className="text-left px-3 py-2 font-medium">Stage</th>
              <th className="text-left px-3 py-2 font-medium">Quarter</th>
              <th className="text-right px-3 py-2 font-medium">Deals</th>
              <th className="text-right px-3 py-2 font-medium">Deal Value</th>
              <th className="text-right px-3 py-2 font-medium">Weighted Value</th>
            </tr>
          </thead>
          <tbody>
            {[...pipeline]
              .sort((a, b) => {
                const bd = BUCKET_ORDER.indexOf(a.stage_bucket) - BUCKET_ORDER.indexOf(b.stage_bucket);
                if (bd !== 0) return bd;
                return QUARTER_ORDER.indexOf(a.quarter_bucket) - QUARTER_ORDER.indexOf(b.quarter_bucket);
              })
              .map((row, i) => (
                <tr key={i} className="border-t border-cream-200 text-ink-700">
                  <td className="px-3 py-2">{row.stage_bucket}</td>
                  <td className="px-3 py-2 text-ink-400">{row.stage}</td>
                  <td className="px-3 py-2 text-ink-400">{row.quarter_bucket}</td>
                  <td className="px-3 py-2 text-right">{row.deal_count}</td>
                  <td className="px-3 py-2 text-right">{fmtINR(row.total_deal_value)}</td>
                  <td className="px-3 py-2 text-right font-medium text-ink-900">{fmtINR(row.total_weighted_value)}</td>
                </tr>
              ))}
            {pipeline.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-300">No pipeline data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}