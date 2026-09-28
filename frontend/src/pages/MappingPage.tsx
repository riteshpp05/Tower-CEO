import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface UnmappedEntity {
  zoho_id: string;
  zoho_name: string;
  invoice_count?: number;
  bill_count?: number;
  total_value: number;
}

interface Suggestion {
  customer_id?: string;
  vendor_id?: string;
  customer_name?: string;
  vendor_name?: string;
  similarity_score: number;
}

interface MasterRecord {
  id: string;
  name: string;
}

type Tab = "customers" | "vendors";

function fmtINR(n: number | null) {
  if (!n) return "₹0";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function MappingPage() {
  const [tab, setTab] = useState<Tab>("customers");
  const [unmapped, setUnmapped] = useState<UnmappedEntity[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [masterList, setMasterList] = useState<MasterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [manualSelect, setManualSelect] = useState<Record<string, string>>({});
  const [creatingNew, setCreatingNew] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function load() {
    setLoading(true);
    setError(null);

    const viewName = tab === "customers" ? "v_unmapped_zoho_customers" : "v_unmapped_zoho_vendors";
    const masterTable = tab === "customers" ? "customers" : "vendors";

    const [unmappedRes, masterRes] = await Promise.all([
      supabase.from(viewName).select("*").limit(100),
      supabase.from(masterTable).select("id, name").eq("is_active", true).order("name"),
    ]);

    if (unmappedRes.error) {
      setError(unmappedRes.error.message);
      setLoading(false);
      return;
    }

    setUnmapped(unmappedRes.data as UnmappedEntity[]);
    setMasterList((masterRes.data as MasterRecord[]) || []);

    // Fetch fuzzy suggestions for each unmapped entity
    const suggestionFn = tab === "customers" ? "suggest_customer_match" : "suggest_vendor_match";
    const suggestionMap: Record<string, Suggestion[]> = {};
    await Promise.all(
      (unmappedRes.data as UnmappedEntity[]).map(async (item) => {
        const { data } = await supabase.rpc(suggestionFn, { zoho_name: item.zoho_name });
        if (data) suggestionMap[item.zoho_id] = data as Suggestion[];
      })
    );
    setSuggestions(suggestionMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, [tab]);

  async function confirmMapping(zohoId: string, zohoName: string, masterId: string) {
    setSavingId(zohoId);

    const table = tab === "customers" ? "customer_source_mappings" : "vendor_source_mappings";
    const idColumn = tab === "customers" ? "customer_id" : "vendor_id";

    const { error } = await supabase.from(table).insert({
      [idColumn]: masterId,
      source_system: "zoho_books",
      source_id: zohoId,
      source_name: zohoName,
      confidence: 100,
    });

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    setUnmapped(prev => prev.filter(u => u.zoho_id !== zohoId));
    setSavingId(null);
  }

  async function createAndMap(zohoId: string, zohoName: string) {
    if (!newName.trim()) return;
    setSavingId(zohoId);

    const masterTable = tab === "customers" ? "customers" : "vendors";
    const { data: created, error: createErr } = await supabase
      .from(masterTable)
      .insert({ name: newName.trim() })
      .select()
      .single();

    if (createErr || !created) {
      setError(createErr?.message || "Failed to create record");
      setSavingId(null);
      return;
    }

    await confirmMapping(zohoId, zohoName, created.id);
    setCreatingNew(null);
    setNewName("");
    // Refresh master list so the new record appears in future dropdowns
    setMasterList(prev => [...prev, { id: created.id, name: created.name }]);
  }

  const label = tab === "customers" ? "customer" : "vendor";
  const countField = tab === "customers" ? "invoice_count" : "bill_count";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Mapping Workbench</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
          Match Zoho records to your internal master data
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setTab("customers")}
          style={{
            padding: "7px 16px", borderRadius: 20, border: "1px solid #1E3A5F", fontSize: 12,
            background: tab === "customers" ? "#1E3A5F" : "transparent",
            color: tab === "customers" ? "#E2E8F0" : "#4A6FA5", cursor: "pointer",
          }}
        >
          Customers
        </button>
        <button
          onClick={() => setTab("vendors")}
          style={{
            padding: "7px 16px", borderRadius: 20, border: "1px solid #1E3A5F", fontSize: 12,
            background: tab === "vendors" ? "#1E3A5F" : "transparent",
            color: tab === "vendors" ? "#E2E8F0" : "#4A6FA5", cursor: "pointer",
          }}
        >
          Vendors
        </button>
      </div>

      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#4A6FA5", fontSize: 13 }}>Loading unmapped {label}s…</div>
      ) : unmapped.length === 0 ? (
        <div style={{ background: "#0F1E35", border: "1px solid #0D9488", borderRadius: 10,
          padding: "24px", textAlign: "center", color: "#0D9488", fontSize: 13 }}>
          ✓ All {label}s are mapped. Nothing pending here.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#4A6FA5", marginBottom: 12 }}>
            {unmapped.length} unmapped {label}s · sorted by total value
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {unmapped.map((item) => {
              const itemSuggestions = suggestions[item.zoho_id] || [];
              const isCreating = creatingNew === item.zoho_id;

              return (
                <div key={item.zoho_id} style={{ background: "#0F1E35", border: "1px solid #1E3A5F",
                  borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 500 }}>{item.zoho_name}</div>
                      <div style={{ fontSize: 11, color: "#4A6FA5", marginTop: 2 }}>
                        {(item as any)[countField]} {tab === "customers" ? "invoices" : "bills"} · {fmtINR(item.total_value)} total
                      </div>
                    </div>
                  </div>

                  {itemSuggestions.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: "#6366F1", marginBottom: 6 }}>◆ Suggested matches</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {itemSuggestions.map((s) => {
                          const sId = tab === "customers" ? s.customer_id! : s.vendor_id!;
                          const sName = tab === "customers" ? s.customer_name! : s.vendor_name!;
                          return (
                            <button
                              key={sId}
                              disabled={savingId === item.zoho_id}
                              onClick={() => confirmMapping(item.zoho_id, item.zoho_name, sId)}
                              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 16, border: "1px solid #6366F1",
                                background: "#6366F122", color: "#A5B4FC", cursor: "pointer" }}
                            >
                              {sName} ({Math.round(s.similarity_score * 100)}%)
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isCreating ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={`New ${label} name`}
                        style={{ flex: 1, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                          padding: "6px 10px", color: "#E2E8F0", fontSize: 12, outline: "none" }}
                      />
                      <button
                        onClick={() => createAndMap(item.zoho_id, item.zoho_name)}
                        disabled={savingId === item.zoho_id || !newName.trim()}
                        style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "none",
                          background: "#0D9488", color: "white", cursor: "pointer" }}
                      >
                        Create &amp; map
                      </button>
                      <button
                        onClick={() => { setCreatingNew(null); setNewName(""); }}
                        style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "none",
                          background: "#1E3A5F", color: "#94A3B8", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <select
                        value={manualSelect[item.zoho_id] || ""}
                        onChange={(e) => setManualSelect(prev => ({ ...prev, [item.zoho_id]: e.target.value }))}
                        style={{ flex: 1, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 6,
                          padding: "6px 10px", color: "#E2E8F0", fontSize: 12, outline: "none" }}
                      >
                        <option value="">Search existing {label}s…</option>
                        {masterList.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <button
                        onClick={() => manualSelect[item.zoho_id] && confirmMapping(item.zoho_id, item.zoho_name, manualSelect[item.zoho_id])}
                        disabled={!manualSelect[item.zoho_id] || savingId === item.zoho_id}
                        style={{ fontSize: 11, padding: "6px 14px", borderRadius: 6, border: "none",
                          background: "#0D9488", color: "white", cursor: "pointer", opacity: !manualSelect[item.zoho_id] ? 0.4 : 1 }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setCreatingNew(item.zoho_id)}
                        style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "1px solid #1E3A5F",
                          background: "transparent", color: "#4A6FA5", cursor: "pointer" }}
                      >
                        + New
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
