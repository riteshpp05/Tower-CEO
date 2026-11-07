import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface PeriodKPIs {
  revenue_billed: number;
  total_collected: number;
  total_paid_out: number;
  sales_orders_raised: number;
  credit_notes_issued: number;
  vendor_credits_received: number;
  invoice_count: number;
  payment_count: number;
}

interface AsOnKPIs {
  total_outstanding: number;
  total_overdue: number;
  total_payables: number;
  total_payables_overdue: number;
  net_position: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  open_bill_count: number;
  overdue_bill_count: number;
}

interface AgeingRow {
  ageing_bucket: string;
  invoice_count?: number;
  bill_count?: number;
  total_balance: number;
}

interface ReceivableRow {
  customer_id: string;
  customer_name: string;
  total_outstanding: number;
  total_overdue: number;
  invoice_count: number;
}

interface PayableRow {
  vendor_id: string;
  vendor_name: string;
  total_outstanding: number;
  total_overdue: number;
  bill_count: number;
}

type PeriodPreset = "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";

function fmtINR(n: number | null | undefined) {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getPresetRange(preset: PeriodPreset): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this_month":
      return { start: new Date(y, m, 1).toISOString().slice(0, 10), end: todayISO() };
    case "last_month":
      return {
        start: new Date(y, m - 1, 1).toISOString().slice(0, 10),
        end: new Date(y, m, 0).toISOString().slice(0, 10),
      };
    case "this_quarter": {
      const qStartMonth = Math.floor(m / 3) * 3;
      return { start: new Date(y, qStartMonth, 1).toISOString().slice(0, 10), end: todayISO() };
    }
    case "this_year":
      return { start: new Date(y, 0, 1).toISOString().slice(0, 10), end: todayISO() };
    default:
      return { start: todayISO(), end: todayISO() };
  }
}

const ageingColors: Record<string, string> = {
  "Current": "#0D9488",
  "1-30 days": "#6366F1",
  "31-60 days": "#F59E0B",
  "61-90 days": "#EF4444",
  "90+ days": "#B91C1C",
  "No due date": "#64748B",
};

