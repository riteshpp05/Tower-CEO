import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface SyncLog {
  id: string;
  source: string;
  sync_type: string;
  batch_id: string | null;
  status: "running" | "success" | "partial" | "failed";
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  records_failed: number;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}

interface SourceSummary {
  source: string;
  lastSync: SyncLog | null;
  totalRuns: number;
  totalRecords: number;
}

const KNOWN_SOURCES = [
  { key: "zoho_books", label: "Zoho Books", type: "API" },
  { key: "zoho_crm", label: "Zoho CRM", type: "API" },
  { key: "greythr", label: "greytHR", type: "API" },
  { key: "time_tracker", label: "Time Tracker", type: "SQL" },
  { key: "ticketing", label: "Ticketing", type: "SQL" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusMeta(status: string | undefined) {
  switch (status) {
    case "success": return { color: "#0D9488", label: "Healthy" };
    case "partial":  return { color: "#F59E0B", label: "Partial" };
    case "failed":   return { color: "#EF4444", label: "Failed" };
    case "running":  return { color: "#6366F1", label: "Running" };
    default:         return { color: "#475569", label: "Never synced" };
  }
}

export default function IntegrationPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sync_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) setError(error.message);
    else setLogs((data as SyncLog[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("sync_logs_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_logs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const summaries: SourceSummary[] = KNOWN_SOURCES.map(({ key }) => {
    const sourceLogs = logs.filter(l => l.source === key);
    return {
      source: key,
      lastSync: sourceLogs[0] || null,
      totalRuns: sourceLogs.length,
      totalRecords: sourceLogs.reduce((sum, l) => sum + (l.records_inserted || 0), 0),
    };
  });

  const totalRecordsAllSources = summaries.reduce((s, x) => s + x.totalRecords, 0);
  const healthySources = summaries.filter(s => s.lastSync?.status === "success").length;
  const failedSources = summaries.filter(s => s.lastSync?.status === "failed").length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "#E2E8F0" }}>Integration Monitor</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4A6FA5" }}>
            Live from sync_logs · Supabase realtime
          </p>
        </div>
        <SyncNowButton onSyncComplete={load} />
      </div>

      {error && (
        <div style={{ background: "#EF444411", border: "1px solid #EF444444", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Records synced" value={totalRecordsAllSources.toLocaleString()} color="#94A3B8" />
        <SummaryCard label="Healthy sources" value={`${healthySources} / ${KNOWN_SOURCES.length}`} color="#0D9488" />
        <SummaryCard label="Failed sources" value={String(failedSources)} color={failedSources > 0 ? "#EF4444" : "#94A3B8"} />
        <SummaryCard label="Total sync runs" value={String(logs.length)} color="#6366F1" />
      </div>

      {loading ? (
        <div style={{ color: "#4A6FA5", fontSize: 13 }}>Loading sync history…</div>
      ) : (
        <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, overflow: "hidden" }}>
          {summaries.map(({ source, lastSync, totalRecords }, i) => {
            const meta = statusMeta(lastSync?.status);
            const sourceMeta = KNOWN_SOURCES.find(s => s.key === source)!;
            const isExpanded = expandedSource === source;
            const history = logs.filter(l => l.source === source).slice(0, 10);

            return (
              <div key={source} style={{ borderBottom: i < summaries.length - 1 ? "1px solid #1E3A5F" : "none" }}>
                <div
                  onClick={() => setExpandedSource(isExpanded ? null : source)}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                    cursor: "pointer", transition: "background .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#13243F")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                    background: meta.color, boxShadow: lastSync?.status === "success" ? `0 0 6px ${meta.color}` : "none" }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#E2E8F0" }}>{sourceMeta.label}</div>
                    <div style={{ fontSize: 11, color: "#4A6FA5", marginTop: 2 }}>
                      {lastSync ? `Last sync: ${timeAgo(lastSync.started_at)}` : "No sync recorded yet"}
                    </div>
                  </div>

                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "#4A6FA5",
                    background: "#1E3A5F", padding: "2px 8px", borderRadius: 4, flexShrink: 0 }}>
                    {sourceMeta.type}
                  </span>

                  <div style={{ textAlign: "right", minWidth: 90, flexShrink: 0 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 13, color: "#CBD5E1" }}>
                      {totalRecords.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 10, color: "#4A6FA5" }}>records</div>
                  </div>

                  <span style={{ fontSize: 10, fontFamily: "monospace", padding: "3px 10px", borderRadius: 4,
                    background: meta.color + "22", color: meta.color, flexShrink: 0, minWidth: 76, textAlign: "center" }}>
                    {meta.label}
                  </span>

                  <span style={{ color: "#4A6FA5", fontSize: 11, flexShrink: 0, width: 14 }}>
                    {isExpanded ? "▾" : "▸"}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 18px 16px 41px", background: "#0A1830" }}>
                    {history.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#4A6FA5", padding: "10px 0" }}>
                        No sync runs recorded for this source yet.
                      </div>
                    ) : (
                      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 8 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #1E3A5F" }}>
                            {["Started", "Type", "Status", "Fetched", "Inserted", "Failed", "Error"].map(h => (
                              <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "#4A6FA5",
                                fontFamily: "monospace", fontWeight: 400, fontSize: 10, textTransform: "uppercase" }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map(h => {
                            const hMeta = statusMeta(h.status);
                            return (
                              <tr key={h.id} style={{ borderBottom: "1px solid #14233F" }}>
                                <td style={{ padding: "7px 8px", color: "#94A3B8", fontFamily: "monospace" }}>
                                  {new Date(h.started_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td style={{ padding: "7px 8px", color: "#64748B" }}>{h.sync_type}</td>
                                <td style={{ padding: "7px 8px" }}>
                                  <span style={{ color: hMeta.color, fontFamily: "monospace" }}>{hMeta.label}</span>
                                </td>
                                <td style={{ padding: "7px 8px", color: "#CBD5E1", fontFamily: "monospace" }}>{h.records_fetched}</td>
                                <td style={{ padding: "7px 8px", color: "#0D9488", fontFamily: "monospace" }}>{h.records_inserted}</td>
                                <td style={{ padding: "7px 8px", color: h.records_failed > 0 ? "#EF4444" : "#64748B", fontFamily: "monospace" }}>{h.records_failed}</td>
                                <td style={{ padding: "7px 8px", color: "#EF4444", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {h.error_detail || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: "#4A6FA5" }}>
        Click any source to see its last 10 sync runs. Updates live when a new sync completes.
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: "#0F1E35", border: "1px solid #1E3A5F", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// Falls back to localhost for same-machine access. Set VITE_CFO_SERVER_URL
// in .env to your machine's LAN IP (e.g. http://192.168.1.42:3002) to
// reach the backend from other devices on the same network.
const CFO_SERVER_URL = import.meta.env.VITE_CFO_SERVER_URL || "http://localhost:3002";

function SyncNowButton({ onSyncComplete }: { onSyncComplete: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  async function startSync() {
    setSyncing(true);
    setServerDown(false);
    setLastMessage(null);

    try {
      const res = await fetch(`${CFO_SERVER_URL}/sync/trigger`, { method: "POST" });
      if (!res.ok) throw new Error("Server responded with an error");
      await res.json();

      // Poll /sync/status every 3s until it reports not-running
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`${CFO_SERVER_URL}/sync/status`);
          const status = await statusRes.json();
          if (!status.running) {
            clearInterval(poll);
            setSyncing(false);
            const failed = status.last_result?.steps_failed ?? 0;
            setLastMessage(failed > 0 ? `Done — ${failed} step(s) failed, check logs` : "Sync complete");
            onSyncComplete();
          }
        } catch {
          clearInterval(poll);
          setSyncing(false);
          setServerDown(true);
        }
      }, 3000);
    } catch {
      setSyncing(false);
      setServerDown(true);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button
        onClick={startSync}
        disabled={syncing}
        style={{ background: syncing ? "#1E3A5F" : "#0D9488", border: "none", borderRadius: 8,
          padding: "9px 18px", color: "white", fontSize: 13, fontWeight: 500,
          cursor: syncing ? "default" : "pointer", whiteSpace: "nowrap" }}
      >
        {syncing ? "Syncing…" : "↻ Sync now"}
      </button>
      {serverDown && (
        <div style={{ fontSize: 10, color: "#EF4444", marginTop: 6, maxWidth: 220 }}>
          Backend not reachable on :3002. Start cfo_server.py first.
        </div>
      )}
      {lastMessage && !serverDown && (
        <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 6 }}>{lastMessage}</div>
      )}
    </div>
  );
}
