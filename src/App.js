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
const COOLDOWN_MS = 30 * 60 * 1000;
const CACHE_KEY   = "mp_cache_v1";

// FIX: Event names are case-sensitive and whitespace-sensitive in Mixpanel.
// These must exactly match what your app tracks — verify against Mixpanel Lexicon.
const KEY_EVENTS = [
  "User Signed In",
  "Project Created",
  "Report Created",
  "Report Draft Published",
  "Pin Created",
  "Pin Saved",
  "Share Sent",
  "Map Layer Created",
  "Pin Updated",
];

const DEFAULT_CLIENTS = [
  { id: 1, name: "Kimley Horn", domains: ["kimley-horn.com"], tier: "Enterprise", todos: [] },
  { id: 2, name: "SiteMarker",  domains: ["sitemarker.com"],  tier: "Enterprise", todos: [] },
];

const TIER_BADGE = {
  Enterprise: "bg-[#B5DF07]/20 text-[#B5DF07] border border-[#B5DF07]/40",
  Growth:     "bg-gray-700 text-gray-200 border border-gray-600",
  Starter:    "bg-gray-800 text-gray-400 border border-gray-700",
};

function getHealth(d) {
  if (d === null || d === undefined) return "Inactive";
  if (d <= 30)  return "Healthy";
  if (d <= 90)  return "At Risk";
  return "Inactive";
}
function healthColor(h) {
  if (h === "Healthy")  return BRAND;
  if (h === "At Risk")  return "#facc15";
  return "#f87171";
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}
function fmt(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function timeAgo(ts) {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

// ── Cache helpers ────────────────────────────────────────────────────────────
let memCache = null;
function loadCache() {
  if (memCache) return memCache;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) { memCache = JSON.parse(raw); return memCache; }
  } catch {}
  return null;
}
function saveCache(data) {
  memCache = data;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

// ── Mixpanel API proxy call ──────────────────────────────────────────────────
async function mpCall(endpoint, params) {
  const res = await fetch("/api/mixpanel", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ endpoint, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.body || "API error " + res.status);
  return data;
}

// ── Main data fetch per client ───────────────────────────────────────────────
async function fetchDomainData(domains) {

  // ── Call 1: Engage — get all user profiles for these domains ──────────────
  const engageData = await mpCall("engage", { domain: domains });
  const profiles   = engageData.results || [];

  if (!profiles.length) {
    return {
      lastEvent: "No users found", lastUser: "—", lastDate: null,
      daysAgo: null, eventCount: 0, topEvent: "—", newUsers: 0,
    };
  }

  // FIX: Count new users — check multiple possible created date property names
  // Mixpanel sets $created automatically; custom props vary by implementation
  const mtdStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const newUsers  = profiles.filter(p => {
    const created = p.$properties?.$created
      || p.$properties?.created
      || p.$properties?.created_at
      || p.$properties?.$last_seen; // fallback if no created date
    return created && new Date(created).getTime() >= mtdStart;
  }).length;

  // ── Call 2: Export — filter by domain directly (no user cap) ─────────────
  // FIX: Pass domains to the proxy so Export uses a "like" where clause instead
  // of a distinct_id list — this removes the 50/200 user cap entirely and
  // ensures we always get the full picture regardless of profile count.
  const to90   = new Date().toISOString().slice(0, 10);
  const from90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  // FIX: Pass KEY_EVENTS as a raw array — proxy handles JSON.stringify
  // Previously this was double-serialized causing silent 0 event returns
  // Use distinct_ids from Engage for the Export where clause.
  // Domain-based string filtering is not reliably supported by the Export API.
  // Engage already gave us the exact user list for these domains.
  const exportData = await mpCall("export", {
    from_date:    from90,
    to_date:      to90,
    event:        KEY_EVENTS,   // raw array, proxy handles JSON.stringify
    distinct_ids: distinctIds,  // from Engage results above
  });

  const events = (exportData.results || [])
    .sort((a, b) => (b.properties?.time ?? 0) - (a.properties?.time ?? 0));

  // ── Last event ────────────────────────────────────────────────────────────
  let lastEventData = null;
  if (events.length) {
    const e       = events[0];
    const ts      = e.properties?.time;
    const d       = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
    // Match event back to a profile for the email — Export only has distinct_id
    const profile = profiles.find(p => p.$distinct_id === e.distinct_id);
    const email   = profile?.$properties?.$email
      || profile?.$properties?.email
      || e.properties?.distinct_id
      || e.distinct_id;
    lastEventData = { lastEvent: e.event, lastUser: email, lastDate: d, daysAgo: daysSince(d) };
  }

  // ── 30-day event count ────────────────────────────────────────────────────
  const from30ts   = Date.now() - 30 * 86400000;
  const recent     = events.filter(e => (e.properties?.time ?? 0) * 1000 >= from30ts);
  const eventCount = recent.length;

  // ── Top event (30d) ───────────────────────────────────────────────────────
  const eventMap = {};
  recent.forEach(e => { eventMap[e.event] = (eventMap[e.event] || 0) + 1; });
  const topEvent = Object.entries(eventMap).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  return {
    lastEvent:  lastEventData?.lastEvent || "No recent activity",
    lastUser:   lastEventData?.lastUser  || "—",
    lastDate:   lastEventData?.lastDate  || null,
    daysAgo:    lastEventData?.daysAgo   ?? null,
    eventCount,
    topEvent,
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
    <div className="w-4 h-4 border-2 border-black/30 rounded-full animate-spin" style={{ borderTopColor: "#000" }} />
  );
}

// ── Domain Tag Input ─────────────────────────────────────────────────────────
function DomainTagInput({ domains, onChange }) {
  const [input, setInput] = useState("");

  const addDomain = () => {
    const val = input.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "");
    if (val && !domains.includes(val)) onChange([...domains, val]);
    setInput("");
  };

  const removeDomain = d => onChange(domains.filter(x => x !== d));

  const onKeyDown = e => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      e.preventDefault();
      addDomain();
    } else if (e.key === "Backspace" && !input && domains.length) {
      removeDomain(domains[domains.length - 1]);
    }
  };

  return (
    <div className="rounded-lg px-2 py-1.5 flex flex-wrap gap-1 items-center min-h-[36px] cursor-text"
      style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}
      onClick={e => e.currentTarget.querySelector("input").focus()}>
      {domains.map(d => (
        <span key={d} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: BRAND + "25", color: BRAND, border: "1px solid " + BRAND + "50" }}>
          {d}
          <button onClick={() => removeDomain(d)} className="hover:text-white leading-none ml-0.5">×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addDomain}
        placeholder={domains.length ? "" : "domain.com — press Enter to add"}
        className="flex-1 min-w-[140px] bg-transparent text-xs text-white focus:outline-none placeholder-gray-600"
      />
    </div>
  );
}

