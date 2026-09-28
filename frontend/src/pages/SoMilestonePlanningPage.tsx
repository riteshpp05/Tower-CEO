import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";

interface SoMilestoneRow {
  id: string;
  raw_so_id: string;
  zoho_salesorder_id: string;
  salesorder_number: string | null;
  customer_name: string;
  customer_id: string | null;
  order_date: string | null;
  shipment_date: string | null;
  zoho_line_item_id: string;
  description: string | null;
  item_total: number | null;
  currency_code: string | null;
  project_id: string | null;
  project_name: string | null;
  is_billed: boolean;
  expected_completion_month: string | null;
  updated_at: string;
  so_invoiced_status: string | null;
}

interface ProjectOption {
  project_id: string;
  customer_id: string;
  project_code: string;
  project_name: string;
  status: string;
}

function fmtINR(n: number | null) {
  if (!n) return "₹0";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

// Renders a date as "YYYY-MM" for the <input type="month"> control, and
// converts back to a real date (first of that month) on save -- the
// database stores a full date but only the month/year is ever meaningful
// for this field per the forecast design (expected_completion_month).
function dateToMonthInput(d: string | null): string {
  if (!d) return "";
  return d.slice(0, 7); // "2026-08-15" -> "2026-08"
}
function monthInputToDate(monthStr: string): string | null {
  if (!monthStr) return null;
  return `${monthStr}-01`;
}

export default function SoMilestonePlanningPage() {
  const [rows, setRows] = useState<SoMilestoneRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedSo, setExpandedSo] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [rowsRes, projRes] = await Promise.all([
      supabase.from("v_so_milestone_planning").select("*"),
      supabase.from("v_projects_by_customer").select("*"),
    ]);
    if (rowsRes.error) setError(rowsRes.error.message);
    else setRows((rowsRes.data as SoMilestoneRow[]) || []);
    setProjects((projRes.data as ProjectOption[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, { customer_name: string; so_number: string | null; rows: SoMilestoneRow[] }>();
    for (const r of rows) {
      const key = r.zoho_salesorder_id;
      if (!map.has(key)) {
        map.set(key, { customer_name: r.customer_name, so_number: r.salesorder_number, rows: [] });
      }
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.entries()).map(([so_id, v]) => ({
      so_id,
      customer_name: v.customer_name,
      so_number: v.so_number,
      rows: v.rows,
      totalValue: v.rows.reduce((s, r) => s + (r.item_total || 0), 0),
      unplannedCount: v.rows.filter(r => !r.is_billed && !r.expected_completion_month).length,
    })).sort((a, b) => b.unplannedCount - a.unplannedCount || b.totalValue - a.totalValue);
  }, [rows]);

  // Optimistic update: change local state immediately, then persist.
  // Reverts on failure so the UI never silently shows a value that
  // wasn't actually saved.
  async function updateRow(rowId: string, patch: Partial<Pick<SoMilestoneRow, "is_billed" | "expected_completion_month" | "project_id">>) {
    const previous = rows.find(r => r.id === rowId);
    if (!previous) return;

    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, ...patch } : r)));
    setSavingRowId(rowId);
    setError(null);

    const { error: updateError } = await supabase
      .from("so_line_items")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", rowId);

    if (updateError) {
      // Revert on failure -- never leave the UI showing an unsaved value.
      setRows(prev => prev.map(r => (r.id === rowId ? previous : r)));
      setError(`Failed to save: ${updateError.message}`);
    } else {
      setSuccess("Saved.");
      setTimeout(() => setSuccess(null), 2000);
    }
    setSavingRowId(null);
  }

  const totalLineItems = rows.length;
  const totalUnplanned = rows.filter(r => !r.is_billed && !r.expected_completion_month).length;
  const totalValue = rows.reduce((s, r) => s + (r.item_total || 0), 0);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>SO Milestone Planning</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
          Mark which sales order line items are billed and set an expected completion month for the rest —
          this feeds the revenue forecast for fixed-price / milestone work.
        </p>
      </div>

      {!loading && totalLineItems > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#E2E8F0" }}>{totalLineItems}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Unbilled line items</div>
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #F59E0B", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#F59E0B" }}>{totalUnplanned}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Needs a month set</div>
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#E2E8F0" }}>{fmtINR(totalValue)}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Total unbilled value</div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#0D948811", border: "1px solid #0D948844", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#5EEAD4", marginBottom: 16 }}>
          ✓ {success}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#4A6FA5", fontSize: 13 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div style={{ background: "#0F1E35", border: "1px solid #0D9488", borderRadius: 10,
          padding: "24px", textAlign: "center", color: "#0D9488", fontSize: 13 }}>
          ✓ No unbilled sales order line items need planning right now.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {grouped.map((group) => {
            const isExpanded = expandedSo === group.so_id;
            const customerProjects = group.rows[0]?.customer_id
              ? projects.filter(p => p.customer_id === group.rows[0].customer_id)
              : [];

            return (
              <div key={group.so_id} style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10 }}>
                <div
                  onClick={() => setExpandedSo(isExpanded ? null : group.so_id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}
                >
                  <span style={{ color: "#4A6FA5", fontSize: 11 }}>{isExpanded ? "▾" : "▸"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 500 }}>
                      {group.so_number || group.so_id} — {group.customer_name}
                    </div>
                    <div style={{ fontSize: 11, color: "#4A6FA5", marginTop: 2 }}>
                      {group.rows.length} line item(s) · {fmtINR(group.totalValue)}
                    </div>
                  </div>
                  {group.unplannedCount > 0 && (
                    <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4,
                      background: "#F59E0B22", color: "#FCD34D" }}>
                      {group.unplannedCount} need a month
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ borderTop: "1px solid #1E3A5F", padding: "12px 16px" }}>
                    {group.rows.map(row => (
                      <div key={row.id} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                        borderBottom: "1px solid #14233F", opacity: savingRowId === row.id ? 0.5 : 1,
                      }}>
                        <input
                          type="checkbox"
                          checked={row.is_billed}
                          onChange={(e) => updateRow(row.id, { is_billed: e.target.checked })}
                          title="Mark as billed"
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: "#CBD5E1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {row.description || row.zoho_line_item_id}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#94A3B8", width: 90, textAlign: "right" }}>
                          {fmtINR(row.item_total)}
                        </div>
                        <select
                          value={row.project_id || ""}
                          onChange={(e) => updateRow(row.id, { project_id: e.target.value || null })}
                          disabled={row.is_billed}
                          style={{
                            width: 160, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                            padding: "5px 8px", color: "#E2E8F0", fontSize: 11, outline: "none",
                          }}
                        >
                          <option value="">No project set</option>
                          {customerProjects.map(p => (
                            <option key={p.project_id} value={p.project_id}>{p.project_code}</option>
                          ))}
                        </select>
                        <input
                          type="month"
                          value={dateToMonthInput(row.expected_completion_month)}
                          onChange={(e) => updateRow(row.id, { expected_completion_month: monthInputToDate(e.target.value) })}
                          disabled={row.is_billed}
                          style={{
                            width: 130, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                            padding: "5px 8px", color: "#E2E8F0", fontSize: 11, outline: "none",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

