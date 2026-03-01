import { useState } from "react";

const BRAND = "#B5DF07";

const PRIORITY = { High: "#ef4444", Medium: BRAND, Low: "#6b7280" };


const STATUS_COLORS = {
  "To Do": "bg-gray-700 text-gray-200",
  "In Progress": "text-black",
  "Done": "bg-gray-600 text-gray-100",
  "Blocked": "bg-red-800 text-red-100",
};

const HEALTH = {
  Healthy: { color: "", bg: "border-[#B5DF07]/30 bg-[#B5DF07]/5", dot: "" },
  "At Risk": { color: "text-yellow-400", bg: "border-yellow-500/30 bg-yellow-400/5", dot: "bg-yellow-400" },
  Inactive: { color: "text-red-400", bg: "border-red-500/30 bg-red-400/5", dot: "bg-red-400" },
};

const TIER_BADGE = {
  Enterprise: "bg-[#B5DF07]/20 text-[#B5DF07] border border-[#B5DF07]/40",
  Growth: "bg-gray-700 text-gray-200 border border-gray-600",
  Starter: "bg-gray-800 text-gray-400 border border-gray-700",
};

const mockClients = [
  {
    id: 1, name: "Acme Corp", tier: "Enterprise",
    mixpanel: { lastEvent: "Dashboard Viewed", lastUser: "john.doe@acme.com", lastDate: "2026-02-26", daysAgo: 2 },
    workspace: { totalProjects: 14, activeProjects: 11, members: 42 },
    todos: [
      { id: 1, text: "Send Q1 Business Review deck", due: "2026-03-05", priority: "High", status: "In Progress", notes: "Waiting on usage data from Mixpanel" },
      { id: 2, text: "Follow up on expansion seats", due: "2026-03-10", priority: "Medium", status: "To Do", notes: "" },
      { id: 3, text: "Schedule onboarding for new team", due: "2026-02-28", priority: "High", status: "Done", notes: "Completed 2/25" },
    ],
  },
  {
    id: 2, name: "Globex Inc", tier: "Growth",
    mixpanel: { lastEvent: "Report Exported", lastUser: "sara.k@globex.io", lastDate: "2026-02-10", daysAgo: 18 },
    workspace: { totalProjects: 6, activeProjects: 5, members: 15 },
    todos: [
      { id: 1, text: "Introduce new Analytics feature", due: "2026-03-01", priority: "Medium", status: "To Do", notes: "" },
      { id: 2, text: "Check in on implementation", due: "2026-03-15", priority: "Low", status: "To Do", notes: "They mentioned resource constraints last call" },
    ],
  },
  {
    id: 3, name: "Initech LLC", tier: "Starter",
    mixpanel: { lastEvent: "Project Created", lastUser: "bill.l@initech.com", lastDate: "2025-11-01", daysAgo: 119 },
    workspace: { totalProjects: 3, activeProjects: 0, members: 5 },
    todos: [
      { id: 1, text: "Re-engagement call — at risk of churn", due: "2026-03-02", priority: "High", status: "In Progress", notes: "No activity in 4 months." },
    ],
  },
  {
    id: 4, name: "Umbrella Co", tier: "Enterprise",
    mixpanel: { lastEvent: "User Invited", lastUser: "admin@umbrella.com", lastDate: "2026-01-20", daysAgo: 39 },
    workspace: { totalProjects: 22, activeProjects: 18, members: 110 },
    todos: [
      { id: 1, text: "Prepare renewal proposal", due: "2026-03-20", priority: "High", status: "To Do", notes: "Renewal date: April 15" },
      { id: 2, text: "Coordinate SSO setup with IT", due: "2026-03-07", priority: "Medium", status: "Blocked", notes: "Waiting on IT ticket #4821" },
      { id: 3, text: "Share product roadmap preview", due: "2026-03-12", priority: "Low", status: "To Do", notes: "" },
    ],
  },
  {
    id: 5, name: "Vandelay Industries", tier: "Growth",
    mixpanel: { lastEvent: "Insight Shared", lastUser: "art.v@vandelay.com", lastDate: "2026-02-22", daysAgo: 6 },
    workspace: { totalProjects: 9, activeProjects: 7, members: 28 },
    todos: [],
  },
  {
    id: 6, name: "Bluth Company", tier: "Starter",
    mixpanel: { lastEvent: "Dashboard Viewed", lastUser: "michael.b@bluth.co", lastDate: "2025-10-15", daysAgo: 136 },
    workspace: { totalProjects: 2, activeProjects: 0, members: 4 },
    todos: [
      { id: 1, text: "Assess cancellation risk", due: "2026-03-01", priority: "High", status: "To Do", notes: "No login in 136 days" },
    ],
  },
];

