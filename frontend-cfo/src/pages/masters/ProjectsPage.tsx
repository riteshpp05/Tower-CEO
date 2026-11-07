import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { ProjectRow, Customer, LineOfBusiness, SalesEngine } from "../../types/database";
import FormDrawer from "../../components/FormDrawer";
import { FormField, TextInput, Select, SubmitButton, ErrorBanner } from "../../components/FormFields";
import DataTable from "../../components/DataTable";
import type { Column } from "../../components/DataTable";

const emptyForm: Partial<ProjectRow> = {
  project_code: "",
  name: "",
  customer_id: "",
  lob_id: "",
  sales_engine_id: "",
  billing_type: "time_and_material",
  contract_value: null,
  margin_threshold: 20,
  status: "active",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lobs, setLobs] = useState<LineOfBusiness[]>([]);
  const [engines, setEngines] = useState<SalesEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [form, setForm] = useState<Partial<ProjectRow>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [projectsRes, customersRes, lobsRes, enginesRes] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("lines_of_business").select("id, code, name").order("name"),
      supabase.from("sales_engines").select("id, code, name").order("name"),
    ]);

    if (projectsRes.error) {
      setError(projectsRes.error.message);
    } else {
      const customerMap = new Map((customersRes.data || []).map((c: any) => [c.id, c.name]));
      const withNames = (projectsRes.data as ProjectRow[]).map((p) => ({
        ...p,
        customer_name: customerMap.get(p.customer_id) || "Unknown",
      }));
      setProjects(withNames);
    }
    setCustomers((customersRes.data as Customer[]) || []);
    setLobs((lobsRes.data as LineOfBusiness[]) || []);
    setEngines((enginesRes.data as SalesEngine[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDrawerOpen(true);
  }

  function openEdit(p: ProjectRow) {
    setEditing(p);
    setForm(p);
    setError(null);
    setDrawerOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!form.customer_id) {
      setError("Please select a customer.");
      setSaving(false);
      return;
    }

    const payload = {
      project_code: form.project_code,
      name: form.name,
      customer_id: form.customer_id,
      lob_id: form.lob_id || null,
      sales_engine_id: form.sales_engine_id || null,
      billing_type: form.billing_type || null,
      contract_value: form.contract_value || null,
      margin_threshold: form.margin_threshold ?? 20,
      status: form.status || "active",
    };

    const result = editing
      ? await supabase.from("projects").update(payload).eq("id", editing.id)
      : await supabase.from("projects").insert(payload);

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setDrawerOpen(false);
    load();
  }

  const statusColor: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-400",
    pipeline: "bg-indigo-500/20 text-indigo-400",
    on_hold: "bg-amber-500/20 text-amber-400",
    closed: "bg-terra-100 text-ink-500",
    cancelled: "bg-red-500/20 text-red-400",
  };

  const columns: Column<ProjectRow>[] = [
    { header: "Project", render: (p) => (
      <div>
        <div className="text-ink-800">{p.name}</div>
        <div className="text-ink-400 font-mono text-[10px]">{p.project_code}</div>
      </div>
    )},
    { header: "Customer", render: (p) => p.customer_name },
    { header: "Billing type", render: (p) => p.billing_type?.replace(/_/g, " ") || "—" },
    { header: "Contract value", render: (p) => p.contract_value ? `₹${(p.contract_value / 100000).toFixed(1)}L` : "—" },
    { header: "Margin floor", render: (p) => `${p.margin_threshold}%` },
    { header: "Status", render: (p) => (
      <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${statusColor[p.status] || "bg-terra-100 text-ink-500"}`}>
        {p.status}
      </span>
    )},
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-medium m-0">Project Master</h2>
          <p className="text-xs text-ink-400 mt-1">{projects.length} projects</p>
        </div>
        <button
          onClick={openCreate}
          disabled={customers.length === 0}
          className="bg-terra-600 hover:bg-terra-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          + New project
        </button>
      </div>

      {!loading && customers.length === 0 && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-3 mb-4 text-xs text-amber-300">
          You need at least one customer before creating a project. Add one in Customer Master first.
        </div>
      )}

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={projects}
          onRowClick={openEdit}
          emptyMessage="No projects yet. Click 'New project' to add the first one."
        />
      )}

      <FormDrawer
        open={drawerOpen}
        title={editing ? "Edit project" : "New project"}
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner message={error} />}

          <FormField label="Project code *">
            <TextInput
              required
              value={form.project_code || ""}
              onChange={(e) => setForm({ ...form, project_code: e.target.value })}
              placeholder="e.g. AIS-2026-001"
            />
          </FormField>

          <FormField label="Project name *">
            <TextInput
              required
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. SAP S/4 Migration"
            />
          </FormField>

          <FormField label="Customer *">
            <Select
              required
              value={form.customer_id || ""}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="Line of business">
            <Select
              value={form.lob_id || ""}
              onChange={(e) => setForm({ ...form, lob_id: e.target.value })}
            >
              <option value="">Select LOB…</option>
              {lobs.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="Sales engine">
            <Select
              value={form.sales_engine_id || ""}
              onChange={(e) => setForm({ ...form, sales_engine_id: e.target.value })}
            >
              <option value="">Select sales engine…</option>
              {engines.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="Billing type">
            <Select
              value={form.billing_type || "time_and_material"}
              onChange={(e) => setForm({ ...form, billing_type: e.target.value as ProjectRow["billing_type"] })}
            >
              <option value="time_and_material">Time & material</option>
              <option value="fixed_price">Fixed price</option>
              <option value="retainer">Retainer</option>
              <option value="milestone">Milestone</option>
            </Select>
          </FormField>

          <FormField label="Contract value (₹)">
            <TextInput
              type="number"
              value={form.contract_value ?? ""}
              onChange={(e) => setForm({ ...form, contract_value: e.target.value ? Number(e.target.value) : null })}
            />
          </FormField>

          <FormField label="Margin alert threshold (%)">
            <TextInput
              type="number"
              value={form.margin_threshold ?? 20}
              onChange={(e) => setForm({ ...form, margin_threshold: Number(e.target.value) })}
            />
          </FormField>

          <FormField label="Status">
            <Select
              value={form.status || "active"}
              onChange={(e) => setForm({ ...form, status: e.target.value as ProjectRow["status"] })}
            >
              <option value="pipeline">Pipeline</option>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </FormField>

          <SubmitButton loading={saving}>
            {editing ? "Save changes" : "Create project"}
          </SubmitButton>
        </form>
      </FormDrawer>
    </div>
  );
}
