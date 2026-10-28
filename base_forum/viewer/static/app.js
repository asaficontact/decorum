// Forum Decorum viewer. Polls the server; keeps your place; never steals the scroll.
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
  runs: [],
  trials: [],
  sel: null, // {job, trial}
  retryTick: new Map(), // "job/task" -> ticked or not, where the reader changed a run's retry list
  runSel: null, // job of the run whose overview is open
  openRuns: new Set(JSON.parse(localStorage.getItem("decorum.openRuns") || "[]")),
  closedRuns: new Set(JSON.parse(localStorage.getItem("decorum.closedRuns") || "[]")),
  renaming: null, // job being renamed
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
  if (t.reward == null) return t.problem ? { word: "failed to run", cls: "failed" } : { word: "not graded yet", cls: "finished" };
  const tests = t.tests || {};
  const detail = tests.f2p_total ? ` · ${tests.f2p_passed} of ${tests.f2p_total} new tests` : "";
  return t.reward >= 1 ? { word: `passed${detail}`, cls: "passed" } : { word: `did not pass${detail}`, cls: "not-passed" };
}
// passed / not-passed / failed / running / ungraded: one word per task result, for colour and counts
function resultKey(t) {
  if (t.status === "running" || t.status === "starting") return "running";
  if (t.reward != null) return t.reward >= 1 ? "passed" : "not-passed";
  if (t.status === "failed" || t.problem) return "failed";
  return "ungraded";
}
const STATUS_WORD = { running: "running", starting: "starting", stalled: "quiet for 10 minutes", finished: "finished", failed: "failed to start" };
const AGENT_WORD = { working: "working", waiting: "waiting", finished: "finished", stopped: "stopped" };

// ---------- runs ----------

const BENCH_WORD = { "SWE-bench Pro": "SWE-bench Pro V2", DeepSWE: "DeepSWE", Replay: "Replay" };
function runOf(job) { return S.runs.find((r) => r.job === job); }
function shortDate(iso) {
  const t = ts(iso);
  if (!isFinite(t)) return "";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(sameYear ? {} : { year: "numeric" }) });
}
function defaultLabel(r) {
  const kind = [r.mode === "single" ? "single agent" : null, r.faux ? "scripted" : null].filter(Boolean).join(", ");
  const when = shortDate(r.started_at);
  return `${BENCH_WORD[r.benchmark] || r.benchmark || "Run"}${when ? `, ${when}` : ` ${r.job}`}${kind ? ` (${kind})` : ""}`;
}
function runLabel(r) { return r.name || defaultLabel(r); }
function runCounts(r) {
  const c = r.counts;
  const parts = [];
  if (c.passed) parts.push(`${c.passed} passed`);
  if (c.not_passed) parts.push(`${c.not_passed} did not pass`);
  if (c.failed) parts.push(`${c.failed} failed to run`);
  if (c.running) parts.push(`${c.running} running`);
  if (c.ungraded) parts.push(`${c.ungraded} not graded`);
  if (r.pending) parts.push(`${r.pending} ${r.status === "running" ? "waiting to start" : "never started"}`);
  return parts.join(" · ") || "no tasks yet";
}
function runBar(r, big) {
  const bar = el("div", `bar${big ? " big" : ""}`);
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", runCounts(r));
  const total = Math.max(r.planned, r.trials.length, 1);
  const segs = [["passed", r.counts.passed], ["not-passed", r.counts.not_passed], ["failed", r.counts.failed], ["running", r.counts.running], ["ungraded", r.counts.ungraded], ["pending", r.pending]];
  for (const [cls, n] of segs) {
    if (!n) continue;
    const seg = el("span", `seg ${cls}`);
    seg.style.flexGrow = String(n);
    seg.title = `${n} ${cls.replace("-", " ")}`;
    bar.append(seg);
  }
  bar.style.setProperty("--total", String(total));
  return bar;
}
function isOpen(r, i) {
  if (S.openRuns.has(r.job)) return true;
  if (S.closedRuns.has(r.job)) return false;
  return r.status === "running" || i === 0 || S.sel?.job === r.job;
}
function toggleRun(job, open) {
  (open ? S.openRuns : S.closedRuns).add(job);
  (open ? S.closedRuns : S.openRuns).delete(job);
  localStorage.setItem("decorum.openRuns", JSON.stringify([...S.openRuns]));
  localStorage.setItem("decorum.closedRuns", JSON.stringify([...S.closedRuns]));
  renderRail();
}