function getHealth(daysAgo) {
  if (daysAgo <= 30) return "Healthy";
  if (daysAgo <= 90) return "At Risk";
  return "Inactive";
}

function PriorityDot({ priority }) {
  return (
    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
      style={{ backgroundColor: PRIORITY[priority] || "#6b7280" }} />
  );
}

function StatusBadge({ status }) {
  if (status === "In Progress") {
    return <span className="text-[11px] px-2 py-0.5 rounded-full font-medium text-black" style={{ backgroundColor: BRAND }}>{status}</span>;
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}>{status}</span>;
}

// SiteMarker logo rendered as SVG text + triangle (matching brand mark)
function SiteMarkerLogo() {
  return (
    <div className="flex items-center gap-2">
      {/* Triangle mark — inverted to brand color */}
      <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
        <polygon points="50,8 95,92 5,92" fill={BRAND} />
        <rect x="5" y="8" width="35" height="10" fill={BRAND} opacity="0.5" />
      </svg>
      <span className="text-white font-semibold text-xl tracking-tight">SiteMarker</span>
    </div>
  );
}

export default function App() {
  const [clients, setClients] = useState(mockClients);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("All");
  const [todoModal, setTodoModal] = useState(null);
  const [form, setForm] = useState({ text: "", due: "", priority: "Medium", status: "To Do", notes: "" });
  const [activeTab, setActiveTab] = useState("overview");

  const client = selected !== null ? clients.find(c => c.id === selected) : null;
  const filtered = filter === "All" ? clients : clients.filter(c => getHealth(c.mixpanel.daysAgo) === filter);

  const openAdd = (clientId) => { setForm({ text: "", due: "", priority: "Medium", status: "To Do", notes: "" }); setTodoModal({ clientId, todo: null }); };
  const openEdit = (clientId, todo) => { setForm({ ...todo }); setTodoModal({ clientId, todo }); };
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
  const deleteTodo = (clientId, todoId) => {
    setClients(prev => prev.map(c => c.id !== clientId ? c : { ...c, todos: c.todos.filter(t => t.id !== todoId) }));
  };

  const stats = {
    total: clients.length,
    healthy: clients.filter(c => getHealth(c.mixpanel.daysAgo) === "Healthy").length,
    atRisk: clients.filter(c => getHealth(c.mixpanel.daysAgo) === "At Risk").length,
    inactive: clients.filter(c => getHealth(c.mixpanel.daysAgo) === "Inactive").length,
    openTodos: clients.reduce((s, c) => s + c.todos.filter(t => t.status !== "Done").length, 0),
  };

  return (
    <div className="min-h-screen text-gray-100 font-sans" style={{ backgroundColor: "#0a0a0a" }}>

      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between" style={{ backgroundColor: "#111111", borderColor: "#222222" }}>
        <div className="flex items-center gap-6">
          <SiteMarkerLogo />
          <div className="w-px h-8 bg-gray-700" />
          <div>
            <p className="text-xs text-gray-400">Customer Success Dashboard</p>
            <p className="text-[11px] text-gray-600">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
        </div>
        <div className="flex gap-3 text-center">
          {[
            ["Total", stats.total, "text-gray-300"],
            ["Healthy", stats.healthy, ""],
            ["At Risk", stats.atRisk, "text-yellow-400"],
            ["Inactive", stats.inactive, "text-red-400"],
            ["Open Tasks", stats.openTodos, "text-gray-300"],
          ].map(([l, v, cls]) => (
            <div key={l} className="rounded-lg px-3 py-2 min-w-[64px]" style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }}>
              <div className={`text-xl font-bold ${cls}`} style={l === "Healthy" ? { color: BRAND } : {}}>
                {v}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {!client ? (
        <div className="p-6">
          {/* Filter */}
          <div className="flex gap-2 mb-5">
            {["All", "Healthy", "At Risk", "Inactive"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={filter === f
                  ? { backgroundColor: BRAND, color: "#000" }
                  : { backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #2a2a2a" }}>
                {f}
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(c => {
              const h = getHealth(c.mixpanel.daysAgo);
              const hStyle = HEALTH[h];
              const openCount = c.todos.filter(t => t.status !== "Done").length;
              const inactiveProjects = c.workspace.totalProjects - c.workspace.activeProjects;
              const nextTodo = c.todos.find(t => t.status !== "Done");
              return (
                <div key={c.id} onClick={() => { setSelected(c.id); setActiveTab("overview"); }}
                  className={`rounded-xl border cursor-pointer transition-all group ${hStyle.bg}`}
                  style={{ backgroundColor: "#111111", borderColor: h === "Healthy" ? "#B5DF07" + "40" : undefined }}>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-semibold text-white text-base group-hover:transition-colors" style={{}}
                            onMouseEnter={e => e.target.style.color = BRAND}
                            onMouseLeave={e => e.target.style.color = "white"}>
                            {c.name}
                          </h2>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TIER_BADGE[c.tier]}`}>{c.tier}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: h === "Healthy" ? BRAND : h === "At Risk" ? "#facc15" : "#f87171" }} />
                          <span className="text-xs font-medium" style={{ color: h === "Healthy" ? BRAND : h === "At Risk" ? "#facc15" : "#f87171" }}>{h}</span>
                        </div>
                      </div>
                      {openCount > 0 && (
                        <div className="text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center text-black" style={{ backgroundColor: BRAND }}>{openCount}</div>
                      )}
                    </div>

                    {/* Mixpanel */}
                    <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: "#1a1a1a" }}>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Last Activity · {c.mixpanel.daysAgo}d ago</div>
                      <div className="text-xs text-gray-200 font-medium">{c.mixpanel.lastEvent}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5 truncate">{c.mixpanel.lastUser}</div>
                    </div>

                    {/* Workspace stats */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[["Projects", c.workspace.totalProjects], ["Active", c.workspace.activeProjects], ["Inactive", inactiveProjects]].map(([l, v]) => (
                        <div key={l} className="rounded-lg p-2 text-center" style={{ backgroundColor: "#1a1a1a" }}>
                          <div className="text-sm font-bold text-white">{v}</div>
                          <div className="text-[10px] text-gray-500">{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Activity bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>Project Activity</span>
                        <span>{Math.round(c.workspace.activeProjects / c.workspace.totalProjects * 100)}% active</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#2a2a2a" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${c.workspace.activeProjects / c.workspace.totalProjects * 100}%`, backgroundColor: BRAND }} />
                      </div>
                    </div>

                    {/* Next task */}
                    {nextTodo ? (
                      <div className="rounded-lg p-2 text-xs" style={{ backgroundColor: "#1a1a1a" }}>
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
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${TIER_BADGE[client.tier]}`}>{client.tier}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getHealth(client.mixpanel.daysAgo) === "Healthy" ? BRAND : getHealth(client.mixpanel.daysAgo) === "At Risk" ? "#facc15" : "#f87171" }} />
                <span className="text-sm font-medium"
                  style={{ color: getHealth(client.mixpanel.daysAgo) === "Healthy" ? BRAND : getHealth(client.mixpanel.daysAgo) === "At Risk" ? "#facc15" : "#f87171" }}>
                  {getHealth(client.mixpanel.daysAgo)}
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 rounded-lg p-1 w-fit" style={{ backgroundColor: "#1a1a1a" }}>
            {["overview", "todos"].map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className="px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize"
                style={activeTab === t ? { backgroundColor: BRAND, color: "#000" } : { color: "#9ca3af" }}>
                {t === "todos" ? `Tasks (${client.todos.filter(t => t.status !== "Done").length} open)` : "Overview"}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl p-5" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Mixpanel Activity</div>
                <div className="space-y-3">
                  <div><div className="text-gray-500 text-xs mb-0.5">Last Event</div><div className="text-white font-semibold">{client.mixpanel.lastEvent}</div></div>
                  <div><div className="text-gray-500 text-xs mb-0.5">By User</div><div className="text-sm" style={{ color: BRAND }}>{client.mixpanel.lastUser}</div></div>
                  <div><div className="text-gray-500 text-xs mb-0.5">Date</div><div className="text-white text-sm">{client.mixpanel.lastDate} <span className="text-gray-500">({client.mixpanel.daysAgo} days ago)</span></div></div>
                </div>
              </div>
              <div className="rounded-xl p-5" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Workspace Overview</div>
                <div className="grid grid-cols-2 gap-3">
                  {[["Total Projects", client.workspace.totalProjects], ["Active Projects", client.workspace.activeProjects], ["Inactive (3mo+)", client.workspace.totalProjects - client.workspace.activeProjects], ["Members", client.workspace.members]].map(([l, v]) => (
                    <div key={l} className="rounded-lg p-3" style={{ backgroundColor: "#1a1a1a" }}>
                      <div className="text-2xl font-bold" style={{ color: BRAND }}>{v}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{l}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Active project rate</span>
                    <span>{Math.round(client.workspace.activeProjects / client.workspace.totalProjects * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "#2a2a2a" }}>
                    <div className="h-full rounded-full" style={{ width: `${client.workspace.activeProjects / client.workspace.totalProjects * 100}%`, backgroundColor: BRAND }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "todos" && (
            <div>
              <button onClick={() => openAdd(client.id)}
                className="mb-4 flex items-center gap-2 text-black text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                style={{ backgroundColor: BRAND }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Task
              </button>
              <div className="space-y-3">
                {client.todos.length === 0 && <div className="text-gray-600 text-sm py-8 text-center">No tasks yet. Add one above.</div>}
                {client.todos.map(todo => (
                  <div key={todo.id} className={`rounded-xl p-4 ${todo.status === "Done" ? "opacity-50" : ""}`}
                    style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <PriorityDot priority={todo.priority} />
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
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(client.id, todo)} className="p-1.5 rounded-md text-gray-500 hover:text-white transition-colors" style={{}}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => deleteTodo(client.id, todo.id)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 transition-colors">
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

      {/* Modal */}
      {todoModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl w-full max-w-md p-6" style={{ backgroundColor: "#111111", border: "1px solid #2a2a2a" }}>
            <h3 className="text-white font-semibold text-lg mb-4">{todoModal.todo ? "Edit Task" : "Add Task"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Task *</label>
                <input value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                  placeholder="What needs to be done?"
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                    style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }}>
                    {Object.keys(PRIORITY).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                    style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }}>
                    {Object.keys(STATUS_COLORS).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Due Date</label>
                <input type="date" value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any context or details..." rows={3}
                  className="w-full rounded-lg px-3 py-2 text-white text-sm focus:outline-none resize-none"
                  style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setTodoModal(null)}
                className="flex-1 py-2 rounded-lg text-gray-300 text-sm transition-colors"
                style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }}>Cancel</button>
              <button onClick={saveTodo}
                className="flex-1 py-2 rounded-lg text-black text-sm font-medium hover:opacity-90 transition-all"
                style={{ backgroundColor: BRAND }}>Save Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}