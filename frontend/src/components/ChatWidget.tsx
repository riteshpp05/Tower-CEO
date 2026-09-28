import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";

// Falls back to localhost for same-machine access, same convention as
// IntegrationPage.tsx's SyncNowButton. Set VITE_CFO_SERVER_URL in .env to
// reach the backend from other devices on the LAN.
const CFO_SERVER_URL = import.meta.env.VITE_CFO_SERVER_URL || "http://localhost:3002";

const PRIVILEGED_ROLES = ["md", "cfo", "admin"];

interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  updated_at: string;
}

interface ChatSource {
  rpc: string;
  params: Record<string, unknown>;
}

interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  route?: "router" | "llm_tool_call" | "none" | null;
  created_at: string;
}

// Module-level signal so any page (e.g. the "AI Analyst" nav item) can pop
// the widget open without it needing to live on a route. AppShell increments
// this; ChatWidget watches it via the prop below.
export default function ChatWidget({ openSignal }: { openSignal: number }) {
  const { session, profile, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastHandledSignal, setLastHandledSignal] = useState(openSignal);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const userId = session?.user?.id;
  // The access token Supabase already issued for this signed-in session --
  // sent as a Bearer token so the backend can verify identity itself
  // rather than trusting a self-reported user_id. See auth.py on the
  // backend for why this matters: a self-reported user_id would let
  // anyone on the LAN read or post into someone else's private chat.
  const accessToken = session?.access_token;
  const canViewAll = role ? PRIVILEGED_ROLES.includes(role) : false;

  const authHeaders = useCallback((): HeadersInit => ({
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }), [accessToken]);

  // Open the widget when AppShell's nav item bumps openSignal. Adjusting
  // state during render (rather than in a useEffect) avoids the extra
  // render pass an effect-driven setState would cause -- this is React's
  // recommended pattern for "derive state from a changed prop".
  if (openSignal !== lastHandledSignal) {
    setLastHandledSignal(openSignal);
    if (openSignal > 0) setOpen(true);
  }

  const loadSessions = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(
        `${CFO_SERVER_URL}/chat/sessions?view_all=${viewAll}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error("failed");
      const data: ChatSession[] = await res.json();
      setSessions(data);
      setServerDown(false);
      setActiveSessionId(prev => prev ?? (data.length > 0 ? data[0].id : null));
    } catch {
      setServerDown(true);
    }
  }, [accessToken, viewAll, authHeaders]);

  useEffect(() => {
    if (open && accessToken) loadSessions();
  }, [open, accessToken, viewAll, loadSessions]);

  const loadMessages = useCallback(async (sessionId: string) => {
    if (!accessToken) return;
    try {
      const res = await fetch(
        `${CFO_SERVER_URL}/chat/sessions/${sessionId}/messages`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error("failed");
      const data: ChatMessage[] = await res.json();
      setMessages(data);
      setServerDown(false);
    } catch {
      setServerDown(true);
    }
  }, [accessToken, authHeaders]);

  useEffect(() => {
    if (activeSessionId) loadMessages(activeSessionId);
  }, [activeSessionId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function startNewSession() {
    if (!accessToken) return;
    try {
      const res = await fetch(`${CFO_SERVER_URL}/chat/sessions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title: "New conversation" }),
      });
      if (!res.ok) throw new Error("failed");
      const newSession: ChatSession = await res.json();
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([]);
      setShowSessionList(false);
      setServerDown(false);
    } catch {
      setServerDown(true);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !accessToken || sending) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const res = await fetch(`${CFO_SERVER_URL}/chat/sessions`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ title: text.slice(0, 60) }),
        });
        if (!res.ok) throw new Error("failed");
        const newSession: ChatSession = await res.json();
        sessionId = newSession.id;
        setActiveSessionId(sessionId);
        setSessions(prev => [newSession, ...prev]);
      } catch {
        setServerDown(true);
        return;
      }
    }

    setInput("");
    setSending(true);
    setServerDown(false);

    // Optimistic render of the user's message.
    setMessages(prev => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        session_id: sessionId!,
        role: "user",
        content: text,
        sources: [],
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(`${CFO_SERVER_URL}/chat/ask`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });
      if (!res.ok) throw new Error("failed");
      await res.json();
      // Re-fetch from the server so we get the persisted, authoritative
      // copy (with real ids and sources) rather than trusting local state.
      await loadMessages(sessionId!);
    } catch {
      setServerDown(true);
    } finally {
      setSending(false);
    }
  }

  if (!session) return null;

  return (
    <>
      {/* Launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "fixed", bottom: 22, right: 22, width: 52, height: 52,
            borderRadius: "50%", background: "linear-gradient(135deg, #0D9488, #6366F1)",
            border: "none", color: "white", fontSize: 20, cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          title="AI Analyst"
        >
          ◆
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          style={
            isFullscreen
              ? {
                  position: "fixed", top: "5vh", left: "5vw", width: "90vw", height: "90vh",
                  background: "#0A1830", border: "1px solid #1E3A5F", borderRadius: 14,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 1000,
                  display: "flex", flexDirection: "column", overflow: "hidden",
                  fontFamily: "inherit",
                }
              : {
                  position: "fixed", bottom: 20, right: 20, width: 380, height: 560,
                  background: "#0A1830", border: "1px solid #1E3A5F", borderRadius: 14,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 1000,
                  display: "flex", flexDirection: "column", overflow: "hidden",
                  fontFamily: "inherit",
                }
          }
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
            borderBottom: "1px solid #1E3A5F", background: "#0F1E35", flexShrink: 0,
          }}>
            <span style={{
              width: 26, height: 26, borderRadius: 7, flexShrink: 0,
              background: "linear-gradient(135deg, #0D9488, #6366F1)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
            }}>◆</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 500 }}>AI Analyst</div>
              <div style={{ fontSize: 10, color: "#4A6FA5" }}>
                {sending ? "Thinking…" : "Ask about revenue, receivables, cash flow…"}
              </div>
            </div>
            <button
              onClick={() => setIsFullscreen(f => !f)}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              style={{
                background: "transparent", border: "1px solid #1E3A5F",
                borderRadius: 6, width: 28, height: 28, color: "#94A3B8", cursor: "pointer", fontSize: 12,
              }}
            >{isFullscreen ? "⤡" : "⤢"}</button>
            <button
              onClick={() => setShowSessionList(s => !s)}
              title="Conversations"
              style={{
                background: showSessionList ? "#1E3A5F" : "transparent", border: "1px solid #1E3A5F",
                borderRadius: 6, width: 28, height: 28, color: "#94A3B8", cursor: "pointer", fontSize: 12,
              }}
            >☰</button>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "transparent", border: "none", color: "#4A6FA5", cursor: "pointer", fontSize: 16, padding: "0 2px" }}
            >✕</button>
          </div>

          {showSessionList ? (
            <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  onClick={startNewSession}
                  style={{
                    flex: 1, background: "#0D9488", border: "none", borderRadius: 8,
                    padding: "8px 10px", color: "white", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  + New conversation
                </button>
                {canViewAll && (
                  <button
                    onClick={() => setViewAll(v => !v)}
                    title="Toggle viewing everyone's conversations"
                    style={{
                      background: viewAll ? "#1E3A5F" : "transparent", border: "1px solid #1E3A5F",
                      borderRadius: 8, padding: "8px 10px", color: "#94A3B8", fontSize: 11, cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {viewAll ? "All users" : "Mine only"}
                  </button>
                )}
              </div>
              {sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: "#4A6FA5", textAlign: "center", padding: "20px 0" }}>
                  No conversations yet.
                </div>
              ) : (
                sessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => { setActiveSessionId(s.id); setShowSessionList(false); }}
                    style={{
                      padding: "9px 11px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
                      background: s.id === activeSessionId ? "#1E3A5F" : "transparent",
                      border: "1px solid transparent",
                    }}
                    onMouseEnter={e => { if (s.id !== activeSessionId) e.currentTarget.style.background = "#0F1E35"; }}
                    onMouseLeave={e => { if (s.id !== activeSessionId) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontSize: 12, color: "#CBD5E1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 10, color: "#4A6FA5", marginTop: 2 }}>
                      {viewAll && s.user_id !== userId ? "Other user · " : ""}
                      {new Date(s.updated_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.length === 0 && (
                  <div style={{ fontSize: 12, color: "#4A6FA5", textAlign: "center", marginTop: 30, lineHeight: 1.6 }}>
                    Hi {profile?.full_name?.split(" ")[0] || "there"} — ask me things like:<br />
                    <span style={{ color: "#64748B" }}>
                      "What's our cash flow this week?"<br />
                      "Who owes us the most?"<br />
                      "Is Zoho synced?"
                    </span>
                  </div>
                )}
                {messages.map(m => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>

              {serverDown && (
                <div style={{ padding: "8px 14px", fontSize: 11, color: "#EF4444", borderTop: "1px solid #1E3A5F" }}>
                  Backend not reachable on :3002. Start cfo_server.py first.
                </div>
              )}

              <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #1E3A5F", flexShrink: 0 }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Ask a question…"
                  disabled={sending}
                  style={{
                    flex: 1, background: "#080F1C", border: "1px solid #1E3A5F", borderRadius: 8,
                    padding: "9px 12px", color: "#E2E8F0", fontSize: 13, outline: "none",
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !input.trim()}
                  style={{
                    background: sending || !input.trim() ? "#1E3A5F" : "#0D9488", border: "none",
                    borderRadius: 8, padding: "9px 14px", color: "white", fontSize: 13,
                    cursor: sending || !input.trim() ? "default" : "pointer",
                  }}
                >
                  ↑
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

type ContentSegment = { type: "text"; text: string } | { type: "table"; table: ParsedTable };

function looksLikeTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function looksLikeSeparatorRow(line: string): boolean {
  // A markdown table separator row looks like: |---|:---:|---|
  // i.e. only pipes, dashes, colons, and whitespace.
  const trimmed = line.trim();
  return /^\|[\s\-:|]+\|$/.test(trimmed) && trimmed.includes("-");
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map(cell => cell.trim());
}

/**
 * Splits message content into alternating text/table segments. The LLM
 * (per ANSWER_SYSTEM_PROMPT on the backend) is asked to format multi-row
 * data as a GitHub-flavored markdown table when requested -- this parser
 * is what turns that raw "|cell|cell|" text into an actually-rendered
 * <table>, since the bubble previously displayed it as literal pipe
 * characters (whiteSpace: pre-wrap on plain text).
 *
 * Deliberately a small hand-written parser rather than a markdown library
 * dependency, since a full markdown renderer is unnecessary surface area
 * for the one construct (pipe tables) the backend actually produces.
 */
function parseContentSegments(content: string): ContentSegment[] {
  const lines = content.split("\n");
  const segments: ContentSegment[] = [];
  let textBuffer: string[] = [];
  let i = 0;

  const flushText = () => {
    if (textBuffer.length > 0) {
      const text = textBuffer.join("\n").trim();
      if (text) segments.push({ type: "text", text });
      textBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (looksLikeTableRow(line) && nextLine && looksLikeSeparatorRow(nextLine)) {
      flushText();
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      while (i < lines.length && looksLikeTableRow(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      segments.push({ type: "table", table: { headers, rows } });
      continue;
    }

    textBuffer.push(line);
    i += 1;
  }
  flushText();
  return segments;
}

function tableToCsv(table: ParsedTable): string {
  const escapeCsvCell = (cell: string): string => {
    if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };
  const lines = [table.headers, ...table.rows].map(row => row.map(escapeCsvCell).join(","));
  return lines.join("\n");
}

function downloadCsv(table: ParsedTable, filenameHint: string) {
  const csv = tableToCsv(table);
  // Leading BOM so Excel on Windows opens UTF-8 CSVs (e.g. with the ₹
  // symbol or non-ASCII vendor/customer names) without mangling them.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = filenameHint.replace(/[^a-z0-9]+/gi, "-").slice(0, 50) || "table";
  a.download = `${safeName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DataTable({ table, exportFilenameHint }: { table: ParsedTable; exportFilenameHint: string }) {
  return (
    <div style={{ marginTop: 6, marginBottom: 6 }}>
      <div style={{ overflowX: "auto", border: "1px solid #1E3A5F", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: "left", padding: "6px 9px", background: "#142A47",
                    color: "#94A3B8", fontWeight: 600, borderBottom: "1px solid #1E3A5F",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "#0C1A30" }}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "6px 9px", color: "#E2E8F0",
                      borderBottom: ri === table.rows.length - 1 ? "none" : "1px solid #142233",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => downloadCsv(table, exportFilenameHint)}
        style={{
          marginTop: 5, background: "transparent", border: "1px solid #1E3A5F",
          borderRadius: 6, padding: "4px 9px", color: "#94A3B8", fontSize: 11,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
        }}
        title="Download this table as a CSV file (opens in Excel)"
      >
        ⬇ Export CSV
      </button>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [showSources, setShowSources] = useState(false);

  const segments = isUser ? null : parseContentSegments(message.content);

  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: isUser ? "85%" : "100%" }}>
        <div
          style={{
            background: isUser ? "#1E3A5F" : "#0F1E35",
            border: `1px solid ${isUser ? "#2A4A75" : "#1E3A5F"}`,
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: 13,
            color: "#E2E8F0",
            lineHeight: 1.5,
          }}
        >
          {isUser ? (
            <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
          ) : (
            segments!.map((seg, i) =>
              seg.type === "text" ? (
                <div key={i} style={{ whiteSpace: "pre-wrap" }}>{seg.text}</div>
              ) : (
                <DataTable key={i} table={seg.table} exportFilenameHint={message.sources?.[0]?.rpc || "data"} />
              )
            )
          )}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div style={{ marginTop: 3 }}>
            <button
              onClick={() => setShowSources(s => !s)}
              style={{
                background: "transparent", border: "none", color: "#4A6FA5",
                fontSize: 10, cursor: "pointer", padding: 0,
              }}
            >
              {showSources ? "▾" : "▸"} {message.sources.length} source{message.sources.length > 1 ? "s" : ""}
              {message.route === "llm_tool_call" ? " · AI-assisted" : ""}
            </button>
            {showSources && (
              <div style={{ fontSize: 10, color: "#64748B", marginTop: 3, fontFamily: "monospace" }}>
                {message.sources.map((s, i) => (
                  <div key={i}>{s.rpc}{Object.keys(s.params || {}).length > 0 ? ` (${JSON.stringify(s.params)})` : ""}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}