function renderRail() {
  const nav = $("trials");
  if (S.renaming && nav.contains(document.activeElement)) return; // never redraw under someone typing a name
  const keep = nav.scrollTop;
  nav.replaceChildren();
  if (!S.runs.length) nav.append(el("p", "group-label", "No runs yet."));
  S.runs.forEach((r, i) => {
    const open = isOpen(r, i);
    const card = el("section", `run-card${S.runSel === r.job && !S.sel ? " current" : ""}${r.status === "running" ? " live" : ""}`);
    const head = el("div", "run-head-row");
    const tog = el("button", "run-toggle");
    tog.type = "button";
    tog.setAttribute("aria-expanded", String(open));
    tog.setAttribute("aria-label", `${open ? "Hide" : "Show"} the tasks of ${runLabel(r)}`);
    tog.textContent = open ? "▾" : "▸";
    tog.addEventListener("click", () => toggleRun(r.job, !open));
    const name = el("button", "run-name", runLabel(r));
    name.type = "button";
    name.title = "Open this run";
    name.addEventListener("click", () => selectRun(r.job));
    const ren = el("button", "rename-btn", "✎");
    ren.title = "Rename this run";
    ren.type = "button";
    ren.setAttribute("aria-label", `Rename ${runLabel(r)}`);
    ren.addEventListener("click", () => startRename(r.job, name));
    head.append(tog, name, ren);
    card.append(head);
    const meta = el("div", "run-meta");
    const st = el("span", `st ${r.status === "running" ? "running" : r.status === "stopped" ? "stopped" : "finished"}`, r.status === "running" ? "running" : r.status === "stopped" ? "stopped" : "finished");
    meta.append(st, el("span", "", [r.name ? defaultLabel(r) : r.job, r.cost_usd ? money(r.cost_usd) : ""].filter(Boolean).join(" · ")));
    card.append(meta, runBar(r, false), el("div", "run-counts", runCounts(r)));
    if (open) {
      const list = el("div", "run-trials");
      for (const t of r.trials) list.append(trialItem(t));
      if (!r.trials.length) list.append(el("p", "run-empty", r.status === "running" ? "Preparing the first tasks…" : "No task started in this run."));
      card.append(list);
    }
    nav.append(card);
  });
  nav.scrollTop = keep;
}

function trialItem(t) {
  const b = el("button", "trial-item");
  b.type = "button";
  b.setAttribute("aria-current", String(S.sel?.job === t.job && S.sel?.trial === t.trial));
  b.append(el("div", "ti-name", humanTask(t)));
  const line = el("div", "ti-line");
  const o = outcome(t);
  const word = o ? o.word : t.status === "running" && t.started_at ? `running · ${clock((Date.now() - ts(t.started_at)) / 1000)}` : STATUS_WORD[t.status] || t.status;
  line.append(el("span", `st ${o ? o.cls : t.status}`, word));
  if (t.workers) line.append(el("span", "", `${t.workers} worker${t.workers > 1 ? "s" : ""}`));
  if (t.cost_usd) line.append(el("span", "", money(t.cost_usd)));
  b.append(line);
  b.addEventListener("click", () => select(t));
  return b;
}

// ---------- renaming ----------

