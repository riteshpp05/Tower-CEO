import { useEffect, useState, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";

interface DepositRow { source_name: string; payment_date: string; amount: number; reference_number: string | null; source_type: string; }
interface WithdrawalRow { source_name: string; payment_date: string; amount: number; reference_number: string | null; source_type: string; }
interface OtherFlowRow { source_name: string; payment_date: string; amount: number; transaction_type: string; }
interface OverdueReceivableNet { customer_name: string; approximate_date: string | null; gross_amount: number; tds_percentage: number; tds_amount: number; net_amount: number; }
interface OverduePayableNet { vendor_name: string; approximate_date: string | null; gross_amount: number; tds_percentage: number; tds_amount: number; net_amount: number; }
interface ExpectedPaymentRow { id: string; label: string; amount: number | null; sort_order: number; }
interface OpeningBalanceEntry { opening_balance: number | null; }

function fmtINR(n: number | null | undefined) {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function getWeekRange(anchor: Date) {
  const start = new Date(anchor);
  const end = new Date(anchor);
  end.setDate(start.getDate() + 6);
  return { start: toISO(start), end: toISO(end) };
}

export default function CashFlowDashboard() {
  const [anchor, setAnchor] = useState(new Date());
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState(toISO(new Date()));
  const [customEnd, setCustomEnd] = useState(toISO(new Date()));

  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [otherDeposits, setOtherDeposits] = useState<OtherFlowRow[]>([]);
  const [otherWithdrawals, setOtherWithdrawals] = useState<OtherFlowRow[]>([]);
  const [overdueReceivables, setOverdueReceivables] = useState<OverdueReceivableNet[]>([]);
  const [overduePayables, setOverduePayables] = useState<OverduePayableNet[]>([]);
  const [openingBalance, setOpeningBalance] = useState<number | null>(null);
  const [expectedPayments, setExpectedPayments] = useState<ExpectedPaymentRow[]>([]);
  const [newRowLabel, setNewRowLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const range = customMode ? { start: customStart, end: customEnd } : getWeekRange(anchor);

  const loadOpeningBalance = useCallback(async (start: string, end: string) => {
    const { data } = await supabase
      .from("cash_flow_manual_entries")
      .select("opening_balance")
      .eq("period_start", start)
      .eq("period_end", end)
      .maybeSingle();
    setOpeningBalance((data as OpeningBalanceEntry | null)?.opening_balance ?? null);
  }, []);

  const loadExpectedPayments = useCallback(async (start: string, end: string) => {
    const { data } = await supabase
      .from("cash_flow_expected_payments")
      .select("*")
      .eq("period_start", start)
      .eq("period_end", end)
      .order("sort_order");
    setExpectedPayments((data as ExpectedPaymentRow[]) || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { start, end } = range;

    const [depRes, witRes, recRes, payRes, otherDepRes, otherWitRes] = await Promise.all([
      supabase.rpc("get_period_deposits", { p_start_date: start, p_end_date: end }),
      supabase.rpc("get_period_withdrawals", { p_start_date: start, p_end_date: end }),
      supabase.rpc("get_receivable_overdue_list_net", { p_as_on_date: end, p_limit: 50 }),
      supabase.rpc("get_payable_overdue_list_net", { p_as_on_date: end, p_limit: 50 }),
      supabase.rpc("get_period_other_deposits", { p_start_date: start, p_end_date: end }),
      supabase.rpc("get_period_other_withdrawals", { p_start_date: start, p_end_date: end }),
    ]);

    const errors = [depRes, witRes, recRes, payRes, otherDepRes, otherWitRes]
      .map(r => r.error)
      .filter(Boolean);
    if (errors.length > 0) {
      setError(errors.map(e => e!.message).join(" | "));
      console.error("[CashFlowDashboard] RPC errors:", errors);
    }
    setDeposits((depRes.data as DepositRow[]) || []);
    setWithdrawals((witRes.data as WithdrawalRow[]) || []);
    setOverdueReceivables((recRes.data as OverdueReceivableNet[]) || []);
    setOverduePayables((payRes.data as OverduePayableNet[]) || []);
    setOtherDeposits((otherDepRes.data as OtherFlowRow[]) || []);
    setOtherWithdrawals((otherWitRes.data as OtherFlowRow[]) || []);
    await loadOpeningBalance(start, end);
    await loadExpectedPayments(start, end);
    setLoading(false);
  }, [range.start, range.end, loadOpeningBalance, loadExpectedPayments]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveOpeningBalance(value: string) {
    const num = value === "" ? null : Number(value);
    setOpeningBalance(num);
    setSaving(true);
    await supabase.from("cash_flow_manual_entries").upsert({
      period_start: range.start,
      period_end: range.end,
      opening_balance: num,
      updated_at: new Date().toISOString(),
    }, { onConflict: "period_start,period_end" });
    setSaving(false);
  }

  async function addExpectedPaymentRow() {
    if (!newRowLabel.trim()) return;
    setSaving(true);
    const { data } = await supabase.from("cash_flow_expected_payments").insert({
      period_start: range.start,
      period_end: range.end,
      label: newRowLabel.trim(),
      amount: null,
      sort_order: expectedPayments.length,
    }).select().single();
    if (data) setExpectedPayments(prev => [...prev, data as ExpectedPaymentRow]);
    setNewRowLabel("");
    setSaving(false);
  }

  async function updateExpectedPaymentAmount(id: string, value: string) {
    const num = value === "" ? null : Number(value);
    setExpectedPayments(prev => prev.map(p => p.id === id ? { ...p, amount: num } : p));
    setSaving(true);
    await supabase.from("cash_flow_expected_payments").update({ amount: num }).eq("id", id);
    setSaving(false);
  }

  async function removeExpectedPaymentRow(id: string) {
    setExpectedPayments(prev => prev.filter(p => p.id !== id));
    await supabase.from("cash_flow_expected_payments").delete().eq("id", id);
  }

  function goToPreviousWeek() { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d); setCustomMode(false); }
  function goToNextWeek() { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d); setCustomMode(false); }
  function goToThisWeek() { setAnchor(new Date()); setCustomMode(false); }

  // FIX 1 & 2: totalDeposits and totalWithdrawals now include other deposits/withdrawals
  // so that closingBalance reflects ALL cash movements, not just customer/vendor payments.
  // Previously, other deposits/withdrawals were displayed on screen but silently excluded
  // from the closing balance math.
  const totalDeposits = deposits.reduce((s, d) => s + d.amount, 0) + otherDeposits.reduce((s, d) => s + d.amount, 0);
  const totalWithdrawals = withdrawals.reduce((s, w) => s + w.amount, 0) + otherWithdrawals.reduce((s, w) => s + w.amount, 0);
  const closingBalance = (openingBalance || 0) + totalDeposits - totalWithdrawals;

  const totalReceivableGross = overdueReceivables.reduce((s, r) => s + r.gross_amount, 0);
  const totalReceivableNet = overdueReceivables.reduce((s, r) => s + r.net_amount, 0);
  const totalPayableGross = overduePayables.reduce((s, p) => s + p.gross_amount, 0);
  const totalPayableNet = overduePayables.reduce((s, p) => s + p.net_amount, 0);

  const weInBank = closingBalance;
  const invoicedReceivableNet = totalReceivableNet;
  const expectedCashBalance = weInBank + invoicedReceivableNet;
  const totalExpectedPayments = expectedPayments.reduce((s, p) => s + (p.amount || 0), 0);

  // FIX 3: surplusDeficit now subtracts overdue payables (money we owe but haven't paid yet).
  // Previously these were shown in col 2 but not factored into the surplus/deficit calculation,
  // making the projection misleadingly optimistic.
  const surplusDeficit = expectedCashBalance - totalExpectedPayments - totalPayableNet;

  const inputStyle: CSSProperties = {
    background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
    padding: "5px 9px", color: "#E2E8F0", fontSize: 12, outline: "none", width: 110,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Cash Flow Dashboard</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
            {range.start} to {range.end} {saving && <span style={{ color: "#6366F1" }}>· saving…</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!customMode && (
            <>
              <button onClick={goToPreviousWeek} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>← Prev week</button>
              <button onClick={goToThisWeek} style={{ ...inputStyle, width: "auto", cursor: "pointer", background: "#1E3A5F" }}>This week</button>
              <button onClick={goToNextWeek} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>Next week →</button>
            </>
          )}
          <button onClick={() => setCustomMode(!customMode)}
            style={{ ...inputStyle, width: "auto", cursor: "pointer", background: customMode ? "#1E3A5F" : "transparent" }}>
            Custom
          </button>
          {customMode && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={inputStyle} />
              <span style={{ color: "#4A6FA5", fontSize: 11 }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={inputStyle} />
            </>
          )}
        </div>
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
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 1fr", gap: 16 }}>

          <div>
            <SectionLabel>Cash flow this period</SectionLabel>
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
              <Row label="Opening balance" editable value={openingBalance} onSave={saveOpeningBalance} />
              <SectionDivider />
              <div style={{ fontSize: 11, color: "#0D9488", marginBottom: 6, fontWeight: 500 }}>Deposits</div>
              {deposits.filter(d => d.source_type === "customer_payment").length === 0 ? (
                <div style={{ fontSize: 11, color: "#4A6FA5", marginBottom: 8 }}>No customer payments this period.</div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 8 }}>
                  {deposits.filter(d => d.source_type === "customer_payment").map((d, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0", color: "#94A3B8" }}>
                      <span>{d.source_name || "(no name)"}</span>
                      <span style={{ fontFamily: "monospace", color: "#0D9488" }}>{fmtINR(d.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {otherDeposits.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: "#0D9488", marginBottom: 6, fontWeight: 500, marginTop: 4 }}>
                    Other Deposits / Incomes
                  </div>
                  <div style={{ maxHeight: 120, overflowY: "auto", marginBottom: 4 }}>
                    {otherDeposits.map((d, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748B", padding: "2px 0" }}>
                        <span>{d.source_name}</span>
                        <span style={{ fontFamily: "monospace", color: "#0D9488" }}>{fmtINR(d.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#4A6FA5", marginBottom: 4 }}>
                    Subtotal: {fmtINR(otherDeposits.reduce((s, d) => s + d.amount, 0))}
                  </div>
                </>
              )}

              <TotalRow label="Total Deposits" value={totalDeposits} color="#0D9488" />
              <SectionDivider />
              <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 6, fontWeight: 500 }}>Withdrawal</div>
              {withdrawals.filter(w => w.source_type === "vendor_payment").length === 0 ? (
                <div style={{ fontSize: 11, color: "#4A6FA5", marginBottom: 8 }}>No vendor payments this period.</div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 8 }}>
                  {withdrawals.filter(w => w.source_type === "vendor_payment").map((w, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0", color: "#94A3B8" }}>
                      <span>{w.source_name || "(no name)"}</span>
                      <span style={{ fontFamily: "monospace", color: "#EF4444" }}>{fmtINR(w.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {otherWithdrawals.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: "#EF4444", marginBottom: 6, fontWeight: 500, marginTop: 4 }}>
                    Other Withdrawals / Expenses
                  </div>
                  <div style={{ maxHeight: 120, overflowY: "auto", marginBottom: 4 }}>
                    {otherWithdrawals.map((w, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748B", padding: "2px 0" }}>
                        <span>{w.source_name}</span>
                        <span style={{ fontFamily: "monospace", color: "#EF4444" }}>{fmtINR(w.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#4A6FA5", marginBottom: 4 }}>
                    Subtotal: {fmtINR(otherWithdrawals.reduce((s, w) => s + w.amount, 0))}
                  </div>
                </>
              )}

              <TotalRow label="Total Withdrawal" value={totalWithdrawals} color="#EF4444" />
              <SectionDivider />
              <TotalRow label="Closing balance" value={closingBalance} color="#E2E8F0" bold />
            </div>
          </div>

          <div>
            <SectionLabel>Overdue as of {range.end} · net of TDS</SectionLabel>
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#F59E0B", marginBottom: 8, fontWeight: 500 }}>Receivable Overdue List</div>
              {overdueReceivables.length === 0 ? (
                <div style={{ fontSize: 11, color: "#4A6FA5", marginBottom: 8 }}>No overdue receivables.</div>
              ) : (
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr auto", gap: 6, fontSize: 10, color: "#4A6FA5", marginBottom: 4 }}>
                    <span>Customer</span><span>Net</span>
                  </div>
                  {overdueReceivables.map((r, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr auto", gap: 6, fontSize: 11, padding: "3px 0", color: "#94A3B8" }}>
                      <span>{r.customer_name}</span>
                      <span style={{ fontFamily: "monospace", color: "#F59E0B", textAlign: "right" }}>{fmtINR(r.net_amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 6 }}>Gross: {fmtINR(totalReceivableGross)}</div>
              <TotalRow label="Total (net of TDS)" value={totalReceivableNet} color="#F59E0B" />
            </div>
            <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 8, fontWeight: 500 }}>Overdue Pending Payment</div>
              {overduePayables.length === 0 ? (
                <div style={{ fontSize: 11, color: "#4A6FA5", marginBottom: 8 }}>No overdue payables.</div>
              ) : (
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr auto", gap: 6, fontSize: 10, color: "#4A6FA5", marginBottom: 4 }}>
                    <span>Vendor</span><span>Net</span>
                  </div>
                  {overduePayables.map((p, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr auto", gap: 6, fontSize: 11, padding: "3px 0", color: "#94A3B8" }}>
                      <span>{p.vendor_name}</span>
                      <span style={{ fontFamily: "monospace", color: "#EF4444", textAlign: "right" }}>{fmtINR(p.net_amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 6 }}>Gross: {fmtINR(totalPayableGross)}</div>
              <TotalRow label="Total (net of TDS)" value={totalPayableNet} color="#EF4444" />
            </div>
          </div>

          <div>
            <SectionLabel>Projection — 1 month forward</SectionLabel>
            <div style={{ background: "#0F1E35", border: "1px solid #6366F1", borderRadius: 10, padding: "14px 16px" }}>
              <TotalRow label="We have in Bank" value={weInBank} color="#94A3B8" />
              <TotalRow label="Invoiced &amp; Receivable (net)" value={invoicedReceivableNet} color="#94A3B8" />
              <SectionDivider />
              <TotalRow label="Expected Cash Balance" value={expectedCashBalance} color="#6366F1" bold />
              <SectionDivider />
              <div style={{ fontSize: 11, color: "#F59E0B", marginBottom: 6, fontWeight: 500, marginTop: 10 }}>Expected Payments</div>
              {expectedPayments.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#94A3B8", flex: 1 }}>{p.label}</span>
                  <input
                    type="number"
                    defaultValue={p.amount ?? ""}
                    placeholder="0"
                    onBlur={e => updateExpectedPaymentAmount(p.id, e.target.value)}
                    style={{ background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6, padding: "4px 8px",
                      color: "#E2E8F0", fontSize: 12, outline: "none", width: 95, textAlign: "right" }}
                  />
                  <button onClick={() => removeExpectedPaymentRow(p.id)}
                    style={{ background: "transparent", border: "none", color: "#4A6FA5", cursor: "pointer", fontSize: 14, padding: "0 2px" }}>
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  value={newRowLabel}
                  onChange={e => setNewRowLabel(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addExpectedPaymentRow()}
                  placeholder="+ Add row (e.g. Insurance)"
                  style={{ flex: 1, background: "#080F1C", border: "1px dashed #1E3A5F", borderRadius: 6,
                    padding: "5px 9px", color: "#E2E8F0", fontSize: 11, outline: "none" }}
                />
                <button onClick={addExpectedPaymentRow}
                  style={{ background: "#1E3A5F", border: "none", borderRadius: 6, padding: "5px 12px",
                    color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>
                  Add
                </button>
              </div>
              <TotalRow label="Total Expected Payments" value={totalExpectedPayments} color="#F59E0B" />
              <SectionDivider />
              <TotalRow label="Overdue Pending Payment (net)" value={totalPayableNet} color="#EF4444" />
              <SectionDivider />
              <TotalRow label="Surplus / Deficit" value={surplusDeficit} color={surplusDeficit >= 0 ? "#0D9488" : "#EF4444"} bold />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontFamily: "monospace", letterSpacing: 1, color: "#4A6FA5",
      marginBottom: 10, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Row({ label, value, editable, onSave }: { label: string; value: number | null; editable?: boolean; onSave?: (v: string) => void }) {
  const [local, setLocal] = useState(value?.toString() ?? "");
  useEffect(() => { setLocal(value?.toString() ?? ""); }, [value]);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: "#94A3B8" }}>{label}</span>
      {editable ? (
        <input
          type="number"
          value={local}
          placeholder="0"
          onChange={e => setLocal(e.target.value)}
          onBlur={e => onSave?.(e.target.value)}
          style={{ background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6, padding: "4px 8px",
            color: "#E2E8F0", fontSize: 12, outline: "none", width: 110, textAlign: "right" }}
        />
      ) : (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#E2E8F0" }}>{fmtINR(value)}</span>
      )}
    </div>
  );
}

function TotalRow({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #1E3A5F", marginTop: 4 }}>
      <span style={{ fontSize: 12, color: bold ? "#E2E8F0" : "#94A3B8", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: bold ? 14 : 12, color, fontWeight: bold ? 700 : 400 }}>{fmtINR(value)}</span>
    </div>
  );
}

function SectionDivider() {
  return <div style={{ height: 1, background: "#1E3A5F", margin: "10px 0" }} />;
}