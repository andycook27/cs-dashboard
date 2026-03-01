/* eslint-disable */
import { useState, useEffect, useCallback } from "react";

const BRAND = "#B5DF07";
const PRIORITY = { High: "#ef4444", Medium: "#B5DF07", Low: "#6b7280" };
const STATUS_COLORS = {
  "To Do":       "bg-gray-700 text-gray-200",
  "In Progress": "text-black",
  "Done":        "bg-gray-600 text-gray-100",
  "Blocked":     "bg-red-800 text-red-100",
};
const BG0 = "#0a0a0a", BG1 = "#111111", BG2 = "#1a1a1a", BG3 = "#2a2a2a", BRD = "#222222";

const KEY_EVENTS = [
  "User Signed In","Project Created","Report Created","Report Draft Published",
  "Pin Created","Pin Saved","Share Sent","Map Layer Created","Pin Updated",
];

const DEFAULT_CLIENTS = [
  { id: 1, name: "Kimley Horn", domain: "kimley-horn.com", tier: "Enterprise", todos: [] },
  { id: 2, name: "SiteMarker",  domain: "sitemarker.com",  tier: "Enterprise", todos: [] },
];

const TIER_BADGE = {
  Enterprise: "bg-[#B5DF07]/20 text-[#B5DF07] border border-[#B5DF07]/40",
  Growth:     "bg-gray-700 text-gray-200 border border-gray-600",
  Starter:    "bg-gray-800 text-gray-400 border border-gray-700",
};