function startRename(job, anchor) {
  const r = runOf(job);
  if (!r || S.renaming) return;
  S.renaming = job;
  const input = el("input", "rename-input");
  input.type = "text";
  input.maxLength = 80;
  input.value = r.name || "";
  input.placeholder = defaultLabel(r);
  input.setAttribute("aria-label", "Run name (empty restores the default)");
  const parent = anchor.parentNode;
  parent.replaceChild(input, anchor);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() !== (r.name || "")) {
      try {
        const res = await fetch("api/runs/rename", { method: "POST", headers: { "Content-Type": "application/json", "X-Decorum-Viewer": "1" }, body: JSON.stringify({ job, name: input.value }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.status);
        for (const x of S.runs) if (x.job === job) x.name = body.name; // S.runs may have been replaced while typing
        toast(body.name ? `Renamed to “${body.name}”` : "Name cleared");
      } catch (e) {
        toast(`Could not rename: ${e.message}`);
      }
    }
    S.renaming = null;
    if (input.parentNode) input.parentNode.replaceChild(anchor, input);
    renderRail();
    if (S.runSel === job && !S.sel) renderRunOverview();
    if (S.sel?.job === job && S.trial) renderHead();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}
$("r-rename").addEventListener("click", () => { if (S.runSel) startRename(S.runSel, $("r-title")); });
$("r-title").addEventListener("dblclick", () => { if (S.runSel) startRename(S.runSel, $("r-title")); });

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- one run ----------

function selectRun(job) {
  if (S.page === "insights") { S.page = "runs"; $("insights").hidden = true; $("nav-runs").setAttribute("aria-selected", "true"); $("nav-insights").setAttribute("aria-selected", "false"); }
  if (S.runSel !== job) S.teams = null;
  S.runSel = job;
  S.sel = null;
  history.replaceState(null, "", `#run=${encodeURIComponent(job)}${S.runView === "teams" ? "&view=teams" : ""}`);
  if (S.runView === "teams") loadTeams(true);
  $("empty").hidden = true;
  $("trial").hidden = true;
  $("run").hidden = false;
  closeDrawer();
  renderRail();
  renderRunOverview();
}

function cell(child) {
  const td = el("td");
  td.append(child);
  return td;
}

function renderRunOverview() {
  const r = runOf(S.runSel);
  if (!r) return;
  $("r-eyebrow").textContent = [BENCH_WORD[r.benchmark] || r.benchmark || "Run", r.mode === "single" ? "single agent" : "forum", r.job].join(" · ");
  if (S.renaming !== r.job) $("r-title").textContent = runLabel(r);
  const facts = $("r-facts");
  facts.replaceChildren();
  const fact = (label, value) => { if (!value) return; const s = el("span"); s.append(`${label} `); s.append(el("b", "", value)); facts.append(s); };
  fact("Started", shortDate(r.started_at));
  if (r.finished_at) fact("Took", clock((ts(r.finished_at) - ts(r.started_at)) / 1000));
  else if (r.status === "running") fact("Running for", clock((Date.now() - ts(r.started_at)) / 1000));
  fact(r.status === "running" ? "Spent so far" : "Cost", money(r.cost_usd));
  if (r.faux) fact("Agents", "scripted, no model calls");
  else {
    fact("Authority", r.authority_model);
    fact("Workers", r.mode === "forum" ? r.worker_model : null);
  }
  fact("Rulebook", r.rulebook);
  const graded = r.counts.passed + r.counts.not_passed;
  $("r-score").textContent = graded ? `${r.counts.passed} of ${graded} graded tasks passed` : r.status === "running" ? "No task graded yet" : "No task was graded";
  $("r-bar").replaceChildren(runBar(r, true));
  $("r-legend").textContent = runCounts(r);
  const body = $("r-rows");
  body.replaceChildren();
  for (const t of r.trials) {
    const tr = el("tr");
    const c1 = el("td");
    const b = el("button", "row-link", humanTask(t));
    b.type = "button";
    b.addEventListener("click", () => select(t));
    c1.append(b, el("div", "row-sub", repoOf(t)));
    const before = (r.earlier || []).filter((e) => e.task === t.task);
    if (before.length) {
      const prev = el("button", "attempt-link", `attempt ${before.length + 1}; earlier: ${shortReason(before.at(-1).reason)}`);
      prev.type = "button";
      prev.title = "Open the earlier attempt";
      prev.addEventListener("click", () => select(before.at(-1)));
      c1.append(prev);
    }
    const o = outcome(t);
    const tests = t.tests?.f2p_total ? `${t.tests.f2p_passed} / ${t.tests.f2p_total}` : "";
    tr.append(
      c1,
      cell(el("span", `st ${o ? o.cls : t.status}`, o ? (t.reward >= 1 ? "passed" : t.reward == null ? (t.problem ? "failed to run" : "not graded") : "did not pass") : STATUS_WORD[t.status] || t.status)),
      el("td", "num", tests),
      el("td", "num", t.workers ? String(t.workers) : "–"),
      el("td", "num", t.posts ? String(t.posts) : "–"),
      el("td", "num", t.duration_sec ? clock(t.duration_sec) : t.status === "running" && t.started_at ? clock((Date.now() - ts(t.started_at)) / 1000) : "–"),
      el("td", "num", t.cost_usd ? money(t.cost_usd) : "–"),
    );
    if (t.problem) {
      tr.title = t.problem;
      tr.classList.add("has-problem");
    }
    body.append(tr);
  }
  renderRetry(r);
  if (r.pending) {
    const tr = el("tr", "pending-row");
    const td = el("td", "", `${r.pending} more task${r.pending > 1 ? "s" : ""} ${r.status === "running" ? "waiting to start" : "never started"}`);
    td.colSpan = 7;
    tr.append(td);
    body.append(tr);
  }
}

// ---------- one trial ----------

function select(t) {
  if (S.page === "insights") { S.page = "runs"; $("insights").hidden = true; $("nav-runs").setAttribute("aria-selected", "true"); $("nav-insights").setAttribute("aria-selected", "false"); }
  S.sel = { job: t.job, trial: t.trial };
  S.runSel = t.job;
  $("run").hidden = true;
  S.events = []; S.next = 0; S.epoch = null; S.agents = []; S.seenSeq = 0; S.colors = new Map(); S.sig = ""; S.expanded = new Set(); S.firstPaint = true;
  history.replaceState(null, "", `#run=${encodeURIComponent(t.job)}&trial=${encodeURIComponent(t.trial)}`);
  $("empty").hidden = true;
  $("trial").hidden = false;
  $("threads").replaceChildren();
  $("timeline-log").replaceChildren();
  closeDrawer();
  renderRail();
  pollTrial(true);
}

// ---------- retrying failed tasks ----------

const STATE_WORD = { failed: "failed", interrupted: "was interrupted", "not started": "never started", "graded, with an error": "graded after an error" };
function shortReason(reason) {
  if (!reason) return "failed";
  const kind = reason.split(":")[0];
  return /Error$|^[A-Z][A-Za-z]+$/.test(kind) ? kind : reason.slice(0, 60);
}
function renderRetry(r) {
  const box = $("r-retry");
  const rt = r.retry;
  const show = rt && (rt.in_progress || (rt.tasks.length && r.status !== "running"));
  if (!show) {
    box.hidden = true;
    box.dataset.sig = "";
    return;
  }
  const sig = JSON.stringify([r.job, rt.in_progress, rt.tasks.map((x) => x.task), rt.log]);
  if (box.dataset.sig === sig) return; // keep the ticks and the focus between polls
  box.dataset.sig = sig;
  box.hidden = false;
  box.replaceChildren();
  if (rt.in_progress) {
    box.classList.add("live");
    box.append(el("h3", "", "Retrying failed tasks"), el("p", "", "They run again in this run, with the same models, rulebook and time limit, and appear in the table below as they start."));
    if (rt.log) box.append(logDetails(r.job, rt.log));
    return;
  }
  box.classList.remove("live");
  const missing = rt.tasks.filter((x) => x.default).length;
  const graded = rt.tasks.length - missing;
  box.append(el("h3", "", missing ? `${plural(missing, "task")} without a result` : `${plural(graded, "task")} graded after an error`));
  box.append(el("p", "", "Retry runs the ticked tasks again, in this run, with the same models, rulebook and time limit. Each failed attempt is kept and can still be opened. Tasks that were interrupted or never started always run with any retry: Pier runs every task that has no result."));
  if (graded) box.append(el("p", "retry-caution", "A task graded after an error (most often the time limit: the verifier still graded what was left) has a result. It is not ticked: retrying only the tasks that failed, until they pass, raises the pass rate. Tick it if you want it anyway; the summary shows that it took more than one attempt."));
  const list = el("ul", "retry-list");
  for (const x of rt.tasks) {
    const key = `${r.job}/${x.task}`;
    const li = el("li");
    const label = el("label");
    const box1 = el("input");
    box1.type = "checkbox";
    box1.checked = x.always || (S.retryTick.has(key) ? S.retryTick.get(key) : x.default);
    box1.disabled = x.always;
    box1.dataset.task = x.task;
    box1.addEventListener("change", () => {
      S.retryTick.set(key, box1.checked);
      updateRetryButton(r);
    });
    const t = S.trials.find((y) => y.job === r.job && y.trial === x.trial);
    label.append(box1, el("span", "retry-task", t ? humanTask(t) : x.task));
    const why = `${STATE_WORD[x.state] || x.state}${x.reason && !x.always ? `: ${clip(x.reason, 240)}` : ""}${x.always ? " (runs with any retry)" : ""}`;
    li.append(label, el("span", "retry-why", why));
    list.append(li);
  }
  const go = el("button", "primary", "");
  go.type = "button";
  go.id = "retry-go";
  go.addEventListener("click", () => askRetry(r));
  const cmd = el("div", "retry-cmd");
  const code = el("code", "", rt.command);
  const copy = el("button", "", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(rt.command); toast("Command copied"); } catch { toast("Select the command and copy it"); }
  });
  cmd.append(el("span", "ta-sub", "Or in a terminal:"), code, copy);
  const actions = el("div", "retry-actions");
  actions.append(go, cmd);
  box.append(list, actions);
  if (rt.log) box.append(logDetails(r.job, rt.log, "The last retry's output"));
  updateRetryButton(r);
}
function pickedTasks(r) {
  return r.retry.tasks
    .filter((x) => x.always || (S.retryTick.has(`${r.job}/${x.task}`) ? S.retryTick.get(`${r.job}/${x.task}`) : x.default))
    .map((x) => x.task);
}
function updateRetryButton(r) {
  const go = $("retry-go");
  if (!go) return;
  const n = pickedTasks(r).length;
  go.textContent = n ? `Retry ${plural(n, "task")}` : "Retry";
  go.disabled = !n;
}
function logDetails(job, log, label = "Pier's output so far") {
  const d = el("details", "retry-log");
  d.append(el("summary", "", `${label} (${log})`));
  const pre = el("pre", "", "Loading…");
  d.append(pre);
  d.addEventListener("toggle", async () => {
    if (!d.open) return;
    try { pre.textContent = (await getJSON(`api/runs/retry-log?job=${encodeURIComponent(job)}`)).text || "(empty)"; } catch { pre.textContent = "Could not read the log."; }
  });
  return d;
}
function askRetry(r) {
  const tasks = pickedTasks(r);
  if (!tasks.length) return;
  const dlg = $("retry-dialog");
  $("rd-title").textContent = `Retry ${plural(tasks.length, "task")}?`;
  $("rd-text").textContent = `${tasks.length === 1 ? "It runs" : "They run"} again in “${runLabel(r)}” with the same models, rulebook and time limit, and ${tasks.length === 1 ? "costs" : "cost"} model calls like a first attempt. The failed attempts are kept.`;
  $("rd-go").textContent = `Retry ${plural(tasks.length, "task")}`;
  $("rd-go").onclick = async () => {
    dlg.close();
    try {
      const defaults = r.retry.tasks.filter((x) => x.default).map((x) => x.task);
      const all = tasks.length === defaults.length && tasks.every((t) => defaults.includes(t));
      const res = await fetch("api/runs/retry", { method: "POST", headers: { "Content-Type": "application/json", "X-Decorum-Viewer": "1" }, body: JSON.stringify({ job: r.job, ...(all ? {} : { tasks }) }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.status);
      toast(`Retry started: ${plural(body.tasks.length, "task")}`);
      pollTrials();
    } catch (e) {
      toast(`Could not retry: ${e.message}`);
    }
  };
  dlg.showModal();
}
$("rd-cancel").addEventListener("click", () => $("retry-dialog").close());

function clip(text, n = 200) { return text && text.length > n ? `${text.slice(0, n - 1)}…` : text; }
function renderAttempt(t) {
  const box = $("t-attempt");
  const run = runOf(t.job);
  const earlier = run?.earlier || [];
  const mine = earlier.find((e) => e.trial === t.trial);
  const before = earlier.filter((e) => e.task === t.task && e.trial !== t.trial);
  box.replaceChildren();
  if (mine) {
    const latest = run.trials.find((x) => x.task === t.task);
    box.append(`An earlier attempt, set aside when this task was retried${mine.retried_at ? ` on ${shortDate(mine.retried_at)}` : ""}. Why: ${clip(mine.reason) || "it failed"}. `);
    if (latest) {
      const b = el("button", "linkish", "Open the latest attempt");
      b.type = "button";
      b.addEventListener("click", () => select(latest));
      box.append(b);
    }
  } else if (before.length) {
    box.append(`Attempt ${before.length + 1} of this task. The ${before.length > 1 ? "last earlier attempt" : "first attempt"} ended with ${clip(before.at(-1).reason) || "an error"}. `);
    const b = el("button", "linkish", "Open it");
    b.type = "button";
    b.addEventListener("click", () => select(before.at(-1)));
    box.append(b);
  }
  box.hidden = !box.childNodes.length;
}

function renderHead() {
  const t = S.trial;
  const run = runOf(t.job);
  $("t-eyebrow").replaceChildren();
  const back = el("button", "crumb", run ? runLabel(run) : t.job);
  back.type = "button";
  back.title = "Back to this run";
  back.addEventListener("click", () => selectRun(t.job));
  $("t-eyebrow").append(back, ` · ${repoOf(t)}${t.language ? ` · ${t.language}` : ""}`);
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
  renderAttempt(t);
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

function fromHash() {
  const h = location.hash.slice(1);
  if (!h) return null;
  if (h.startsWith("run=")) {
    const q = new URLSearchParams(h);
    if (q.get("view") === "teams" && S.runView !== "teams") { S.runView = "teams"; setTimeout(() => setRunView("teams")); }
    return { job: q.get("run"), trial: q.get("trial") };
  }
  const [job, trial] = h.split("/").map(decodeURIComponent); // the older #job/trial links
  return { job, trial };
}

let firstLoad = true;
function followHash() {
  if (location.hash === "#insights") { if (S.page !== "insights") setPage("insights"); return; }
  const want = fromHash();
  if (!want?.job) return;
  const t = want.trial ? S.trials.find((x) => x.job === want.job && x.trial === want.trial) : null;
  if (t) { if (S.sel?.job !== t.job || S.sel?.trial !== t.trial) select(t); }
  else if (runOf(want.job) && (S.sel || S.runSel !== want.job)) selectRun(want.job);
}
window.addEventListener("hashchange", followHash); // a pasted link, or back and forward
async function pollTrials() {
  try {
    const d = await getJSON("api/runs");
    S.runs = d.runs;
    S.trials = d.runs.flatMap((r) => [...r.trials, ...(r.earlier || [])]);
    renderRail();
    if (S.runSel && !S.sel) { renderRunOverview(); loadTeams(false); }
    if (S.page === "insights") { renderInsightsFilters(); loadInsights(false); }
    $("updated").textContent = S.paused ? "Updates paused" : `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    if (firstLoad) {
      firstLoad = false;
      if (location.hash === "#insights") { setPage("insights"); return; }
      const want = fromHash();
      const t = want?.trial ? S.trials.find((x) => x.job === want.job && x.trial === want.trial) : null;
      if (t) select(t);
      else if (want?.job && runOf(want.job)) selectRun(want.job);
      else if (S.runs.length) selectRun(S.runs[0].job);
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
  if (e.key === "Escape" && !S.drawer && S.sel) { selectRun(S.sel.job); return; }
  if (e.key === "Escape") closeDrawer();
  if (e.key === "t" || e.key === "T") setView("threads");
  if (e.key === "l" || e.key === "L") setView("timeline");
});

// analysis.js loads after this file and defines the analysis pages: start once both are in.
window.addEventListener("DOMContentLoaded", () => {
  pollTrials();
  setInterval(pollTrials, 3000);
  setInterval(() => pollTrial(false), 1500);
});
