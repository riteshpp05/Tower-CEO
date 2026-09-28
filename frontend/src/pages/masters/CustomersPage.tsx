import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Customer } from "../../types/database";
import FormDrawer from "../../components/FormDrawer";
import { FormField, TextInput, SubmitButton, ErrorBanner } from "../../components/FormFields";
import DataTable from "../../components/DataTable";
import type { Column } from "../../components/DataTable";

const emptyForm: Partial<Customer> = {
  name: "",
  code: "",
  customer_group: "",
  account_manager: "",
  sales_owner: "",
  credit_days: 30,
  gstin: "",
  pan: "",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setCustomers(data as Customer[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDrawerOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setForm(c);
    setError(null);
    setDrawerOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      code: form.code || null,
      customer_group: form.customer_group || null,
      account_manager: form.account_manager || null,
      sales_owner: form.sales_owner || null,
      credit_days: form.credit_days ?? 30,
      gstin: form.gstin || null,
      pan: form.pan || null,
    };

    const result = editing
      ? await supabase.from("customers").update(payload).eq("id", editing.id)
      : await supabase.from("customers").insert(payload);

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setDrawerOpen(false);
    load();
  }

  async function toggleActive(c: Customer) {
    await supabase.from("customers").update({ is_active: !c.is_active }).eq("id", c.id);
    load();
  }

  const columns: Column<Customer>[] = [
    { header: "Name", render: (c) => (
      <div>
        <div className="text-ink-800">{c.name}</div>
        {c.code && <div className="text-ink-400 font-mono text-[10px]">{c.code}</div>}
      </div>
    )},
    { header: "Group", render: (c) => c.customer_group || "—" },
    { header: "Account Manager", render: (c) => c.account_manager || "—" },
    { header: "Credit Days", render: (c) => c.credit_days },
    { header: "Status", render: (c) => (
      <span
        onClick={(e) => { e.stopPropagation(); toggleActive(c); }}
        className={`cursor-pointer text-[10px] font-mono px-2 py-0.5 rounded ${
          c.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-terra-100 text-ink-500"
        }`}
      >
        {c.is_active ? "active" : "inactive"}
      </span>
    )},
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-medium m-0">Customer Master</h2>
          <p className="text-xs text-ink-400 mt-1">{customers.length} customers</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          + New customer
        </button>
      </div>

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={customers}
          onRowClick={openEdit}
          emptyMessage="No customers yet. Click 'New customer' to add the first one."
        />
      )}

      <FormDrawer
        open={drawerOpen}
        title={editing ? "Edit customer" : "New customer"}
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner message={error} />}

          <FormField label="Customer name *">
            <TextInput
              required
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Tata Steel"
            />
          </FormField>

          <FormField label="Internal code">
            <TextInput
              value={form.code || ""}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. CUST-001"
            />
          </FormField>

          <FormField label="Customer group">
            <TextInput
              value={form.customer_group || ""}
              onChange={(e) => setForm({ ...form, customer_group: e.target.value })}
              placeholder="e.g. Tata Group"
            />
          </FormField>

          <FormField label="Account manager">
            <TextInput
              value={form.account_manager || ""}
              onChange={(e) => setForm({ ...form, account_manager: e.target.value })}
            />
          </FormField>

          <FormField label="Sales owner">
            <TextInput
              value={form.sales_owner || ""}
              onChange={(e) => setForm({ ...form, sales_owner: e.target.value })}
            />
          </FormField>

          <FormField label="Credit days">
            <TextInput
              type="number"
              value={form.credit_days ?? 30}
              onChange={(e) => setForm({ ...form, credit_days: Number(e.target.value) })}
            />
          </FormField>

          <FormField label="GSTIN">
            <TextInput
              value={form.gstin || ""}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            />
          </FormField>

          <FormField label="PAN">
            <TextInput
              value={form.pan || ""}
              onChange={(e) => setForm({ ...form, pan: e.target.value })}
            />
          </FormField>

          <SubmitButton loading={saving}>
            {editing ? "Save changes" : "Create customer"}
          </SubmitButton>
        </form>
      </FormDrawer>
    </div>
  );
}
