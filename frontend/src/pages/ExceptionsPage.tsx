import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface DataException {
  id: string;
  exception_code: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  module: string | null;
  status: "open" | "resolved" | "suppressed";
  detected_at: string;
}

const severityMeta: Record<string, { color: string; label: string }> = {
  critical: { color: "#EF4444", label: "Critical" },
  high:     { color: "#F59E0B", label: "High" },
  medium:   { color: "#6366F1", label: "Medium" },
  low:      { color: "#64748B", label: "Low" },
};

export default function ExceptionsPage() {
  const [exceptions, setExceptions] = useState<DataException[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("data_exceptions")
      .select("*")
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("detected_at", { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    else setExceptions((data as DataException[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runDetection() {
    setRunning(true);
    setError(null);
    const { data, error } = await supabase.rpc("run_exception_detection");
    if (error) {
      setError(error.message);
      setRunning(false);
      return;
    }
    const totalNew = (data || []).reduce((sum: number, row: any) => sum + (row.new_count || 0), 0);
    setLastRunSummary(
      totalNew > 0
        ? `Found ${totalNew} new exception${totalNew === 1 ? "" : "s"}.`
        : "No new exceptions found. Existing ones reviewed for auto-resolution."
    );
    await load();
    setRunning(false);
  }

  const filtered = exceptions.filter(e =>
    (severityFilter === "all" || e.severity === severityFilter) &&
    (moduleFilter === "all" || e.module === moduleFilter)
  );

  const counts = {
    critical: exceptions.filter(e => e.severity === "critical").length,
    high: exceptions.filter(e => e.severity === "high").length,
    medium: exceptions.filter(e => e.severity === "medium").length,
    low: exceptions.filter(e => e.severity === "low").length,
  };

  const modules = Array.from(new Set(exceptions.map(e => e.module).filter(Boolean))) as string[];

  async function resolveException(id: string) {
    await supabase.from("data_exceptions").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolution_note: "Manually resolved",
    }).eq("id", id);
    setExceptions(prev => prev.filter(e => e.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Data Exceptions</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
            Validation failures detected across synced data
          </p>
        </div>
        <button
          onClick={runDetection}
          disabled={running}
          style={{ background: "#0D9488", border: "none", borderRadius: 8, padding: "9px 18px",
            color: "white", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: running ? 0.6 : 1, whiteSpace: "nowrap" }}
        >
          {running ? "Running…" : "↻ Run detection now"}
        </button>
      </div>

      {lastRunSummary && (
        <div style={{ background: "#0D948811", border: "1px solid #0D948844", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#5EEAD4", marginBottom: 16 }}>
          {lastRunSummary}
        </div>
      )}
      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {(["critical","high","medium","low"] as const).map(sev => (
          <div
            key={sev}
            onClick={() => setSeverityFilter(severityFilter === sev ? "all" : sev)}
            style={{ background: "#0F1E35", border: `1px solid ${severityFilter === sev ? severityMeta[sev].color : "#1E3A5F"}`,
              borderRadius: 10, padding: "14px 16px", cursor: "pointer" }}
          >
            <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 700, color: severityMeta[sev].color }}>
              {counts[sev]}
            </div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>{severityMeta[sev].label}</div>
          </div>
        ))}
      </div>

      {modules.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={() => setModuleFilter("all")}
            style={{ fontSize: 11, padding: "5px 12px", borderRadius: 16, border: "1px solid #1E3A5F",
              background: moduleFilter === "all" ? "#1E3A5F" : "transparent",
              color: moduleFilter === "all" ? "#E2E8F0" : "#4A6FA5", cursor: "pointer" }}
          >
            All modules
          </button>
          {modules.map(m => (
            <button
              key={m}
              onClick={() => setModuleFilter(m)}
              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 16, border: "1px solid #1E3A5F",
                background: moduleFilter === m ? "#1E3A5F" : "transparent",
                color: moduleFilter === m ? "#E2E8F0" : "#4A6FA5", cursor: "pointer", textTransform: "capitalize" }}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#4A6FA5", fontSize: 13 }}>Loading exceptions…</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "#0F1E35", border: "1px solid #0D9488", borderRadius: 10,
          padding: "24px", textAlign: "center", color: "#0D9488", fontSize: 13 }}>
          {exceptions.length === 0
            ? "No exceptions detected yet. Click \"Run detection now\" to scan your synced data."
            : "No exceptions match the current filter."}
        </div>
      ) : (
        <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, overflow: "hidden" }}>
          {filtered.map((e, i) => (
            <div key={e.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "13px 16px",
              borderBottom: i < filtered.length - 1 ? "1px solid #1E3A5F" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 4, flexShrink: 0,
                background: severityMeta[e.severity].color }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.5 }}>{e.message}</div>
                <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 4, fontFamily: "monospace" }}>
                  {e.exception_code} · {e.module} · {new Date(e.detected_at).toLocaleDateString("en-IN")}
                </div>
              </div>
              <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4,
                background: severityMeta[e.severity].color + "22", color: severityMeta[e.severity].color, flexShrink: 0 }}>
                {e.severity}
              </span>
              <button
                onClick={() => resolveException(e.id)}
                style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid #1E3A5F",
                  background: "transparent", color: "#4A6FA5", cursor: "pointer", flexShrink: 0 }}
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
