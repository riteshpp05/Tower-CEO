import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { supabase } from "../../lib/supabaseClient";

function fmtINR(n: number | null | undefined) {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthRangeFromValue(monthValue: string) {
  const [y, m] = monthValue.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { start: toISO(start), end: toISO(end) };
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface OwnerPipelineRow {
  owner_id_zoho: string;
  owner_name: string;
  closing_count: number;
  closing_amount: number;
  total_count: number;
  total_amount: number;
}

interface StagePipelineRow {
  stage: string;
  closing_count: number;
  closing_amount: number;
  total_count: number;
  total_amount: number;
}

interface DealRow {
  zoho_deal_id: string;
  deal_name: string;
  account_name: string | null;
  amount: number | null;
  closing_date: string | null;
}

function PipelineHierarchy() {
  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const range = monthRangeFromValue(monthValue);

  const [owners, setOwners] = useState<OwnerPipelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedOwner, setExpandedOwner] = useState<string | null>(null);
  const [stages, setStages] = useState<StagePipelineRow[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);

  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);

  const loadOwners = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpandedOwner(null);
    setExpandedStage(null);
    const { data, error } = await supabase.rpc("get_pipeline_by_owner", {
      p_month_start: range.start,
      p_month_end: range.end,
    });
    if (error) setError(error.message);
    setOwners((data as OwnerPipelineRow[]) || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  useEffect(() => { loadOwners(); }, [loadOwners]);

  async function toggleOwner(ownerId: string) {
    if (expandedOwner === ownerId) {
      setExpandedOwner(null);
      setExpandedStage(null);
      return;
    }
    setExpandedOwner(ownerId);
    setExpandedStage(null);
    setStagesLoading(true);
    const { data, error } = await supabase.rpc("get_pipeline_by_owner_stage", {
      p_owner_id_zoho: ownerId,
      p_month_start: range.start,
      p_month_end: range.end,
    });
    if (!error) setStages((data as StagePipelineRow[]) || []);
    setStagesLoading(false);
  }

  async function toggleStage(stage: string) {
    if (expandedStage === stage) {
      setExpandedStage(null);
      return;
    }
    setExpandedStage(stage);
    setDealsLoading(true);
    const { data } = await supabase
      .from("v_crm_deals_detail")
      .select("zoho_deal_id, deal_name, account_name, amount, closing_date")
      .eq("owner_id_zoho", expandedOwner)
      .eq("stage", stage)
      .gte("closing_date", range.start)
      .lte("closing_date", range.end)
      .order("amount", { ascending: false });
    setDeals((data as DealRow[]) || []);
    setDealsLoading(false);
  }

  const totals = useMemo(() => owners.reduce(
    (acc, o) => ({
      closing_count: acc.closing_count + o.closing_count,
      closing_amount: acc.closing_amount + o.closing_amount,
      total_count: acc.total_count + o.total_count,
      total_amount: acc.total_amount + o.total_amount,
    }),
    { closing_count: 0, closing_amount: 0, total_count: 0, total_amount: 0 }
  ), [owners]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-ink-700">Pipeline by Stage</h2>
        <span className="text-xs text-ink-400">Closing month:</span>
        <input
          type="month"
          value={monthValue}
          onChange={e => setMonthValue(e.target.value)}
          className="bg-cream-100 border border-cream-200 rounded-md px-2 py-1 text-xs text-ink-700"
        />
      </div>
      <p className="text-[11px] text-ink-300">
        Click a salesperson to see their pipeline by stage. Click a stage to see the individual deals
        closing that month in that stage. "Total till date" covers every deal ever assigned to them,
        any stage, any date — a summary figure, not a browsable list.
      </p>

      {error && (
        <div className="border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-3 text-rose-300 text-xs">{error}</div>
      )}

      {loading ? (
        <div className="text-ink-500 text-sm">Loading…</div>
      ) : (
        <div className="border border-cream-200 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-cream-100/60 text-ink-400">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium" rowSpan={2}>Salesperson / Stage / Deal</th>
                <th className="text-center px-3 py-1 font-medium border-b border-cream-200" colSpan={2}>
                  Closing: {new Date(monthValue + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                </th>
                <th className="text-center px-3 py-1 font-medium border-b border-cream-200" colSpan={2}>Total till date</th>
              </tr>
              <tr>
                <th className="text-right px-3 py-1.5 font-medium">Count</th>
                <th className="text-right px-3 py-1.5 font-medium">Amount</th>
                <th className="text-right px-3 py-1.5 font-medium text-ink-300">Count</th>
                <th className="text-right px-3 py-1.5 font-medium text-ink-300">Amount</th>
              </tr>
            </thead>
            <tbody>
              {owners.map(o => (
                <Fragment key={o.owner_id_zoho}>
                  <tr
                    onClick={() => toggleOwner(o.owner_id_zoho)}
                    className="border-t border-cream-200 text-ink-700 cursor-pointer hover:bg-cream-100/60"
                  >
                    <td className="px-3 py-2 font-medium text-ink-900">
                      <span className="inline-block w-3 text-ink-300">{expandedOwner === o.owner_id_zoho ? "▾" : "▸"}</span>
                      {o.owner_name}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-ink-900">{o.closing_count}</td>
                    <td className="px-3 py-2 text-right font-medium text-ink-900">{fmtINR(o.closing_amount)}</td>
                    <td className="px-3 py-2 text-right text-ink-400">{o.total_count}</td>
                    <td className="px-3 py-2 text-right text-ink-400">{fmtINR(o.total_amount)}</td>
                  </tr>

                  {expandedOwner === o.owner_id_zoho && (
                    stagesLoading ? (
                      <tr><td colSpan={5} className="px-3 py-2 pl-8 text-ink-400 text-xs">Loading stages…</td></tr>
                    ) : stages.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-2 pl-8 text-ink-300 text-xs">No deals for this person.</td></tr>
                    ) : stages.map(s => (
                      <Fragment key={s.stage}>
                        <tr
                          onClick={() => toggleStage(s.stage)}
                          className="border-t border-cream-200/60 text-ink-700 cursor-pointer hover:bg-cream-100/40 bg-cream-50/40"
                        >
                          <td className="px-3 py-1.5 pl-8">
                            <span className="inline-block w-3 text-ink-300">{expandedStage === s.stage ? "▾" : "▸"}</span>
                            {s.stage}
                          </td>
                          <td className="px-3 py-1.5 text-right">{s.closing_count}</td>
                          <td className="px-3 py-1.5 text-right">{fmtINR(s.closing_amount)}</td>
                          <td className="px-3 py-1.5 text-right text-ink-400">{s.total_count}</td>
                          <td className="px-3 py-1.5 text-right text-ink-400">{fmtINR(s.total_amount)}</td>
                        </tr>
                        {expandedStage === s.stage && (
                          dealsLoading ? (
                            <tr><td colSpan={5} className="px-3 py-1.5 pl-14 text-ink-400 text-xs">Loading deals…</td></tr>
                          ) : deals.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-1.5 pl-14 text-ink-300 text-xs">No deals closing this month in this stage.</td></tr>
                          ) : deals.map(d => (
                            <tr key={d.zoho_deal_id} className="text-ink-500 bg-cream-50/70">
                              <td className="px-3 py-1.5 pl-14">
                                {d.deal_name}
                                {d.account_name && <span className="text-ink-300"> — {d.account_name}</span>}
                              </td>
                              <td></td>
                              <td className="px-3 py-1.5 text-right">{fmtINR(d.amount)}</td>
                              <td></td><td></td>
                            </tr>
                          ))
                        )}
                      </Fragment>
                    ))
                  )}
                </Fragment>
              ))}
              {owners.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-300">No data.</td></tr>
              )}
            </tbody>
            {owners.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-terra-100 text-ink-500 font-medium">
                  <td className="px-3 py-2">Team total</td>
                  <td className="px-3 py-2 text-right">{totals.closing_count}</td>
                  <td className="px-3 py-2 text-right">{fmtINR(totals.closing_amount)}</td>
                  <td className="px-3 py-2 text-right text-ink-400">{totals.total_count}</td>
                  <td className="px-3 py-2 text-right text-ink-400">{fmtINR(totals.total_amount)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

interface ActivityRow {
  owner_id_zoho: string;
  owner_name: string;
  deals_closing_in_period: number;
  deals_closed_won: number;
  deals_closed_lost: number;
  deals_created_in_period: number;
  tasks_logged: number;
  notes_logged: number;
  meetings_set: number;
  calls_logged: number;
}

type ActivityKey = "tasks_logged" | "notes_logged" | "meetings_set" | "calls_logged";

interface DetailConfig {
  view: string;
  columns: { key: string; label: string }[];
}

const ACTIVITY_COLUMNS: { key: ActivityKey; label: string }[] = [
  { key: "tasks_logged", label: "Tasks" },
  { key: "notes_logged", label: "Notes" },
  { key: "meetings_set", label: "Meetings" },
  { key: "calls_logged", label: "Calls" },
];

const DETAIL_CONFIG: Record<ActivityKey, DetailConfig> = {
  tasks_logged: {
    view: "v_crm_tasks_detail",
    columns: [
      { key: "subject", label: "Subject" }, { key: "status", label: "Status" },
      { key: "priority", label: "Priority" }, { key: "deal_name", label: "Deal" },
      { key: "due_date", label: "Due" },
    ],
  },
  notes_logged: {
    view: "v_crm_notes_detail",
    columns: [
      { key: "note_title", label: "Title" }, { key: "note_content", label: "Content" },
      { key: "deal_name", label: "Deal" }, { key: "created_time", label: "Logged" },
    ],
  },
  meetings_set: {
    view: "v_crm_events_detail",
    columns: [
      { key: "event_title", label: "Meeting" }, { key: "start_datetime", label: "When" },
      { key: "deal_name", label: "Deal" },
    ],
  },
  calls_logged: {
    view: "v_crm_calls_detail",
    columns: [
      { key: "subject", label: "Subject" }, { key: "call_type", label: "Type" },
      { key: "call_duration", label: "Duration" }, { key: "deal_name", label: "Deal" },
      { key: "call_start_time", label: "When" },
    ],
  },
};

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  return String(value);
}

function DrillDownDetail({ config, rows, loading }: { config: DetailConfig; rows: Record<string, unknown>[]; loading: boolean }) {
  if (loading) return <div className="text-xs text-ink-400 py-2">Loading…</div>;
  if (rows.length === 0) return <div className="text-xs text-ink-300 py-2">No records for this period.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-ink-400">
          <tr>{config.columns.map(c => <th key={c.key} className="text-left px-2 py-1 font-medium whitespace-nowrap">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-cream-200/60 text-ink-700">
              {config.columns.map(c => (
                <td key={c.key} className="px-2 py-1 max-w-[220px] truncate" title={formatDetailValue(r[c.key])}>
                  {formatDetailValue(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivitySummary() {
  const [periodMode, setPeriodMode] = useState<"week" | "month" | "custom">("week");
  const [customStart, setCustomStart] = useState(toISO(new Date()));
  const [customEnd, setCustomEnd] = useState(toISO(new Date()));

  const range =
    periodMode === "week" ? (() => {
      const anchor = new Date();
      const day = anchor.getDay();
      const start = new Date(anchor); start.setDate(anchor.getDate() + (day === 0 ? -6 : 1 - day));
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { start: toISO(start), end: toISO(end) };
    })() :
    periodMode === "month" ? (() => {
      const now = new Date();
      return { start: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), end: toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    })() :
    { start: customStart, end: customEnd };

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCell, setExpandedCell] = useState<{ ownerId: string; key: ActivityKey } | null>(null);
  const [detailRows, setDetailRows] = useState<Record<string, unknown>[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("get_weekly_sales_activity", {
      p_start_date: range.start, p_end_date: range.end, p_owner_id_zoho: null,
    });
    setRows((data as ActivityRow[]) || []);
    setLoading(false);
    setExpandedCell(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleCellClick(ownerId: string, key: ActivityKey, value: number) {
    if (expandedCell?.ownerId === ownerId && expandedCell?.key === key) {
      setExpandedCell(null);
      return;
    }
    setExpandedCell({ ownerId, key });
    if (value === 0) { setDetailRows([]); return; }
    setDetailLoading(true);
    const config = DETAIL_CONFIG[key];
    const endDate = new Date(range.end + "T00:00:00");
    endDate.setDate(endDate.getDate() + 1);
    const { data } = await supabase.from(config.view).select("*")
      .eq("owner_id_zoho", ownerId)
      .gte("created_time", range.start).lt("created_time", toISO(endDate))
      .order("created_time", { ascending: false }).limit(200);
    setDetailRows((data as Record<string, unknown>[]) || []);
    setDetailLoading(false);
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-ink-700">Activity Summary</h2>
      <div className="flex items-center gap-3">
        <div className="flex bg-cream-100 border border-cream-200 rounded-md p-0.5">
          {(["week", "month", "custom"] as const).map(mode => (
            <button key={mode} onClick={() => setPeriodMode(mode)}
              className={`px-3 py-1.5 rounded text-xs transition capitalize ${periodMode === mode ? "bg-terra-100 text-ink-900" : "text-ink-400 hover:text-ink-700"}`}>
              {mode === "week" ? "This Week" : mode === "month" ? "This Month" : "Custom"}
            </button>
          ))}
        </div>
        {periodMode === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-cream-100 border border-cream-200 rounded-md px-2 py-1.5 text-xs text-ink-700" />
            <span className="text-ink-300 text-xs">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-cream-100 border border-cream-200 rounded-md px-2 py-1.5 text-xs text-ink-700" />
          </div>
        )}
      </div>

      {loading ? <div className="text-ink-500 text-sm">Loading…</div> : (
        <div className="border border-cream-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-cream-100/60 text-ink-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Salesperson</th>
                {ACTIVITY_COLUMNS.map(c => <th key={c.key} className="text-right px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <Fragment key={row.owner_id_zoho}>
                  <tr className="border-t border-cream-200 text-ink-700">
                    <td className="px-3 py-2">{row.owner_name}</td>
                    {ACTIVITY_COLUMNS.map(col => {
                      const value = row[col.key] || 0;
                      const isZero = value === 0;
                      const isExpanded = expandedCell?.ownerId === row.owner_id_zoho && expandedCell?.key === col.key;
                      return (
                        <td key={col.key} onClick={() => handleCellClick(row.owner_id_zoho, col.key, value)}
                          className={`px-3 py-2 text-right cursor-pointer hover:bg-cream-100 transition ${isZero ? "text-ink-300" : "text-ink-900 font-medium"} ${isExpanded ? "bg-cream-100 ring-1 ring-inset ring-terra-100" : ""}`}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                  {expandedCell?.ownerId === row.owner_id_zoho && (
                    <tr>
                      <td colSpan={ACTIVITY_COLUMNS.length + 1} className="px-3 py-3 bg-cream-100/40 border-t border-cream-200">
                        <DrillDownDetail config={DETAIL_CONFIG[expandedCell.key]} rows={detailRows} loading={detailLoading} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={ACTIVITY_COLUMNS.length + 1} className="px-3 py-6 text-center text-ink-300">No activity data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function WeeklySalesReviewPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Weekly Sales Review</h1>
        <p className="text-xs text-ink-400 mt-0.5">
          Zeros are shown as-is — a blank column usually means the activity isn't being logged in Zoho CRM.
        </p>
      </div>
      <PipelineHierarchy />
      <ActivitySummary />
    </div>
  );
}