export default function FinancialDashboard() {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this_month");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [asOnDate, setAsOnDate] = useState(todayISO());

  const [periodKpis, setPeriodKpis] = useState<PeriodKPIs | null>(null);
  const [asOnKpis, setAsOnKpis] = useState<AsOnKPIs | null>(null);
  const [receivablesAgeing, setReceivablesAgeing] = useState<AgeingRow[]>([]);
  const [payablesAgeing, setPayablesAgeing] = useState<AgeingRow[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [tab, setTab] = useState<"receivables" | "payables">("receivables");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveRange = periodPreset === "custom"
    ? { start: customStart, end: customEnd }
    : getPresetRange(periodPreset);

  async function loadPeriodData() {
    const { data, error } = await supabase.rpc("get_period_kpis", {
      p_start_date: effectiveRange.start,
      p_end_date: effectiveRange.end,
    });
    if (error) { setError(error.message); return; }
    setPeriodKpis((data as PeriodKPIs[])?.[0] || null);
  }

  async function loadAsOnData() {
    const [kpiRes, recAgeRes, payAgeRes, recRes, payRes] = await Promise.all([
      supabase.rpc("get_as_on_kpis", { p_as_on_date: asOnDate }),
      supabase.rpc("get_receivables_ageing", { p_as_on_date: asOnDate }),
      supabase.rpc("get_payables_ageing", { p_as_on_date: asOnDate }),
      supabase.rpc("get_top_receivables", { p_as_on_date: asOnDate, p_limit: 20 }),
      supabase.rpc("get_top_payables", { p_as_on_date: asOnDate, p_limit: 20 }),
    ]);
    if (kpiRes.error) { setError(kpiRes.error.message); return; }
    setAsOnKpis((kpiRes.data as AsOnKPIs[])?.[0] || null);
    setReceivablesAgeing((recAgeRes.data as AgeingRow[]) || []);
    setPayablesAgeing((payAgeRes.data as AgeingRow[]) || []);
    setReceivables((recRes.data as ReceivableRow[]) || []);
    setPayables((payRes.data as PayableRow[]) || []);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadPeriodData().finally(() => setLoading(false));
  }, [periodPreset, customStart, customEnd]);

  useEffect(() => {
    setError(null);
    loadAsOnData();
  }, [asOnDate]);

  const periodCards = periodKpis ? [
    { label: "Revenue billed", value: fmtINR(periodKpis.revenue_billed), color: "#6366F1", sub: `${periodKpis.invoice_count} invoices` },
    { label: "Collected", value: fmtINR(periodKpis.total_collected), color: "#0D9488", sub: `${periodKpis.payment_count} payments` },
    { label: "Paid out", value: fmtINR(periodKpis.total_paid_out), color: "#94A3B8" },
    { label: "Sales orders raised", value: fmtINR(periodKpis.sales_orders_raised), color: "#F59E0B" },
    { label: "Credit notes issued", value: fmtINR(periodKpis.credit_notes_issued), color: "#EF4444" },
    { label: "Vendor credits received", value: fmtINR(periodKpis.vendor_credits_received), color: "#64748B" },
  ] : [];

  const asOnCards = asOnKpis ? [
    { label: "Outstanding receivables", value: fmtINR(asOnKpis.total_outstanding), color: "#F59E0B", sub: `${asOnKpis.open_invoice_count} open` },
    { label: "Overdue receivables", value: fmtINR(asOnKpis.total_overdue), color: "#EF4444", sub: `${asOnKpis.overdue_invoice_count} overdue` },
    { label: "Outstanding payables", value: fmtINR(asOnKpis.total_payables), color: "#F59E0B", sub: `${asOnKpis.open_bill_count} open` },
    { label: "Overdue payables", value: fmtINR(asOnKpis.total_payables_overdue), color: "#EF4444", sub: `${asOnKpis.overdue_bill_count} overdue` },
    { label: "Net position", value: fmtINR(asOnKpis.net_position), color: asOnKpis.net_position >= 0 ? "#0D9488" : "#EF4444" },
  ] : [];

  const maxReceivable = Math.max(...receivablesAgeing.map(r => r.total_balance || 0), 1);
  const maxPayable = Math.max(...payablesAgeing.map(r => r.total_balance || 0), 1);

  const presetLabels: Record<PeriodPreset, string> = {
    this_month: "This month", last_month: "Last month",
    this_quarter: "This quarter", this_year: "This year", custom: "Custom",
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Financial Dashboard</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
          Live from Zoho Books · INR-normalized across all currencies
        </p>
      </div>

      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5", textTransform: "uppercase" }}>
          Activity for period
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {(["this_month", "last_month", "this_quarter", "this_year", "custom"] as PeriodPreset[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriodPreset(p)}
              style={{ fontSize: 11, padding: "5px 11px", borderRadius: 16, border: "1px solid #1E3A5F",
                background: periodPreset === p ? "#1E3A5F" : "transparent",
                color: periodPreset === p ? "#E2E8F0" : "#4A6FA5", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {presetLabels[p]}
            </button>
          ))}
          {periodPreset === "custom" && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                style={{ background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6, padding: "4px 8px",
                  color: "#E2E8F0", fontSize: 11, outline: "none" }} />
              <span style={{ color: "#4A6FA5", fontSize: 11 }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                style={{ background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6, padding: "4px 8px",
                  color: "#E2E8F0", fontSize: 11, outline: "none" }} />
            </>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#4A6FA5", marginBottom: 12 }}>
        {effectiveRange.start} to {effectiveRange.end}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 28 }}>
        {loading || !periodKpis ? (
          <div style={{ color: "#4A6FA5", fontSize: 12 }}>Loading…</div>
        ) : periodCards.map((k) => (
          <div key={k.label} style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{k.label}</div>
            {k.sub && <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5", textTransform: "uppercase" }}>
          Position as on date
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setAsOnDate(todayISO())}
            style={{ fontSize: 11, padding: "5px 11px", borderRadius: 16, border: "1px solid #1E3A5F",
              background: asOnDate === todayISO() ? "#1E3A5F" : "transparent",
              color: asOnDate === todayISO() ? "#E2E8F0" : "#4A6FA5", cursor: "pointer" }}
          >
            Today
          </button>
          <input type="date" value={asOnDate} onChange={e => setAsOnDate(e.target.value)}
            style={{ background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6, padding: "4px 8px",
              color: "#E2E8F0", fontSize: 11, outline: "none" }} />
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#4A6FA5", marginBottom: 12 }}>
        Balances approximated from transaction date + current balance (Zoho does not provide historical daily snapshots)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        {!asOnKpis ? (
          <div style={{ color: "#4A6FA5", fontSize: 12 }}>Loading…</div>
        ) : asOnCards.map((k) => (
          <div key={k.label} style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{k.label}</div>
            {k.sub && <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5",
            marginBottom: 10, textTransform: "uppercase" }}>
            Receivables ageing
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "16px 18px" }}>
            {receivablesAgeing.map((row) => (
              <div key={row.ageing_bucket} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "#94A3B8" }}>{row.ageing_bucket}</span>
                  <span style={{ fontFamily: "monospace", color: "#CBD5E1" }}>
                    {fmtINR(row.total_balance)} <span style={{ color: "#4A6FA5" }}>({row.invoice_count})</span>
                  </span>
                </div>
                <div style={{ height: 6, background: "#1E3A5F", borderRadius: 3 }}>
                  <div style={{ height: 6, borderRadius: 3, background: ageingColors[row.ageing_bucket] || "#64748B",
                    width: `${(row.total_balance / maxReceivable) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5",
            marginBottom: 10, textTransform: "uppercase" }}>
            Payables ageing
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "16px 18px" }}>
            {payablesAgeing.map((row) => (
              <div key={row.ageing_bucket} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "#94A3B8" }}>{row.ageing_bucket}</span>
                  <span style={{ fontFamily: "monospace", color: "#CBD5E1" }}>
                    {fmtINR(row.total_balance)} <span style={{ color: "#4A6FA5" }}>({row.bill_count})</span>
                  </span>
                </div>
                <div style={{ height: 6, background: "#1E3A5F", borderRadius: 3 }}>
                  <div style={{ height: 6, borderRadius: 3, background: ageingColors[row.ageing_bucket] || "#64748B",
                    width: `${(row.total_balance / maxPayable) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setTab("receivables")}
          style={{ padding: "7px 16px", borderRadius: 20, border: "1px solid #1E3A5F", fontSize: 12,
            background: tab === "receivables" ? "#1E3A5F" : "transparent",
            color: tab === "receivables" ? "#E2E8F0" : "#4A6FA5", cursor: "pointer" }}
        >
          Top receivables
        </button>
        <button
          onClick={() => setTab("payables")}
          style={{ padding: "7px 16px", borderRadius: 20, border: "1px solid #1E3A5F", fontSize: 12,
            background: tab === "payables" ? "#1E3A5F" : "transparent",
            color: tab === "payables" ? "#E2E8F0" : "#4A6FA5", cursor: "pointer" }}
        >
          Top payables
        </button>
      </div>

      <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1E3A5F" }}>
              {(tab === "receivables"
                ? ["Customer", "Outstanding", "Overdue", "Invoices"]
                : ["Vendor", "Outstanding", "Overdue", "Bills"]
              ).map(h => (
                <th key={h} style={{ padding: "8px 14px", textAlign: "left", color: "#4A6FA5",
                  fontFamily: "monospace", fontWeight: 400, fontSize: 10, textTransform: "uppercase" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab === "receivables" ? (
              receivables.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#4A6FA5" }}>No outstanding receivables as of this date.</td></tr>
              ) : receivables.map((r) => (
                <tr key={r.customer_id} style={{ borderBottom: "1px solid #14233F" }}>
                  <td style={{ padding: "10px 14px", color: "#CBD5E1" }}>{r.customer_name}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#F59E0B" }}>{fmtINR(r.total_outstanding)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: r.total_overdue > 0 ? "#EF4444" : "#64748B" }}>{fmtINR(r.total_overdue)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#64748B" }}>{r.invoice_count}</td>
                </tr>
              ))
            ) : (
              payables.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#4A6FA5" }}>No outstanding payables as of this date.</td></tr>
              ) : payables.map((p) => (
                <tr key={p.vendor_id} style={{ borderBottom: "1px solid #14233F" }}>
                  <td style={{ padding: "10px 14px", color: "#CBD5E1" }}>{p.vendor_name}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#F59E0B" }}>{fmtINR(p.total_outstanding)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: p.total_overdue > 0 ? "#EF4444" : "#64748B" }}>{fmtINR(p.total_overdue)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#64748B" }}>{p.bill_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}