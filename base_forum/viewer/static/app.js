// Decorum forum viewer (prototype). Polls the server; keeps your place; never steals the scroll.
"use strict";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const HUES = 8;

const S = {
  trials: [],
  sel: null, // {job, trial}
  events: [],
  next: 0,
  epoch: null,
  agents: [],
  instruction: null,
  trial: null,
  paused: false,
  seenSeq: 0, // highest seq rendered once, for the "fresh" highlight
  colors: new Map(),
  view: "threads",
  drawer: null,
  sig: "",
  expanded: new Set(), // seqs of posts the reader opened
  firstPaint: true,
};

// ---------- formatting ----------

function colorOf(name) {
  if (!S.colors.has(name)) S.colors.set(name, name === "authority" ? 0 : 1 + ((S.colors.size - (S.colors.has("authority") ? 1 : 0)) % (HUES - 1)));
  return `var(--a${S.colors.get(name)})`;
}
function who(name) {
  const s = el("span", "who", name);
  s.style.setProperty("--c", colorOf(name));
  return s;
}
function ts(iso) { return iso ? Date.parse(iso) : NaN; }
function clock(sec) {
  if (!isFinite(sec) || sec < 0) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}
function into(iso) {
  const t0 = ts(S.trial?.started_at), t = ts(iso);
  if (!isFinite(t0) || !isFinite(t)) return "";
  const d = Math.max(0, Math.round((t - t0) / 1000));
  const m = Math.floor(d / 60), s = d % 60;
  return `${m}:${String(s).padStart(2, "0")} in`;
}
function ago(iso) {
  const d = (Date.now() - ts(iso)) / 1000;
  if (!isFinite(d)) return "";
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(ts(iso)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function money(x) { return x == null ? "" : `$${x < 1 ? x.toFixed(2) : x.toFixed(2)}`; }
function humanTask(t) {
  if (t.title) return t.title;
  const parts = t.task.split("-");
  return parts.slice(1).join(" ").replace(/^./, (c) => c.toUpperCase());
}
function repoOf(t) { return t.repository || t.task.split("-")[0]; }
function outcome(t) {
  if (t.status !== "finished") return null;
  if (t.reward == null) return { word: "not graded yet", cls: "finished" };
  const tests = t.tests || {};
  const detail = tests.f2p_total ? ` · ${tests.f2p_passed} of ${tests.f2p_total} new tests` : "";
  return t.reward >= 1 ? { word: `passed${detail}`, cls: "passed" } : { word: `did not pass${detail}`, cls: "finished" };
}
const STATUS_WORD = { running: "running", starting: "starting", stalled: "no activity for 10 min", finished: "finished", failed: "failed to start" };
const AGENT_WORD = { working: "working", waiting: "waiting", finished: "finished", stopped: "stopped" };

// ---------- the rail ----------

function renderTrials() {
  const nav = $("trials");
  const keep = nav.scrollTop;
  nav.replaceChildren();
  const groups = [
    ["Running now", S.trials.filter((t) => t.status === "running" || t.status === "starting")],
    ["Finished", S.trials.filter((t) => !(t.status === "running" || t.status === "starting"))],
  ];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    nav.append(el("p", "group-label", label));
    for (const t of items) {
      const b = el("button", "trial-item");
      b.type = "button";
      b.setAttribute("aria-current", String(S.sel?.job === t.job && S.sel?.trial === t.trial));
      b.append(el("div", "ti-name", humanTask(t)));
      b.append(el("div", "ti-repo", `${repoOf(t)} · ${t.replay ? "replay of a recorded trial" : t.job}`));
      const line = el("div", "ti-line");
      const o = outcome(t);
      const word = o ? o.word : t.status === "running" && t.started_at ? `running · ${clock((Date.now() - ts(t.started_at)) / 1000)}` : STATUS_WORD[t.status] || t.status;
      const st = el("span", `st ${o ? o.cls : t.status}`, word);
      line.append(st);
      if (t.workers) line.append(el("span", "", `${t.workers} worker${t.workers > 1 ? "s" : ""}`));
      else if (t.status !== "starting") line.append(el("span", "", "no workers"));
      if (t.cost_usd) line.append(el("span", "", money(t.cost_usd)));
      b.append(line);
      b.addEventListener("click", () => select(t));
      nav.append(b);
    }
  }
  if (!S.trials.length) nav.append(el("p", "group-label", "No decorum trials in the job folders yet."));
  nav.scrollTop = keep;
}

// ---------- one trial ----------

function select(t) {
  S.sel = { job: t.job, trial: t.trial };
  S.events = []; S.next = 0; S.epoch = null; S.agents = []; S.seenSeq = 0; S.colors = new Map(); S.sig = ""; S.expanded = new Set(); S.firstPaint = true;
  history.replaceState(null, "", `#${encodeURIComponent(t.job)}/${encodeURIComponent(t.trial)}`);
  $("empty").hidden = true;
  $("trial").hidden = false;
  $("threads").replaceChildren();
  $("timeline-log").replaceChildren();
  closeDrawer();
  renderTrials();
  pollTrial(true);
}

function renderHead() {
  const t = S.trial;
  $("t-eyebrow").textContent = `${repoOf(t)}${t.language ? ` · ${t.language}` : ""} · ${t.job}`;
  $("t-title").textContent = humanTask(t);
  const o = outcome(t);
  const st = $("t-state");
  st.className = `st ${o ? o.cls : t.status}`;
  st.textContent = o ? o.word : STATUS_WORD[t.status] || t.status;
  const facts = $("t-facts");
  facts.replaceChildren();
  const fact = (label, value) => { if (!value) return; const s = el("span"); s.append(`${label} `); s.append(el("b", "", value)); facts.append(s); };
  const running = t.status === "running";
  fact(running ? "Running for" : "Took", clock(t.duration_sec ?? (Date.now() - ts(t.started_at)) / 1000));
  fact(running ? "Spent so far" : "Cost", money(t.cost_usd));
  const auth = S.agents.find((a) => a.role === "authority");
  const worker = S.agents.find((a) => a.role === "worker");
  fact("Authority", t.models?.authority || auth?.model);
  fact("Workers", t.models?.worker || worker?.model);
  fact("Rulebook", t.rulebook);
  if (t.end_reason && t.end_reason !== "authority_done") fact("Ended by", t.end_reason.replace("budget.", "budget: ").replace("_", " "));
  const note = $("t-note");
  note.hidden = !t.replay;
  note.textContent = "A replay: a recorded real trial played back at its original pace, so the page has something live to show.";
  const prob = $("t-problem");
  prob.hidden = !t.problem;
  prob.textContent = t.problem || "";
  const task = $("t-task");
  task.hidden = !S.instruction;
  if (S.instruction && $("t-task-text").textContent !== S.instruction) $("t-task-text").textContent = S.instruction;
}

function renderTeam() {
  const box = $("team");
  box.replaceChildren();
  for (const a of S.agents) {
    const c = el("button", "agent");
    c.type = "button";
    const top = el("div", "agent-top");
    top.append(who(a.name));
    top.append(el("span", `st ${a.state} agent-st`, AGENT_WORD[a.state] || a.state));
    c.append(top);
    c.append(el("div", "persona", a.role === "authority" ? "Manages the team: plans, assigns workers, verifies" : `${a.persona || ""}${a.thread ? ` · in ${a.thread}` : ""}`));
    const last = [...a.actions].reverse().find((x) => !x.forum) || a.actions.at(-1);
    const doing = el("div", "doing");
    const refused = S.events.filter((e) => e.kind === "refusal" && e.agent === a.name).length;
    if (last && (a.state === "working" || a.state === "waiting")) {
      doing.append(`${last.tool} `);
      doing.append(el("code", "", last.detail || ""));
    } else {
      doing.textContent = `${a.calls} model calls · ${money(a.cost_usd)}${refused ? ` · ${refused} refused` : ""}`;
    }
    c.append(doing);
    c.addEventListener("click", () => openDrawer(a.name));
    box.append(c);
  }
}

// Build each thread's items: forum events, plus each member's tool calls grouped before its next post.
function threadsModel() {
  const threads = new Map();
  for (const e of S.events) if (e.kind === "thread_opened") threads.set(e.thread.id, { thread: e.thread, items: [], members: new Set([e.thread.owner]), closed: false });
  for (const e of S.events) {
    const tid = e.kind === "post" ? e.post.thread : e.kind === "assigned" || e.kind === "finished" ? e.assignment.thread : e.kind === "thread_closed" ? e.thread.id : null;
    if (!tid || !threads.has(tid)) continue;
    const th = threads.get(tid);
    if (e.kind === "assigned") th.members.add(e.assignment.worker);
    if (e.kind === "thread_closed") { th.closed = true; th.thread = e.thread; }
    th.items.push({ kind: "event", e, at: e.at, author: e.kind === "post" ? e.post.author : e.kind === "assigned" ? null : e.kind === "finished" ? e.assignment.worker : null });
  }
  // workers' own tool calls belong to their thread
  for (const a of S.agents) {
    if (a.role !== "worker" || !a.thread || !threads.has(a.thread)) continue;
    threads.get(a.thread).items.push(...toolGroups(a, threads.get(a.thread).items));
  }
  for (const th of threads.values()) th.items.sort((x, y) => ts(x.at) - ts(y.at) || (x.kind === "tools" ? -1 : 1));
  return [...threads.values()];
}

// Group an agent's non-forum tool calls into runs that end at its next post/finish; the last run may still be open.
function toolGroups(a, items) {
  const marks = items.filter((i) => i.author === a.name).map((i) => ts(i.at)).sort((x, y) => x - y);
  const groups = [];
  let cur = null;
  for (const act of a.actions.filter((x) => !x.forum)) {
    const t = ts(act.at);
    const until = marks.find((m) => m >= t);
    const key = until ?? Infinity;
    if (!cur || cur.key !== key) { cur = { kind: "tools", agent: a.name, key, acts: [], at: act.at, open: key === Infinity && a.state !== "finished" && a.state !== "stopped" }; groups.push(cur); }
    cur.acts.push(act);
    cur.at = act.at;
  }
  return groups;
}

function renderItem(it) {
  if (it.kind === "tools") {
    const d = el("details", "tools");
    const sum = el("summary");
    sum.append(who(it.agent), ` ${it.open ? "is working" : "worked"}: ${it.acts.length} tool call${it.acts.length > 1 ? "s" : ""}`);
    d.append(sum);
    const ul = el("ul");
    for (const x of it.acts.slice(-30)) { const li = el("li"); li.append(`${x.tool} `, el("code", "", x.detail || "")); ul.append(li); }
    d.append(ul);
    return d;
  }
  const e = it.e;
  const fresh = e.seq > S.seenSeq;
  let n;
  if (e.kind === "post") {
    n = el("article", "post");
    const meta = el("div", "meta");
    meta.append(who(e.post.author), el("span", "when", into(e.at)));
    n.append(meta, clampText(e.post.text, e.seq));
  } else if (e.kind === "assigned") {
    const a = e.assignment;
    n = el("div", "assign");
    const p = el("div", "persona-line");
    p.append(who(a.worker), ` joined as ${a.persona || "a worker"}`);
    const instr = el("div", "instr", a.instructions);
    instr.title = "Click to show all";
    instr.addEventListener("click", () => instr.classList.toggle("open"));
    n.append(p, instr);
  } else if (e.kind === "finished") {
    const a = e.assignment;
    n = el("article", "finish");
    const meta = el("div", "meta");
    const w = el("span");
    w.append(who(a.worker), a.status === "finished" ? " finished" : " stopped without finishing");
    meta.append(w, el("span", "when", into(e.at)));
    n.append(meta, clampText(a.summary || "", e.seq));
    n.style.borderLeftColor = colorOf(a.worker);
  } else if (e.kind === "thread_closed") {
    n = el("div", "row");
    n.append(el("span", "body", `Closed by ${e.thread.owner}: ${e.thread.closingSummary || ""}`), el("span", "when", into(e.at)));
  } else if (e.kind === "refusal") {
    n = el("div", "refusal", `The rulebook refused ${e.agent}'s ${e.tool} (${e.rule}): ${e.reason}`);
  } else {
    n = el("div", "row", e.text || e.kind);
  }
  if (fresh && S.seenSeq > 0) n.classList.add("fresh");
  return n;
}

// Long text shows its first lines with a "Show all" control; the choice survives redraws.
function clampText(text, key) {
  const wrap = el("div");
  const t = el("div", "text", text);
  wrap.append(t);
  if (text.length > 420) {
    const open = S.expanded.has(key);
    if (!open) t.classList.add("clamped");
    const b = el("button", "more", open ? "Show less" : "Show all");
    b.type = "button";
    b.addEventListener("click", () => {
      if (S.expanded.has(key)) S.expanded.delete(key); else S.expanded.add(key);
      t.classList.toggle("clamped");
      b.textContent = t.classList.contains("clamped") ? "Show all" : "Show less";
    });
    wrap.append(b);
  }
  return wrap;
}

function renderRefusals() {
  const box = $("refusals");
  const rs = S.events.filter((e) => e.kind === "refusal");
  box.hidden = !rs.length;
  if (!rs.length) return;
  box.replaceChildren(el("b", "", `The rulebook refused ${rs.length} action${rs.length > 1 ? "s" : ""}`));
  const ul = el("ul");
  for (const r of rs.slice(-8)) {
    const li = el("li");
    li.append(who(r.agent), ` tried ${r.tool} (${r.rule}): ${r.reason}`, el("span", "when", ` ${into(r.at)}`));
    ul.append(li);
  }
  box.append(ul);
}

function renderBoard() {
  const board = $("threads");
  const model = threadsModel();
  // remember each column's place before redrawing
  const place = new Map();
  for (const col of board.querySelectorAll(".thread")) {
    const log = col.querySelector(".log");
    place.set(col.dataset.id, { top: log.scrollTop, atBottom: log.scrollHeight - log.scrollTop - log.clientHeight < 40, count: Number(col.dataset.count) });
  }
  board.replaceChildren();
  if (!model.length) {
    const auth = S.agents.find((a) => a.role === "authority");
    const n = auth ? auth.actions.filter((x) => !x.forum).length : 0;
    const p = el("div", "board-empty");
    p.append(el("p", "", S.trial.status === "running"
      ? `No threads yet. The authority is reading the task and the code${n ? ` (${n} tool calls so far)` : ""}; threads appear here as it opens them. Click the authority above to follow what it is doing.`
      : `No threads were opened: the authority worked on its own${n ? ` (${n} tool calls)` : ""}.`));
    board.append(p);
    return;
  }
  for (const th of model) {
    const col = el("section", `thread${th.closed ? " closed" : ""}`);
    col.dataset.id = th.thread.id;
    col.dataset.count = String(th.items.length);
    const head = el("header", "thread-head");
    head.append(el("div", "tid", th.thread.id), el("h4", "", th.thread.title), el("p", "goal", th.thread.goal));
    const people = el("div", "people");
    for (const m of th.members) people.append(who(m));
    head.append(people);
    const log = el("div", "log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-label", `Thread ${th.thread.id}: ${th.thread.title}`);
    for (const it of th.items) log.append(renderItem(it));
    col.append(head, log);
    board.append(col);
    const p = place.get(th.thread.id);
    // a finished trial opens at the start of each thread; a running one follows the newest message
    if (!p) log.scrollTop = S.trial.status === "running" ? log.scrollHeight : 0;
    else if (p.atBottom && S.trial.status === "running") log.scrollTop = log.scrollHeight;
    else {
      log.scrollTop = p.top;
      const added = th.items.length - p.count;
      if (added > 0 || col.dataset.pending) {
        const btn = el("button", "new-below", `${Math.max(added, 1)} new below`);
        btn.addEventListener("click", () => { log.scrollTop = log.scrollHeight; btn.remove(); });
        col.append(btn);
      }
    }
  }
}

function renderTimeline() {
  const log = $("timeline-log");
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
  log.replaceChildren();
  const items = S.events.filter((e) => e.kind !== "thread_opened" || true).map((e) => ({ kind: "event", e, at: e.at, author: e.kind === "post" ? e.post.author : e.kind === "finished" ? e.assignment.worker : null }));
  for (const a of S.agents) items.push(...toolGroups(a, items));
  items.sort((x, y) => ts(x.at) - ts(y.at) || (x.kind === "tools" ? -1 : 1));
  for (const it of items) {
    if (it.kind === "event" && it.e.kind === "thread_opened") {
      const r = el("div", "row");
      const body = el("span", "body");
      body.append(who(it.e.thread.owner), ` opened ${it.e.thread.id}, “${it.e.thread.title}”: ${it.e.thread.goal}`);
      r.append(body, el("span", "when", into(it.at)));
      log.append(r);
      continue;
    }
    const n = renderItem(it);
    const tid = it.kind === "event" ? (it.e.post?.thread || it.e.assignment?.thread || it.e.thread?.id) : null;
    if (tid && n.firstChild) n.prepend(el("span", "tl-thread", tid));
    log.append(n);
  }
  if (!items.length) log.append(el("p", "board-empty", "Nothing yet."));
  if (atBottom && S.trial.status === "running") window.scrollTo(0, document.body.scrollHeight);
}

// ---------- drawer ----------

function openDrawer(name) { S.drawer = name; renderDrawer(); $("drawer").hidden = false; $("d-close").focus(); }
function closeDrawer() { S.drawer = null; $("drawer").hidden = true; }
function renderDrawer() {
  if (!S.drawer) return;
  const a = S.agents.find((x) => x.name === S.drawer);
  if (!a) return;
  $("d-name").replaceChildren(who(a.name));
  $("d-meta").textContent = `${a.role === "authority" ? "Authority" : `Worker in ${a.thread}`} · ${a.model || ""} · ${AGENT_WORD[a.state] || a.state} · ${a.calls} model calls · ${money(a.cost_usd)}`;
  $("d-persona").textContent = a.role === "authority" ? "Manages the team: writes the plan, assigns and briefs workers, follows and verifies their work, and commits." : a.persona || "";
  const ol = $("d-actions");
  ol.replaceChildren();
  for (const x of [...a.actions].reverse()) {
    const li = el("li");
    const head = el("div");
    head.append(el("span", "tool", x.tool), " ", el("code", "", x.detail || ""), " ", el("span", "when", into(x.at)));
    li.append(head);
    if (x.result) li.append(el("div", `res${x.error ? " err" : ""}`, x.result));
    ol.append(li);
  }
  if (!a.actions.length) ol.append(el("li", "", "Nothing yet."));
}

// ---------- polling ----------

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function pollTrials() {
  try {
    const d = await getJSON("api/trials");
    S.trials = d.trials;
    renderTrials();
    $("updated").textContent = S.paused ? "Updates paused" : `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    if (!S.sel && location.hash.length > 1) {
      const [job, trial] = location.hash.slice(1).split("/").map(decodeURIComponent);
      const t = S.trials.find((x) => x.job === job && x.trial === trial);
      if (t) select(t);
    }
  } catch (e) {
    $("updated").textContent = "Cannot reach the viewer server";
  }
}

async function pollTrial(force) {
  if (!S.sel || (S.paused && !force)) return;
  const { job, trial } = S.sel;
  try {
    const d = await getJSON(`api/trial?job=${encodeURIComponent(job)}&trial=${encodeURIComponent(trial)}&since=${S.next}`);
    if (S.sel?.job !== job || S.sel?.trial !== trial) return;
    if (S.epoch !== null && d.epoch !== S.epoch) { S.events = []; S.next = 0; S.seenSeq = 0; S.epoch = d.epoch; return pollTrial(true); }
    S.epoch = d.epoch;
    S.events.push(...d.events);
    S.next = d.next;
    S.agents = d.agents;
    S.trial = d.trial;
    S.instruction = d.instruction;
    for (const a of S.agents) colorOf(a.name);
    const sig = JSON.stringify([S.next, S.trial.status, S.trial.cost_usd, S.agents.map((a) => [a.state, a.calls, a.actions.length])]);
    renderHead();
    if (sig !== S.sig) {
      S.sig = sig;
      renderTeam();
      renderRefusals();
      if (S.view === "threads") renderBoard(); else renderTimeline();
      renderDrawer();
      S.seenSeq = Math.max(S.seenSeq, ...S.events.map((e) => e.seq), 0);
    }
  } catch (e) {
    /* the next poll retries */
  }
}

function setView(v) {
  S.view = v;
  $("tab-threads").setAttribute("aria-selected", String(v === "threads"));
  $("tab-timeline").setAttribute("aria-selected", String(v === "timeline"));
  $("threads").hidden = v !== "threads";
  $("timeline").hidden = v !== "timeline";
  S.sig = "";
  pollTrial(true);
}

$("tab-threads").addEventListener("click", () => setView("threads"));
$("tab-timeline").addEventListener("click", () => setView("timeline"));
$("pause").addEventListener("click", () => {
  S.paused = !S.paused;
  $("pause").setAttribute("aria-pressed", String(S.paused));
  $("pause").textContent = S.paused ? "Resume updates" : "Pause updates";
  if (!S.paused) pollTrial(true);
});
$("d-close").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === "Escape") closeDrawer();
  if (e.key === "t" || e.key === "T") setView("threads");
  if (e.key === "l" || e.key === "L") setView("timeline");
});

pollTrials();
setInterval(pollTrials, 3000);
setInterval(() => pollTrial(false), 1500);
