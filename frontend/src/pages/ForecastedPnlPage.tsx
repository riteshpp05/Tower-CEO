import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

interface RevenueForecastRow {
  forecast_month: string;
  project_id: string;
  project_name: string;
  customer_name: string;
  forecast_method: "contract" | "so_milestone" | "trailing_average" | "unplanned";
  forecasted_revenue: number;
}

interface CostForecastRow {
  forecast_month: string;
  resource_cost: number;
  vendor_cost: number;
  total_cost: number;
  active_headcount: number;
  billable_headcount: number;
  bench_headcount: number;
}

function fmtINR(n: number | null | undefined) {
  if (n === null || n === undefined) return "₹0";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtMonth(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

const METHOD_LABELS: Record<string, { label: string; color: string }> = {
  contract: { label: "Contract", color: "#0D9488" },
  so_milestone: { label: "SO Milestone", color: "#6366F1" },
  trailing_average: { label: "Trailing avg", color: "#94A3B8" },
  unplanned: { label: "Needs input", color: "#F59E0B" },
};

export default function ForecastedPnlPage() {
  const [revenueRows, setRevenueRows] = useState<RevenueForecastRow[]>([]);
  const [costRows, setCostRows] = useState<CostForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [revRes, costRes] = await Promise.all([
      supabase.rpc("get_revenue_forecast", { p_months: 3 }),
      supabase.rpc("get_cost_forecast", { p_months: 3 }),
    ]);
    if (revRes.error) setError(revRes.error.message);
    else setRevenueRows((revRes.data as RevenueForecastRow[]) || []);
    if (costRes.error) setError(prev => prev || costRes.error!.message);
    else setCostRows((costRes.data as CostForecastRow[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const months = useMemo(() => {
    const uniqueMonths = Array.from(new Set(costRows.map(r => r.forecast_month))).sort();
    return uniqueMonths.map(month => {
      const revenueForMonth = revenueRows.filter(r => r.forecast_month === month);
      const cost = costRows.find(r => r.forecast_month === month);
      const totalRevenue = revenueForMonth
        .filter(r => r.forecast_method !== "unplanned")
        .reduce((s, r) => s + (r.forecasted_revenue || 0), 0);
      const unplannedCount = revenueForMonth.filter(r => r.forecast_method === "unplanned").length;
      return {
        month,
        totalRevenue,
        cost,
        margin: totalRevenue - (cost?.total_cost || 0),
        rows: revenueForMonth,
        unplannedCount,
      };
    });
  }, [revenueRows, costRows]);

  const activeMonth = months.find(m => m.month === selectedMonth) || months[0];

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Forecasted P&amp;L</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
            Rolling 3-month projection from contracts, SO milestones, and trailing averages — not a manually-set budget.
          </p>
        </div>
        <Link
          to="/so-milestones"
          style={{ fontSize: 11, color: "#94A3B8", textDecoration: "none", border: "1px solid #1E3A5F",
            borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap" }}
        >
          → SO Milestone Planning
        </Link>
      </div>

      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#4A6FA5", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length || 1},1fr)`, gap: 12, marginBottom: 20 }}>
            {months.map(m => (
              <div
                key={m.month}
                onClick={() => setSelectedMonth(m.month)}
                style={{
                  background: "#0F1E35", borderRadius: 10, padding: "16px 18px", cursor: "pointer",
                  border: `1px solid ${activeMonth?.month === m.month ? "#6366F1" : "#1E3A5F"}`,
                }}
              >
                <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8 }}>{fmtMonth(m.month)}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>Revenue</div>
                <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: "#6366F1" }}>{fmtINR(m.totalRevenue)}</div>
                <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>Cost (resource + vendor)</div>
                <div style={{ fontFamily: "monospace", fontSize: 14, color: "#F59E0B" }}>{fmtINR(m.cost?.total_cost)}</div>
                <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>Forecasted margin</div>
                <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: m.margin >= 0 ? "#0D9488" : "#EF4444" }}>
                  {fmtINR(m.margin)}
                </div>
                {m.unplannedCount > 0 && (
                  <div style={{ marginTop: 8, fontSize: 10, color: "#FCD34D" }}>
                    ⚠ {m.unplannedCount} project(s) need milestone input
                  </div>
                )}
              </div>
            ))}
          </div>

          {activeMonth && activeMonth.cost && (
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8 }}>
                Headcount basis for {fmtMonth(activeMonth.month)}
              </div>
              <div style={{ display: "flex", gap: 24, fontSize: 12, color: "#CBD5E1" }}>
                <span>Active: <strong style={{ color: "#E2E8F0" }}>{activeMonth.cost.active_headcount}</strong></span>
                <span>Billable: <strong style={{ color: "#0D9488" }}>{activeMonth.cost.billable_headcount}</strong></span>
                <span>Bench: <strong style={{ color: "#F59E0B" }}>{activeMonth.cost.bench_headcount}</strong></span>
              </div>
            </div>
          )}

          {activeMonth && (
            <div>
              <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 500, marginBottom: 10 }}>
                Revenue breakdown — {fmtMonth(activeMonth.month)}
              </div>
              {activeMonth.rows.length === 0 ? (
                <div style={{ color: "#4A6FA5", fontSize: 12 }}>No projects have a forecastable signal for this month.</div>
              ) : (
                <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, overflow: "hidden" }}>
                  {activeMonth.rows
                    .sort((a, b) => (b.forecasted_revenue || 0) - (a.forecasted_revenue || 0))
                    .map((row, i) => {
                      const methodInfo = METHOD_LABELS[row.forecast_method];
                      return (
                        <div
                          key={`${row.project_id}-${i}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                            borderBottom: i === activeMonth.rows.length - 1 ? "none" : "1px solid #14233F",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "#E2E8F0" }}>{row.project_name}</div>
                            <div style={{ fontSize: 11, color: "#4A6FA5" }}>{row.customer_name}</div>
                          </div>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4,
                            background: `${methodInfo.color}22`, color: methodInfo.color, whiteSpace: "nowrap",
                          }}>
                            {methodInfo.label}
                          </span>
                          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#CBD5E1", width: 100, textAlign: "right" }}>
                            {row.forecast_method === "unplanned" ? "—" : fmtINR(row.forecasted_revenue)}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
