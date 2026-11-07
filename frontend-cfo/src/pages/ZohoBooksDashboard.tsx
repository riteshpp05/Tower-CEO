import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface ConfidenceRow {
  module: string;
  score: number;
  confidence_label: string;
  factors: {
    mapping_pct: number;
    freshness_score: number;
    exception_pct: number;
    total_records: number;
    last_sync_hours_ago: number;
  };
  calculated_at: string;
}

interface CountSummary {
  invoices: number;
  vendor_bills: number;
  sales_orders: number;
  customer_payments: number;
  vendor_payments: number;
  credit_notes: number;
  vendor_credits: number;
  customers_mapped: number;
  vendors_mapped: number;
  currencies: number;
}

function confidenceMeta(score: number) {
  if (score >= 90) return { color: "#0D9488", label: "High" };
  if (score >= 70) return { color: "#F59E0B", label: "Caution" };
  return { color: "#EF4444", label: "Low" };
}

export default function ZohoBooksDashboard() {
  const [confidence, setConfidence] = useState<ConfidenceRow[]>([]);
  const [counts, setCounts] = useState<CountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const [
      confRes, invRes, billRes, soRes, cpRes, vpRes, cnRes, vcRes, custMapRes, vendMapRes, currRes,
    ] = await Promise.all([
      supabase.from("v_confidence_dashboard").select("*"),
      supabase.from("raw_zoho_invoices").select("*", { count: "exact", head: true }),
      supabase.from("raw_zoho_vendor_bills").select("*", { count: "exact", head: true }),
      supabase.from("raw_zoho_sales_orders").select("*", { count: "exact", head: true }),
      supabase.from("raw_zoho_customer_payments").select("*", { count: "exact", head: true }),
      supabase.from("raw_zoho_vendor_payments").select("*", { count: "exact", head: true }),
      supabase.from("raw_zoho_credit_notes").select("*", { count: "exact", head: true }),
      supabase.from("raw_zoho_vendor_credits").select("*", { count: "exact", head: true }),
      supabase.from("customer_source_mappings").select("*", { count: "exact", head: true }),
      supabase.from("vendor_source_mappings").select("*", { count: "exact", head: true }),
      supabase.from("currencies").select("*", { count: "exact", head: true }),
    ]);

    if (confRes.error) setError(confRes.error.message);
    else setConfidence((confRes.data as ConfidenceRow[]) || []);

    setCounts({
      invoices: invRes.count || 0,
      vendor_bills: billRes.count || 0,
      sales_orders: soRes.count || 0,
      customer_payments: cpRes.count || 0,
      vendor_payments: vpRes.count || 0,
      credit_notes: cnRes.count || 0,
      vendor_credits: vcRes.count || 0,
      customers_mapped: custMapRes.count || 0,
      vendors_mapped: vendMapRes.count || 0,
      currencies: currRes.count || 0,
    });

    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function recalculate() {
    setRecalculating(true);
    setError(null);
    const { error } = await supabase.rpc("calculate_confidence_scores");
    if (error) setError(error.message);
    await load();
    setRecalculating(false);
  }

  const totalRecords = counts
    ? counts.invoices + counts.vendor_bills + counts.sales_orders + counts.customer_payments +
      counts.vendor_payments + counts.credit_notes + counts.vendor_credits
    : 0;

  const dataRows = counts ? [
    { label: "Invoices", value: counts.invoices, color: "#6366F1" },
    { label: "Vendor bills", value: counts.vendor_bills, color: "#F59E0B" },
    { label: "Sales orders", value: counts.sales_orders, color: "#0D9488" },
    { label: "Customer payments", value: counts.customer_payments, color: "#6366F1" },
    { label: "Vendor payments", value: counts.vendor_payments, color: "#F59E0B" },
    { label: "Credit notes", value: counts.credit_notes, color: "#0D9488" },
    { label: "Vendor credits", value: counts.vendor_credits, color: "#94A3B8" },
  ] : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Zoho Books Dashboard</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
            Complete sync summary · multi-currency aware · {totalRecords.toLocaleString()} total records
          </p>
        </div>
        <button
          onClick={recalculate}
          disabled={recalculating}
          style={{ background: "#0D9488", border: "none", borderRadius: 8, padding: "9px 18px",
            color: "white", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: recalculating ? 0.6 : 1, whiteSpace: "nowrap" }}
        >
          {recalculating ? "Calculating…" : "↻ Recalculate confidence"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#4A6FA5", fontSize: 13 }}>Loading dashboard…</div>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5",
              marginBottom: 12, textTransform: "uppercase" }}>
              Data confidence
            </div>
            {confidence.length === 0 ? (
              <div style={{ background: "#0F1E35", border: "1px dashed #1E3A5F", borderRadius: 10,
                padding: "20px", textAlign: "center", color: "#4A6FA5", fontSize: 13 }}>
                No confidence scores calculated yet. Click "Recalculate confidence" above.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                {confidence.map((c) => {
                  const meta = confidenceMeta(c.score);
                  return (
                    <div key={c.module} style={{ background: "#0F1E35", border: `1px solid ${meta.color}44`,
                      borderRadius: 10, padding: "16px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 500, textTransform: "capitalize" }}>{c.module}</div>
                          <div style={{ fontSize: 11, color: "#4A6FA5", marginTop: 2 }}>
                            {c.factors.total_records?.toLocaleString()} records
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 700, color: meta.color }}>
                            {Math.round(c.score)}
                          </div>
                          <div style={{ fontSize: 10, color: meta.color }}>{meta.label}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#64748B" }}>
                        <span>Mapped: <span style={{ color: "#94A3B8" }}>{c.factors.mapping_pct}%</span></span>
                        <span>Fresh: <span style={{ color: "#94A3B8" }}>{c.factors.freshness_score}</span></span>
                        <span>Clean: <span style={{ color: "#94A3B8" }}>{100 - (c.factors.exception_pct || 0)}%</span></span>
                      </div>
                      <div style={{ marginTop: 10, height: 4, background: "#1E3A5F", borderRadius: 2 }}>
                        <div style={{ height: 4, width: `${c.score}%`, background: meta.color, borderRadius: 2, transition: "width .6s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#0D9488" }}>{counts?.customers_mapped}</div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Customers mapped</div>
            </div>
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#0D9488" }}>{counts?.vendors_mapped}</div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Vendors mapped</div>
            </div>
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#6366F1" }}>{counts?.currencies}</div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Currencies tracked</div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5",
            marginBottom: 12, textTransform: "uppercase" }}>
            Record breakdown
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, overflow: "hidden" }}>
            {dataRows.map((row, i) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                borderBottom: i < dataRows.length - 1 ? "1px solid #1E3A5F" : "none" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 12, color: "#CBD5E1" }}>{row.label}</div>
                <div style={{ width: 140, height: 6, background: "#1E3A5F", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: 6, width: `${totalRecords ? (row.value / totalRecords) * 100 : 0}%`,
                    background: row.color, borderRadius: 3 }} />
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 13, color: "#E2E8F0", minWidth: 60, textAlign: "right" }}>
                  {row.value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
