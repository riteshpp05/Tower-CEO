import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { EmployeeRow } from "../../types/database";
import FormDrawer from "../../components/FormDrawer";
import { FormField, TextInput, Select, SubmitButton, ErrorBanner } from "../../components/FormFields";
import DataTable from "../../components/DataTable";
import type { Column } from "../../components/DataTable";

const emptyForm: Partial<EmployeeRow> = {
  employee_code: "",
  full_name: "",
  email: "",
  department: "",
  designation: "",
  role: "",
  is_billable: true,
  cost_rate_monthly: null,
  joining_date: "",
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState<Partial<EmployeeRow>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setEmployees(data as EmployeeRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDrawerOpen(true);
  }

  function openEdit(e: EmployeeRow) {
    setEditing(e);
    setForm(e);
    setError(null);
    setDrawerOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      employee_code: form.employee_code,
      full_name: form.full_name,
      email: form.email || null,
      department: form.department || null,
      designation: form.designation || null,
      role: form.role || null,
      is_billable: form.is_billable ?? true,
      cost_rate_monthly: form.cost_rate_monthly || null,
      joining_date: form.joining_date || null,
    };

    const result = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setDrawerOpen(false);
    load();
  }

  async function toggleActive(emp: EmployeeRow) {
    await supabase.from("employees").update({ is_active: !emp.is_active }).eq("id", emp.id);
    load();
  }

  const columns: Column<EmployeeRow>[] = [
    { header: "Name", render: (e) => (
      <div>
        <div className="text-ink-800">{e.full_name}</div>
        <div className="text-ink-400 font-mono text-[10px]">{e.employee_code}</div>
      </div>
    )},
    { header: "Designation", render: (e) => e.designation || "—" },
    { header: "Department", render: (e) => e.department || "—" },
    { header: "Cost / mo", render: (e) => e.cost_rate_monthly ? `₹${e.cost_rate_monthly.toLocaleString("en-IN")}` : "—" },
    { header: "Cost / hr", render: (e) => e.cost_rate_hourly ? `₹${e.cost_rate_hourly.toFixed(0)}` : "—" },
    { header: "Billable", render: (e) => (
      <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
        e.is_billable ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
      }`}>
        {e.is_billable ? "billable" : "bench"}
      </span>
    )},
    { header: "Status", render: (e) => (
      <span
        onClick={(ev) => { ev.stopPropagation(); toggleActive(e); }}
        className={`cursor-pointer text-[10px] font-mono px-2 py-0.5 rounded ${
          e.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-terra-100 text-ink-500"
        }`}
      >
        {e.is_active ? "active" : "inactive"}
      </span>
    )},
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-medium m-0">Employee Master</h2>
          <p className="text-xs text-ink-400 mt-1">{employees.length} employees</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          + New employee
        </button>
      </div>

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={employees}
          onRowClick={openEdit}
          emptyMessage="No employees yet. Click 'New employee' to add the first one."
        />
      )}

      <FormDrawer
        open={drawerOpen}
        title={editing ? "Edit employee" : "New employee"}
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner message={error} />}

          <FormField label="Employee code *">
            <TextInput
              required
              value={form.employee_code || ""}
              onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
              placeholder="e.g. AIS-EMP-001"
            />
          </FormField>

          <FormField label="Full name *">
            <TextInput
              required
              value={form.full_name || ""}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </FormField>

          <FormField label="Email">
            <TextInput
              type="email"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormField>

          <FormField label="Designation">
            <TextInput
              value={form.designation || ""}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
              placeholder="e.g. SAP Consultant"
            />
          </FormField>

          <FormField label="Department">
            <TextInput
              value={form.department || ""}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </FormField>

          <FormField label="Billable status">
            <Select
              value={form.is_billable ? "yes" : "no"}
              onChange={(e) => setForm({ ...form, is_billable: e.target.value === "yes" })}
            >
              <option value="yes">Billable</option>
              <option value="no">Bench / non-billable</option>
            </Select>
          </FormField>

          <FormField label="Monthly cost rate (₹)">
            <TextInput
              type="number"
              value={form.cost_rate_monthly ?? ""}
              onChange={(e) => setForm({ ...form, cost_rate_monthly: e.target.value ? Number(e.target.value) : null })}
              placeholder="Fully loaded monthly cost"
            />
          </FormField>

          <FormField label="Joining date">
            <TextInput
              type="date"
              value={form.joining_date || ""}
              onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
            />
          </FormField>

          <SubmitButton loading={saving}>
            {editing ? "Save changes" : "Create employee"}
          </SubmitButton>
        </form>
      </FormDrawer>
    </div>
  );
}