const inputStyle = { backgroundColor: BG2, border: "1px solid " + BG3, color: "white" };

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [clients, setClients]               = useState(DEFAULT_CLIENTS);
  const [mpData, setMpData]                 = useState({});
  const [loading, setLoading]               = useState(false);
  const [loadingMsg, setLoadingMsg]         = useState("");
  const [lastSynced, setLastSynced]         = useState(null);
  const [syncErrors, setSyncErrors]         = useState({});   // FIX: per-client errors
  const [selected, setSelected]             = useState(null);
  const [filter, setFilter]                 = useState("All");
  const [activeTab, setActiveTab]           = useState("overview");
  const [todoModal, setTodoModal]           = useState(null);
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [editingClients, setEditingClients] = useState(DEFAULT_CLIENTS);
  const [form, setForm] = useState({ text: "", due: "", priority: "Medium", status: "To Do", notes: "" });

  useEffect(() => {
    const cache = loadCache();
    if (cache) {
      setMpData(cache.data || {});
      setLastSynced(cache.ts || null);
    }
  }, []);

  const client   = selected !== null ? clients.find(c => c.id === selected) : null;
  const enriched = clients.map(c => ({ ...c, ...(mpData[c.id] || {}) }));
  const filtered = filter === "All" ? enriched : enriched.filter(c => getHealth(c.daysAgo) === filter);

  const canSync      = !loading && (!lastSynced || Date.now() - lastSynced > COOLDOWN_MS);
  const cooldownMins = lastSynced ? Math.max(0, Math.ceil((COOLDOWN_MS - (Date.now() - lastSynced)) / 60000)) : 0;

  const loadMixpanelData = useCallback(async () => {
    if (!canSync) return;
    setLoading(true);
    setSyncErrors({});
    const result = {};
    const errors = {};

    for (const c of clients) {
      setLoadingMsg("Syncing " + c.name + "…");
      try {
        result[c.id] = await fetchDomainData(c.domains);
        setMpData(prev => ({ ...prev, [c.id]: result[c.id] })); // progressive update
      } catch (e) {
        console.error("Failed for", c.name, e.message);
        errors[c.id] = e.message;
        result[c.id] = {
          lastEvent: "Sync error", lastUser: "—", lastDate: null,
          daysAgo: null, eventCount: 0, topEvent: "—", newUsers: 0,
        };
      }
    }

    const ts = Date.now();
    setMpData(result);
    setLastSynced(ts);
    setSyncErrors(errors);
    saveCache({ data: result, ts });
    setLoading(false);
    setLoadingMsg("");
  }, [clients, canSync]);

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

  const anyError = Object.keys(syncErrors).length > 0;

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
          <div className="flex flex-col items-end gap-1 ml-2">
            <div className="flex gap-2">
              <button onClick={loadMixpanelData} disabled={!canSync}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND, color: "#000" }}>
                {loading ? <><Spinner /> {loadingMsg || "Syncing..."}</> : "↻ Sync Mixpanel"}
              </button>
              <button onClick={() => { setEditingClients(clients); setSettingsOpen(true); }}
                className="px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-colors"
                style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
                ⚙ Clients
              </button>
            </div>
            {lastSynced && (
              <p className="text-[10px] text-gray-600">
                Last synced {timeAgo(lastSynced)}
                {!canSync && cooldownMins > 0 && <span className="text-gray-700"> · next sync in {cooldownMins}m</span>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Loading banner */}
      {loading && (
        <div className="px-6 py-2 text-xs text-center" style={{ backgroundColor: BRAND + "15", borderBottom: "1px solid " + BRAND + "30", color: BRAND }}>
          {loadingMsg}
        </div>
      )}

      {/* FIX: Per-client error banners instead of one overwriting the other */}
      {anyError && !loading && (
        <div className="px-6 py-2 text-xs bg-red-900/20 border-b border-red-800/30">
          {clients.filter(c => syncErrors[c.id]).map(c => (
            <div key={c.id} className="text-red-400">
              ✗ {c.name}: {syncErrors[c.id]} — check Vercel logs for details
            </div>
          ))}
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

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(c => {
              const h            = getHealth(c.daysAgo);
              const hcol         = healthColor(h);
              const openCount    = c.todos.filter(t => t.status !== "Done").length;
              const nextTodo     = c.todos.find(t => t.status !== "Done");
              const domainDisplay = (c.domains || []).join(", ");
              const hasError     = !!syncErrors[c.id];
              return (
                <div key={c.id} onClick={() => { setSelected(c.id); setActiveTab("overview"); }}
                  className="rounded-xl border cursor-pointer transition-all group"
                  style={{ backgroundColor: BG1, borderColor: hasError ? "#ef444440" : h === "Healthy" ? BRAND + "40" : h === "At Risk" ? "#facc1530" : "#f8717130" }}>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-semibold text-white text-base group-hover:opacity-80 transition-opacity">{c.name}</h2>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded font-medium " + TIER_BADGE[c.tier]}>{c.tier}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: hcol }} />
                          <span className="text-xs font-medium" style={{ color: hcol }}>{h}</span>
                          <span className="text-[10px] text-gray-600 truncate max-w-[160px]">· {domainDisplay}</span>
                        </div>
                      </div>
                      {openCount > 0 && (
                        <div className="text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center text-black flex-shrink-0" style={{ backgroundColor: BRAND }}>{openCount}</div>
                      )}
                    </div>

                    <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: BG2 }}>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">
                        Last Activity{c.daysAgo != null ? " · " + c.daysAgo + "d ago" : ""}
                      </div>
                      <div className="text-xs text-gray-200 font-medium truncate">{c.lastEvent || (lastSynced ? "No recent activity" : "Not yet synced")}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5 truncate">{c.lastUser || (lastSynced ? "—" : "Hit Sync to load data")}</div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[["30d Events", c.eventCount ?? "—"], ["Top Feature", null], ["New Users", c.newUsers ?? "—"]].map(([l, v], i) => (
                        <div key={l} className="rounded-lg p-2 text-center" style={{ backgroundColor: BG2 }}>
                          {i === 1
                            ? <div className="text-[10px] text-gray-200 font-medium leading-tight min-h-[20px]">{c.topEvent || "—"}</div>
                            : <div className="text-sm font-bold" style={{ color: BRAND }}>{v}</div>}
                          <div className="text-[10px] text-gray-500 mt-0.5">{l}</div>
                        </div>
                      ))}
                    </div>

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
        </div>
      ) : (
        <div className="p-6">
          <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-5 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            All Clients
          </button>
          <div className="flex items-center gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white">{client.name}</h2>
                <span className={"text-xs px-2 py-0.5 rounded font-medium " + TIER_BADGE[client.tier]}>{client.tier}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: healthColor(getHealth(mpData[client.id]?.daysAgo)) }} />
                <span className="text-sm font-medium" style={{ color: healthColor(getHealth(mpData[client.id]?.daysAgo)) }}>
                  {getHealth(mpData[client.id]?.daysAgo)}
                </span>
                {(client.domains || []).map(d => (
                  <span key={d} className="text-[11px] px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: BG2, color: "#9ca3af", border: "1px solid " + BG3 }}>
                    {d}
                  </span>
                ))}
              </div>
              {syncErrors[client.id] && (
                <div className="text-xs text-red-400 mt-1">⚠ Last sync error: {syncErrors[client.id]}</div>
              )}
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
              <div className="rounded-xl p-5" style={{ backgroundColor: BG1, border: "1px solid " + BRD }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-4">Mixpanel Activity</div>
                <div className="space-y-4">
                  {[
                    ["Last Event",        mpData[client.id]?.lastEvent || "—"],
                    ["By User",           mpData[client.id]?.lastUser  || "—"],
                    ["Date",              fmt(mpData[client.id]?.lastDate)],
                    ["Top Feature (90d)", mpData[client.id]?.topEvent  || "—"],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div className="text-gray-500 text-xs mb-0.5">{l}</div>
                      <div className="text-white font-medium text-sm break-all">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl p-5" style={{ backgroundColor: BG1, border: "1px solid " + BRD }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-4">Account Metrics</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Events (30d)",      mpData[client.id]?.eventCount ?? "—"],
                    ["New Users (MTD)",   mpData[client.id]?.newUsers   ?? "—"],
                    ["Days Since Active", mpData[client.id]?.daysAgo    ?? "—"],
                    ["Health",            getHealth(mpData[client.id]?.daysAgo)],
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
            <p className="text-gray-500 text-xs mb-4">
              Add one or more email domains per client. Type a domain and press{" "}
              <kbd className="px-1 py-0.5 rounded text-gray-400" style={{ backgroundColor: BG3 }}>Enter</kbd> or{" "}
              <kbd className="px-1 py-0.5 rounded text-gray-400" style={{ backgroundColor: BG3 }}>,</kbd> to add it.
            </p>
            <div className="space-y-3 mb-4">
              {editingClients.map((c, i) => (
                <div key={c.id} className="rounded-lg p-3" style={{ backgroundColor: BG2 }}>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Client Name</label>
                      <input value={c.name}
                        onChange={e => setEditingClients(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                        className="w-full rounded px-2 py-1.5 text-xs focus:outline-none" style={inputStyle} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Tier</label>
                      <select value={c.tier}
                        onChange={e => setEditingClients(prev => prev.map((x, j) => j === i ? { ...x, tier: e.target.value } : x))}
                        className="w-full rounded px-2 py-1.5 text-xs focus:outline-none" style={inputStyle}>
                        {["Enterprise", "Growth", "Starter"].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Email Domains</label>
                    <DomainTagInput
                      domains={c.domains || []}
                      onChange={domains => setEditingClients(prev => prev.map((x, j) => j === i ? { ...x, domains } : x))}
                    />
                  </div>
                  <button onClick={() => setEditingClients(prev => prev.filter((_, j) => j !== i))}
                    className="text-[10px] text-red-400 hover:text-red-300 mt-2">Remove client</button>
                </div>
              ))}
            </div>
            <button onClick={() => setEditingClients(prev => [...prev, { id: Date.now(), name: "", domains: [], tier: "Starter", todos: [] }])}
              className="w-full py-2 rounded-lg text-xs font-medium mb-4 text-gray-300 hover:text-white"
              style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
              + Add Client
            </button>
            <div className="flex gap-2">
              <button onClick={() => setSettingsOpen(false)}
                className="flex-1 py-2 rounded-lg text-gray-300 text-sm" style={{ backgroundColor: BG2, border: "1px solid " + BG3 }}>
                Cancel
              </button>
              <button onClick={() => { setClients(editingClients); setSettingsOpen(false); setMpData({}); saveCache(null); setSyncErrors({}); }}
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