function getHealth(daysAgo) {
  if (daysAgo === null || daysAgo === undefined) return "Inactive";
  if (daysAgo <= 30) return "Healthy";
  if (daysAgo <= 90) return "At Risk";
  return "Inactive";
}
function healthColor(h) {
  if (h === "Healthy")  return BRAND;
  if (h === "At Risk")  return "#facc15";
  return "#f87171";
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86400000);
}
function fmt(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Mixpanel API helper ──────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mpCall(endpoint, params, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch("/api/mixpanel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, params }),
    });
    const data = await res.json();
    if (res.status === 429) {
      console.log("Rate limited, waiting 2s before retry", i + 1);
      await sleep(2000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(data.error || "Proxy error " + res.status);
    return data;
  }
  throw new Error("Rate limit exceeded after retries");
}

function domainRegex(domain) {
  return `properties["$email"] =~ "(?i)@${domain.replace(/\./g, "\\\\.")}$"`;
}

// Fetch all data for a single domain sequentially to avoid rate limits
async function fetchAllForDomain(domain) {
  const to30   = new Date().toISOString().slice(0, 10);
  const from30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const from90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const fromMTD = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const where = domainRegex(domain);

  // 1. Last event via export
  let lastEvent = null;
  try {
    await sleep(300);
    const exportData = await mpCall("export", {
      from_date: from90,
      to_date:   to30,
      event:     JSON.stringify(KEY_EVENTS),
      where,
    });
    const events = (exportData.results || []).sort((a, b) => b.properties.time - a.properties.time);
    if (events.length) {
      const e = events[0];
      const d = new Date(e.properties.time * 1000).toISOString().slice(0, 10);
      lastEvent = {
        lastEvent: e.event,
        lastUser:  e.properties["$email"] || e.properties.distinct_id || "—",
        lastDate:  d,
        daysAgo:   daysSince(d),
      };
    }
  } catch (e) { console.warn("export failed:", e.message); }

  // 2. Total event count (use User Signed In as proxy for total activity)
  let eventCount = 0;
  try {
    await sleep(500);
    const seg = await mpCall("segmentation", {
      event: "User Signed In", from_date: from30, to_date: to30,
      where, type: "general", unit: "month",
    });
    const vals = seg?.data?.values?.["User Signed In"];
    eventCount = vals ? Object.values(vals).reduce((s, v) => s + v, 0) : 0;
  } catch (e) { console.warn("eventCount failed:", e.message); }

  // 3. Top event — run sequentially through key events
  let topEvent = null;
  let topCount = 0;
  for (const ev of KEY_EVENTS.slice(0, 5)) { // limit to 5 to reduce calls
    try {
      await sleep(600);
      const seg = await mpCall("segmentation", {
        event: ev, from_date: from30, to_date: to30,
        where, type: "general", unit: "month",
      });
      const vals = seg?.data?.values?.[ev];
      const count = vals ? Object.values(vals).reduce((s, v) => s + v, 0) : 0;
      if (count > topCount) { topCount = count; topEvent = ev; }
    } catch (e) { console.warn("topEvent failed for", ev, e.message); }
  }

  // 4. New users this month
  let newUsers = 0;
  try {
    await sleep(500);
    const seg = await mpCall("segmentation", {
      event: "User Signed Up", from_date: fromMTD, to_date: to30,
      where, type: "general", unit: "month",
    });
    const vals = seg?.data?.values?.["User Signed Up"];
    newUsers = vals ? Object.values(vals).reduce((s, v) => s + v, 0) : 0;
  } catch (e) { console.warn("newUsers failed:", e.message); }

  return {
    lastEvent:  lastEvent?.lastEvent || "No recent activity",
    lastUser:   lastEvent?.lastUser  || "—",
    lastDate:   lastEvent?.lastDate  || null,
    daysAgo:    lastEvent?.daysAgo   ?? null,
    eventCount,
    topEvent:   topEvent || "—",
    newUsers,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (status === "In Progress")
    return <span className="text-[11px] px-2 py-0.5 rounded-full font-medium text-black" style={{ backgroundColor: BRAND }}>{status}</span>;
  return <span className={"text-[11px] px-2 py-0.5 rounded-full font-medium " + STATUS_COLORS[status]}>{status}</span>;
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 100 100" fill="none">
        <polygon points="50,8 95,92 5,92" fill={BRAND} />
      </svg>
      <span className="text-white font-semibold text-xl tracking-tight">SiteMarker</span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-gray-600 rounded-full animate-spin" style={{ borderTopColor: BRAND }} />
    </div>
  );
}

const inputStyle = { backgroundColor: BG2, border: "1px solid " + BG3, color: "white" };

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [clients, setClients]         = useState(DEFAULT_CLIENTS);
  const [mpData, setMpData]           = useState({});
  const [loading, setLoading]         = useState(false);
  const [loadingMsg, setLoadingMsg]   = useState("");
  const [selected, setSelected]       = useState(null);
  const [filter, setFilter]           = useState("All");
  const [activeTab, setActiveTab]     = useState("overview");
  const [todoModal, setTodoModal]     = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm]               = useState({ text: "", due: "", priority: "Medium", status: "To Do", notes: "" });

  // Client editor state
  const [editingClients, setEditingClients] = useState(DEFAULT_CLIENTS);

  const client   = selected !== null ? clients.find(c => c.id === selected) : null;
  const enriched = clients.map(c => ({ ...c, ...(mpData[c.id] || {}) }));
  const filtered = filter === "All" ? enriched : enriched.filter(c => getHealth(c.daysAgo) === filter);

  // ── Load Mixpanel data for all clients ──
  const loadMixpanelData = useCallback(async () => {
    setLoading(true);
    const result = {};
    for (const c of clients) {
      setLoadingMsg("Loading " + c.name + "...");
      try {
        result[c.id] = await fetchAllForDomain(c.domain);
      } catch (e) {
        console.error("Failed for", c.name, e.message);
        result[c.id] = { lastEvent: "Error loading", lastUser: "—", lastDate: null, daysAgo: null, eventCount: 0, topEvent: "—", newUsers: 0 };
      }
      // Update UI after each client so results appear progressively
      setMpData({ ...result });
    }
    setMpData(result);
    setLoading(false);
    setLoadingMsg("");
  }, [clients]);

  // ── Todo helpers ──
  const openAdd  = id => { setForm({ text: "", due: "", priority: "Medium", status: "To Do", notes: "" }); setTodoModal({ clientId: id, todo: null }); };
  const openEdit = (id, todo) => { setForm({ ...todo }); setTodoModal({ clientId: id, todo }); };
  const saveTodo = () => {
    if (!form.text.trim()) return;
    setClients(prev => prev.map(c => {
      if (c.id !== todoModal.clientId) return c;
      const todos = todoModal.todo
        ? c.todos.map(t => t.id === todoModal.todo.id ? { ...form, id: t.id } : t)
        : [...c.todos, { ...form, id: Date.now() }];
      return { ...c, todos };
    }));
    setTodoModal(null);
  };
  const deleteTodo = (cid, tid) =>
    setClients(prev => prev.map(c => c.id !== cid ? c : { ...c, todos: c.todos.filter(t => t.id !== tid) }));

  const stats = {
    total:     enriched.length,
    healthy:   enriched.filter(c => getHealth(c.daysAgo) === "Healthy").length,
    atRisk:    enriched.filter(c => getHealth(c.daysAgo) === "At Risk").length,
    inactive:  enriched.filter(c => getHealth(c.daysAgo) === "Inactive").length,
    openTodos: clients.reduce((s, c) => s + c.todos.filter(t => t.status !== "Done").length, 0),
  };

  return (
    <div className="min-h-screen text-gray-100 font-sans" style={{ backgroundColor: BG0 }}>

      {/* ── Header ── */}
      <div className="border-b px-6 py-4 flex items-center justify-between" style={{ backgroundColor: BG1, borderColor: BRD }}>
        <div className="flex items-center gap-6">
          <Logo />
          <div className="w-px h-8 bg-gray-700" />
          <div>
            <p className="text-xs text-gray-400">Customer Success Dashboard</p>
            <p className="text-[11px] text-gray-600">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-3">
            {[["Total", stats.total, "#d1d5db"], ["Healthy", stats.healthy, BRAND], ["At Risk", stats.atRisk, "#facc15"], ["Inactive", stats.inactive, "#f87171"], ["Open Tasks", stats.openTodos, "#d1d5db"]].map(([l, v, col]) => (
              <div key={l} className="rounded-lg px-3 py-2 min-w-[64px] text-center" style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
                <div className="text-xl font-bold" style={{ color: col }}>{v}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{l}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 ml-2">
            <button onClick={loadMixpanelData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: BRAND, color: "#000" }}>
              {loading ? "Loading..." : "↻ Sync Mixpanel"}
            </button>
            <button onClick={() => { setEditingClients(clients); setSettingsOpen(true); }}
              className="px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-colors"
              style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
              ⚙ Clients
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="px-6 py-2 text-xs text-center" style={{ backgroundColor: BRAND + "15", borderBottom: "1px solid " + BRAND + "30", color: BRAND }}>
          {loadingMsg}
        </div>
      )}

      {!client ? (
        <div className="p-6">
          <div className="flex gap-2 mb-5">
            {["All", "Healthy", "At Risk", "Inactive"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={filter === f ? { backgroundColor: BRAND, color: "#000" } : { backgroundColor: BG2, color: "#9ca3af", border: "1px solid " + BG3 }}>
                {f}
              </button>
            ))}
          </div>

          {loading && !Object.keys(mpData).length ? <Spinner /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(c => {
                const h        = getHealth(c.daysAgo);
                const hcol     = healthColor(h);
                const openCount = c.todos.filter(t => t.status !== "Done").length;
                const nextTodo  = c.todos.find(t => t.status !== "Done");
                return (
                  <div key={c.id} onClick={() => { setSelected(c.id); setActiveTab("overview"); }}
                    className="rounded-xl border cursor-pointer transition-all group"
                    style={{ backgroundColor: BG1, borderColor: h === "Healthy" ? BRAND + "40" : h === "At Risk" ? "#facc1530" : "#f8717130" }}>
                    <div className="p-4">
                      {/* Name row */}
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="font-semibold text-white text-base group-hover:opacity-80 transition-opacity">{c.name}</h2>
                            <span className={"text-[10px] px-1.5 py-0.5 rounded font-medium " + TIER_BADGE[c.tier]}>{c.tier}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: hcol }} />
                            <span className="text-xs font-medium" style={{ color: hcol }}>{h}</span>
                            <span className="text-[10px] text-gray-600">· {c.domain}</span>
                          </div>
                        </div>
                        {openCount > 0 && (
                          <div className="text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center text-black" style={{ backgroundColor: BRAND }}>{openCount}</div>
                        )}
                      </div>

                      {/* Mixpanel data */}
                      <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: BG2 }}>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">
                          Last Activity{c.daysAgo !== null && c.daysAgo !== undefined ? " · " + c.daysAgo + "d ago" : ""}
                        </div>
                        <div className="text-xs text-gray-200 font-medium truncate">{c.lastEvent || "—"}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">{c.lastUser || "—"}</div>
                      </div>

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          ["30d Events",  c.eventCount ?? "—"],
                          ["Top Feature", null],
                          ["New Users",   c.newUsers ?? "—"],
                        ].map(([l, v], i) => (
                          <div key={l} className="rounded-lg p-2 text-center" style={{ backgroundColor: BG2 }}>
                            {i === 1
                              ? <div className="text-[10px] text-gray-200 font-medium leading-tight">{c.topEvent || "—"}</div>
                              : <div className="text-sm font-bold" style={{ color: BRAND }}>{v}</div>
                            }
                            <div className="text-[10px] text-gray-500 mt-0.5">{l}</div>
                          </div>
                        ))}
                      </div>

                      {/* Next task */}
                      {nextTodo ? (
                        <div className="rounded-lg p-2 text-xs" style={{ backgroundColor: BG2 }}>
                          <div className="text-gray-500 text-[10px] mb-0.5">Next task</div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY[nextTodo.priority] }} />
                            <span className="text-gray-200 truncate">{nextTodo.text}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-600 text-center py-1">No open tasks</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="p-6">
          <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-5 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            All Clients
          </button>

          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white">{client.name}</h2>
                <span className={"text-xs px-2 py-0.5 rounded font-medium " + TIER_BADGE[client.tier]}>{client.tier}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: healthColor(getHealth(mpData[client.id]?.daysAgo)) }} />
                <span className="text-sm font-medium" style={{ color: healthColor(getHealth(mpData[client.id]?.daysAgo)) }}>
                  {getHealth(mpData[client.id]?.daysAgo)}
                </span>
                <span className="text-xs text-gray-600">· {client.domain}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-1 mb-5 rounded-lg p-1 w-fit" style={{ backgroundColor: BG2 }}>
            {["overview", "todos"].map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className="px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize"
                style={activeTab === t ? { backgroundColor: BRAND, color: "#000" } : { color: "#9ca3af" }}>
                {t === "todos" ? "Tasks (" + client.todos.filter(td => td.status !== "Done").length + " open)" : "Overview"}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Activity */}
              <div className="rounded-xl p-5" style={{ backgroundColor: BG1, border: "1px solid " + BRD }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-4">Mixpanel Activity</div>
                <div className="space-y-4">
                  {[
                    ["Last Event",         mpData[client.id]?.lastEvent || "—"],
                    ["By User",            mpData[client.id]?.lastUser  || "—"],
                    ["Date",               fmt(mpData[client.id]?.lastDate)],
                    ["Top Feature (30d)",  mpData[client.id]?.topEvent  || "—"],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div className="text-gray-500 text-xs mb-0.5">{l}</div>
                      <div className="text-white font-medium text-sm">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Metrics */}
              <div className="rounded-xl p-5" style={{ backgroundColor: BG1, border: "1px solid " + BRD }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-4">Account Metrics</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Events (30d)",    mpData[client.id]?.eventCount ?? "—"],
                    ["New Users (MTD)", mpData[client.id]?.newUsers   ?? "—"],
                    ["Days Since Active", mpData[client.id]?.daysAgo  ?? "—"],
                    ["Health Status",  getHealth(mpData[client.id]?.daysAgo)],
                  ].map(([l, v]) => (
                    <div key={l} className="rounded-lg p-3" style={{ backgroundColor: BG2 }}>
                      <div className="text-2xl font-bold" style={{ color: BRAND }}>{v}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "todos" && (
            <div>
              <button onClick={() => openAdd(client.id)}
                className="mb-4 flex items-center gap-2 text-black text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90"
                style={{ backgroundColor: BRAND }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Task
              </button>
              <div className="space-y-3">
                {client.todos.length === 0 && <div className="text-gray-600 text-sm py-8 text-center">No tasks yet.</div>}
                {client.todos.map(todo => (
                  <div key={todo.id} className={"rounded-xl p-4" + (todo.status === "Done" ? " opacity-50" : "")}
                    style={{ backgroundColor: BG1, border: "1px solid " + BRD }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: PRIORITY[todo.priority] }} />
                        <div className="min-w-0">
                          <div className="text-white font-medium text-sm">{todo.text}</div>
                          {todo.notes && <div className="text-gray-500 text-xs mt-1">{todo.notes}</div>}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <StatusBadge status={todo.status} />
                            <span className="text-[11px] text-gray-600">{todo.priority} priority</span>
                            {todo.due && <span className="text-[11px] text-gray-600">Due {todo.due}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(client.id, todo)} className="p-1.5 rounded-md text-gray-500 hover:text-white">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => deleteTodo(client.id, todo.id)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Todo Modal ── */}
      {todoModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl w-full max-w-md p-6" style={{ backgroundColor: BG1, border: "1px solid " + BG3 }}>
            <h3 className="text-white font-semibold text-lg mb-4">{todoModal.todo ? "Edit Task" : "Add Task"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Task *</label>
                <input value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                  placeholder="What needs to be done?" className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle}>
                    {Object.keys(PRIORITY).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle}>
                    {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Due Date</label>
                <input type="date" value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} placeholder="Any context..." className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" style={inputStyle} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setTodoModal(null)} className="flex-1 py-2 rounded-lg text-gray-300 text-sm"
                style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>Cancel</button>
              <button onClick={saveTodo} className="flex-1 py-2 rounded-lg text-black text-sm font-medium hover:opacity-90"
                style={{ backgroundColor: BRAND }}>Save Task</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Client Settings Modal ── */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" style={{ backgroundColor: BG1, border: "1px solid " + BG3 }}>
            <h3 className="text-white font-semibold text-lg mb-1">Manage Clients</h3>
            <p className="text-gray-500 text-xs mb-4">Set each client's email domain to match Mixpanel user profiles.</p>
            <div className="space-y-3 mb-4">
              {editingClients.map((c, i) => (
                <div key={c.id} className="rounded-lg p-3" style={{ backgroundColor: BG2 }}>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Client Name</label>
                      <input value={c.name} onChange={e => setEditingClients(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                        className="w-full rounded px-2 py-1.5 text-xs focus:outline-none" style={inputStyle} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Email Domain</label>
                      <input value={c.domain} onChange={e => setEditingClients(prev => prev.map((x, j) => j === i ? { ...x, domain: e.target.value } : x))}
                        placeholder="acme.com" className="w-full rounded px-2 py-1.5 text-xs focus:outline-none" style={inputStyle} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Tier</label>
                      <select value={c.tier} onChange={e => setEditingClients(prev => prev.map((x, j) => j === i ? { ...x, tier: e.target.value } : x))}
                        className="w-full rounded px-2 py-1.5 text-xs focus:outline-none" style={inputStyle}>
                        {["Enterprise", "Growth", "Starter"].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={() => setEditingClients(prev => prev.filter((_, j) => j !== i))}
                    className="text-[10px] text-red-400 hover:text-red-300 mt-2">Remove client</button>
                </div>
              ))}
            </div>
            <button onClick={() => setEditingClients(prev => [...prev, { id: Date.now(), name: "", domain: "", tier: "Starter", todos: [] }])}
              className="w-full py-2 rounded-lg text-xs font-medium mb-4 text-gray-300 hover:text-white"
              style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
              + Add Client
            </button>
            <div className="flex gap-2">
              <button onClick={() => setSettingsOpen(false)}
                className="flex-1 py-2 rounded-lg text-gray-300 text-sm" style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
                Cancel
              </button>
              <button onClick={() => { setClients(editingClients); setSettingsOpen(false); setMpData({}); }}
                className="flex-1 py-2 rounded-lg text-black text-sm font-medium hover:opacity-90"
                style={{ backgroundColor: BRAND }}>
                Save & Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}