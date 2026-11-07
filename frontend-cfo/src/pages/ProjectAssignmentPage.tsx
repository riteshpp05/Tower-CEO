import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";

interface UnassignedInvoice {
  raw_invoice_id: string;
  zoho_invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total: number;
  balance: number;
  status: string | null;
  customer_id: string;
  customer_name: string;
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

export default function ProjectAssignmentPage() {
  const [invoices, setInvoices] = useState<UnassignedInvoice[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [projectChoice, setProjectChoice] = useState<Record<string, string>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectCode, setNewProjectCode] = useState("");
  const [assigning, setAssigning] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const [invRes, projRes] = await Promise.all([
      supabase.from("v_unassigned_invoices").select("*"),
      supabase.from("v_projects_by_customer").select("*"),
    ]);
    if (invRes.error) setError(invRes.error.message);
    else setInvoices((invRes.data as UnassignedInvoice[]) || []);
    setProjects((projRes.data as ProjectOption[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, { customer_name: string; invoices: UnassignedInvoice[] }>();
    for (const inv of invoices) {
      if (!map.has(inv.customer_id)) {
        map.set(inv.customer_id, { customer_name: inv.customer_name, invoices: [] });
      }
      map.get(inv.customer_id)!.invoices.push(inv);
    }
    return Array.from(map.entries()).map(([customer_id, v]) => ({
      customer_id,
      customer_name: v.customer_name,
      invoices: v.invoices,
      totalValue: v.invoices.reduce((s, i) => s + (i.total || 0), 0),
    })).sort((a, b) => b.totalValue - a.totalValue);
  }, [invoices]);

  function toggleInvoice(zohoId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(zohoId)) next.delete(zohoId);
      else next.add(zohoId);
      return next;
    });
  }

  function toggleAllForCustomer(invoiceIds: string[]) {
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = invoiceIds.every(id => next.has(id));
      invoiceIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }

  async function assignSelected(customerId: string, projectId: string) {
    const idsForCustomer = grouped.find(g => g.customer_id === customerId)?.invoices
      .filter(i => selected.has(i.zoho_invoice_id))
      .map(i => i.zoho_invoice_id) || [];

    if (idsForCustomer.length === 0) return;

    setAssigning(true);
    setError(null);
    const { data, error } = await supabase.rpc("assign_invoices_to_project", {
      p_zoho_invoice_ids: idsForCustomer,
      p_customer_id: customerId,
      p_project_id: projectId,
    });
    if (error) {
      setError(error.message);
      setAssigning(false);
      return;
    }
    setSuccess(`Assigned ${data} invoice(s).`);
    setInvoices(prev => prev.filter(i => !idsForCustomer.includes(i.zoho_invoice_id)));
    setSelected(prev => {
      const next = new Set(prev);
      idsForCustomer.forEach(id => next.delete(id));
      return next;
    });
    setAssigning(false);
    setTimeout(() => setSuccess(null), 4000);
  }

  async function createProjectAndAssign(customerId: string) {
    if (!newProjectName.trim() || !newProjectCode.trim()) return;
    setAssigning(true);
    setError(null);

    const { data: created, error: createErr } = await supabase
      .from("projects")
      .insert({
        project_code: newProjectCode.trim(),
        name: newProjectName.trim(),
        customer_id: customerId,
        status: "active",
        billing_type: "time_and_material",
      })
      .select()
      .single();

    if (createErr || !created) {
      setError(createErr?.message || "Failed to create project");
      setAssigning(false);
      return;
    }

    setProjects(prev => [...prev, {
      project_id: created.id, customer_id: customerId,
      project_code: created.project_code, project_name: created.name, status: created.status,
    }]);
    await assignSelected(customerId, created.id);
    setCreatingFor(null);
    setNewProjectName("");
    setNewProjectCode("");
  }

  const totalUnassigned = invoices.length;
  const totalValue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalSelected = selected.size;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Project Assignment</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
          Select invoices and assign them to a project — supports customers with multiple simultaneous projects
        </p>
      </div>

      {!loading && totalUnassigned > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#F59E0B" }}>{totalUnassigned}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Invoices unassigned</div>
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#F59E0B" }}>{fmtINR(totalValue)}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Total value</div>
          </div>
          <div style={{ background: "#0F1E35", border: "1px solid #6366F1", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#6366F1" }}>{totalSelected}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Currently selected</div>
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
          ✓ Every invoice is assigned to a project. Nothing pending here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {grouped.map((group) => {
            const isExpanded = expandedCustomer === group.customer_id;
            const customerProjects = projects.filter(p => p.customer_id === group.customer_id);
            const selectedCount = group.invoices.filter(i => selected.has(i.zoho_invoice_id)).length;
            const allChecked = group.invoices.every(i => selected.has(i.zoho_invoice_id));
            const isCreating = creatingFor === group.customer_id;

            return (
              <div key={group.customer_id} style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10 }}>
                <div
                  onClick={() => setExpandedCustomer(isExpanded ? null : group.customer_id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}
                >
                  <span style={{ color: "#4A6FA5", fontSize: 11 }}>{isExpanded ? "▾" : "▸"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 500 }}>{group.customer_name}</div>
                    <div style={{ fontSize: 11, color: "#4A6FA5", marginTop: 2 }}>
                      {group.invoices.length} invoices · {fmtINR(group.totalValue)}
                      {customerProjects.length > 1 && (
                        <span style={{ color: "#6366F1" }}> · {customerProjects.length} active projects</span>
                      )}
                    </div>
                  </div>
                  {selectedCount > 0 && (
                    <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4,
                      background: "#6366F122", color: "#A5B4FC" }}>
                      {selectedCount} selected
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ borderTop: "1px solid #1E3A5F", padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => toggleAllForCustomer(group.invoices.map(i => i.zoho_invoice_id))}
                      />
                      <span style={{ fontSize: 11, color: "#4A6FA5" }}>Select all {group.invoices.length} invoices</span>
                    </div>

                    <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
                      {group.invoices.map(inv => (
                        <div key={inv.zoho_invoice_id} style={{ display: "flex", alignItems: "center", gap: 10,
                          padding: "6px 0", borderBottom: "1px solid #14233F" }}>
                          <input
                            type="checkbox"
                            checked={selected.has(inv.zoho_invoice_id)}
                            onChange={() => toggleInvoice(inv.zoho_invoice_id)}
                          />
                          <div style={{ flex: 1, fontSize: 11, color: "#CBD5E1" }}>
                            {inv.invoice_number || inv.zoho_invoice_id}
                            <span style={{ color: "#4A6FA5", marginLeft: 8 }}>{inv.invoice_date}</span>
                          </div>
                          <div style={{ fontSize: 11, fontFamily: "monospace", color: "#94A3B8" }}>{fmtINR(inv.total)}</div>
                        </div>
                      ))}
                    </div>

                    {isCreating ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          autoFocus
                          value={newProjectCode}
                          onChange={(e) => setNewProjectCode(e.target.value)}
                          placeholder="Project code"
                          style={{ width: 120, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                            padding: "6px 10px", color: "#E2E8F0", fontSize: 12, outline: "none" }}
                        />
                        <input
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          placeholder="Project name"
                          style={{ flex: 1, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                            padding: "6px 10px", color: "#E2E8F0", fontSize: 12, outline: "none" }}
                        />
                        <button
                          onClick={() => createProjectAndAssign(group.customer_id)}
                          disabled={assigning || selectedCount === 0 || !newProjectName.trim() || !newProjectCode.trim()}
                          style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "none",
                            background: "#0D9488", color: "white", cursor: "pointer", whiteSpace: "nowrap",
                            opacity: selectedCount === 0 ? 0.4 : 1 }}
                        >
                          Create &amp; assign {selectedCount > 0 ? `(${selectedCount})` : ""}
                        </button>
                        <button
                          onClick={() => setCreatingFor(null)}
                          style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "none",
                            background: "#1E3A5F", color: "#94A3B8", cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6 }}>
                        <select
                          value={projectChoice[group.customer_id] || ""}
                          onChange={(e) => setProjectChoice(prev => ({ ...prev, [group.customer_id]: e.target.value }))}
                          style={{ flex: 1, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                            padding: "6px 10px", color: "#E2E8F0", fontSize: 12, outline: "none" }}
                        >
                          <option value="">
                            {customerProjects.length === 0 ? "No existing projects" : "Select project for checked invoices…"}
                          </option>
                          {customerProjects.map(p => (
                            <option key={p.project_id} value={p.project_id}>{p.project_code} — {p.project_name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => projectChoice[group.customer_id] && assignSelected(group.customer_id, projectChoice[group.customer_id])}
                          disabled={!projectChoice[group.customer_id] || selectedCount === 0 || assigning}
                          style={{ fontSize: 11, padding: "6px 14px", borderRadius: 6, border: "none",
                            background: "#0D9488", color: "white", cursor: "pointer", whiteSpace: "nowrap",
                            opacity: (!projectChoice[group.customer_id] || selectedCount === 0) ? 0.4 : 1 }}
                        >
                          Assign {selectedCount > 0 ? `${selectedCount} selected` : ""}
                        </button>
                        <button
                          onClick={() => setCreatingFor(group.customer_id)}
                          style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "1px solid #1E3A5F",
                            background: "transparent", color: "#4A6FA5", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          + New project
                        </button>
                      </div>
                    )}
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