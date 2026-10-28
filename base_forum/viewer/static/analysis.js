// Forum Decorum viewer: a run's Team analysis tab and the Insights across runs page. Loaded after app.js, whose
// helpers it uses ($, el, S, money, clock, humanTask, resultKey, runLabel, select, selectRun).
"use strict";

// ---------- a run's team analysis ----------

const ROLES = [
  ["implementer", "var(--a0)"], ["tester", "var(--a4)"], ["reviewer", "var(--a6)"], ["investigator", "var(--a3)"],
];
const ROLE_COLOR = Object.fromEntries(ROLES);
const OUT = { passed: ["passed", "var(--a5)"], "not-passed": ["did not pass", "var(--a1)"], failed: ["failed to run", "var(--soft)"], running: ["running", "var(--running)"], ungraded: ["not graded", "var(--faint)"] };
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
function teamWords(team) {
  const c = {};
  for (const w of team) c[w.role] = (c[w.role] || 0) + 1;
  return ROLES.filter(([r]) => c[r]).map(([r]) => (c[r] > 1 ? plural(c[r], r) : r)).join(", ") || "no workers";
}
function swatch(color, label) {
  const s = el("span", "ta-key");
  const i = el("i");
  i.style.background = color;
  s.append(i, label);
  return s;
}
S.runView = "tasks";
S.teams = null;
function setRunView(v) {
  S.runView = v;
  $("rt-tasks").setAttribute("aria-selected", String(v === "tasks"));
  $("rt-teams").setAttribute("aria-selected", String(v === "teams"));
  $("r-tasks-view").hidden = v !== "tasks";
  $("r-teams-view").hidden = v !== "teams";
  if (S.runSel) history.replaceState(null, "", `#run=${encodeURIComponent(S.runSel)}${v === "teams" ? "&view=teams" : ""}`);
  if (v === "teams") loadTeams(true);
}
$("rt-tasks").addEventListener("click", () => setRunView("tasks"));
$("rt-teams").addEventListener("click", () => setRunView("teams"));
async function loadTeams(force) {
  const job = S.runSel;
  if (!job || (S.runView !== "teams")) return;
  if (!force && S.teams?.job === job && Date.now() - S.teams.at < 10000) return;
  try {
    const d = await getJSON(`api/teams?job=${encodeURIComponent(job)}`);
    if (job !== S.runSel) return;
    S.teams = { job, at: Date.now(), d };
    renderTeams(d);
  } catch (e) { /* the run page stays as it was */ }
}
function renderTeams(d) {
  const tasks = d.tasks;
  const staffed = tasks.filter((t) => t.team.length);
  const sizes = staffed.map((t) => t.team.length).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : 0;
  const has = (role) => staffed.filter((t) => t.team.some((w) => w.role === role)).length;
  const sentTasks = staffed.filter((t) => t.sent_back).length;
  const sent = staffed.reduce((a, t) => a + t.sent_back, 0);
  const lede = [];
  if (staffed.length) {
    lede.push(`The authority staffed ${plural(staffed.length, "task")} with ${sizes[0] === sizes.at(-1) ? sizes[0] : `${sizes[0]} to ${sizes.at(-1)}`} workers${sizes[0] === sizes.at(-1) ? "" : ` (median ${median})`}.`);
    const an = (r) => (/^[aeiou]/.test(r) ? `an ${r}` : `a ${r}`);
    const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
    const every = ROLES.map(([r]) => r).filter((r) => has(r) === staffed.length);
    const some = ROLES.map(([r]) => r).filter((r) => has(r) && has(r) < staffed.length);
    const bits = [];
    if (every.length) bits.push(`Every team had ${list(every.map(an))}`);
    if (some.length) bits.push(`${list(some.map((r) => `${has(r)} had ${an(r)}`))}`);
    if (bits.length) lede.push(bits.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".");
    lede.push(sent ? `The authority sent work back ${plural(sent, "time")}, in ${plural(sentTasks, "task")}.` : "The authority never sent work back.");
  } else lede.push("No task in this run has a team yet.");
  $("ta-lede").textContent = lede.join(" ");

  // setup
  const dl = $("ta-setup");
  dl.replaceChildren();
  const row = (k, v) => { if (v == null || v === "") return; const g = el("div"); g.append(el("dt", "", k), el("dd", "", String(v))); dl.append(g); };
  const rb = d.setup?.rulebook || {};
  const bud = rb.budget || {};
  const m = d.setup?.models || {};
  const r = d.run;
  row("Benchmark", `${BENCH_WORD[r.benchmark] || r.benchmark || "unknown"}, ${plural(r.planned, "task")}`);
  row("Authority", r.faux ? "scripted" : `${m.authority || r.authority_model}${m.authority_thinking ? `, thinking ${m.authority_thinking}` : ""}`);
  row("Workers", r.faux ? "scripted" : `${m.worker || r.worker_model}${m.worker_thinking ? `, thinking ${m.worker_thinking}` : ""}`);
  row("Rulebook", rb.name || r.rulebook);
  if (bud.min_workers_total != null || bud.max_workers_total != null) row("Team size", `${bud.min_workers_total || 0} to ${bud.max_workers_total ?? "any"} workers, at most ${bud.max_live_workers ?? "any"} at once`);
  row("Authority's role", rb.authority === "manager" ? "manages only; workers change the code" : rb.authority === "player" ? "manages and may code" : null);
  row("Workspace", rb.workspace === "shared" ? "one shared checkout" : rb.workspace === "isolated" ? "a worktree per worker" : rb.workspace);
  row("Budget per task", bud.usd_per_trial != null ? money(bud.usd_per_trial) : null);
  row("Time per task", bud.wall_clock_sec ? clock(bud.wall_clock_sec) : null);
  row("Commits", d.setup?.commit_policy === "leave" ? "nobody commits; the grader reads the working tree" : d.setup?.commit_policy === "commit" ? "the authority commits" : null);

  // result by team size
  const lo = Math.min(bud.min_workers_total || sizes[0] || 1, sizes[0] || 99), hi = Math.max(bud.max_workers_total || 0, sizes.at(-1) || 0);
  const box = $("ta-size");
  box.replaceChildren();
  for (let n = lo; n <= hi; n++) {
    const col = el("div", "ta-col");
    const dots = el("div", "ta-dots");
    const here = staffed.filter((t) => t.team.length === n).sort((a, b) => Object.keys(OUT).indexOf(resultKey(a)) - Object.keys(OUT).indexOf(resultKey(b)));
    for (const t of here) {
      const dot = el("button", "ta-dot");
      dot.type = "button";
      dot.style.background = OUT[resultKey(t)][1];
      dot.title = `${humanTask(t)}: ${OUT[resultKey(t)][0]}`;
      dot.setAttribute("aria-label", dot.title);
      dot.addEventListener("click", () => { const full = S.trials.find((x) => x.job === S.runSel && x.trial === t.trial); if (full) select(full); });
      dots.append(dot);
    }
    const graded = here.filter((t) => t.reward != null);
    col.append(dots, el("div", "ta-x", `${n} workers`), el("div", "ta-sub", here.length ? (graded.length ? `${graded.filter((t) => t.reward >= 1).length} of ${graded.length} passed` : plural(here.length, "task")) : "none"));
    box.append(col);
  }

  // result with and without each role
  const rbox = $("ta-roles");
  rbox.replaceChildren();
  const gradedTasks = staffed.filter((t) => t.reward != null);
  const rate = (list) => [list.filter((t) => t.reward >= 1).length, list.length];
  for (const [role, color] of ROLES) {
    const withR = gradedTasks.filter((t) => t.team.some((w) => w.role === role));
    const without = gradedTasks.filter((t) => !t.team.some((w) => w.role === role));
    if (!withR.length && !without.length) continue;
    const g = el("div", "ta-role");
    const head = el("div", "ta-role-head");
    head.append(swatch(color, role));
    if (!without.length) head.append(el("span", "ta-sub", "on every team"));
    else if (!withR.length) head.append(el("span", "ta-sub", "on no team"));
    g.append(head);
    for (const [label, list] of [["with", withR], ["without", without]]) {
      if (!list.length) continue;
      const [p, n] = rate(list);
      const line = el("div", "ta-rate");
      const bar = el("div", "ta-track");
      const fill = el("i");
      fill.style.width = `${(100 * p) / n}%`;
      bar.append(fill);
      line.append(el("span", "ta-lbl", label), bar, el("span", "ta-num", `${p} of ${n}`));
      g.append(line);
    }
    rbox.append(g);
  }
  const lg = $("ta-legend");
  lg.replaceChildren(el("span", "ta-sub", "Results"), ...["passed", "not-passed", "failed"].map((k) => swatch(OUT[k][1], OUT[k][0])), el("span", "ta-gap"), el("span", "ta-sub", "Roles"), ...ROLES.map(([r, c]) => swatch(c, r)));

  // who worked on what
  const body = $("ta-rows");
  body.replaceChildren();
  const maxPosts = Math.max(1, ...tasks.map((t) => t.posts_authority + t.posts_workers));
  for (const t of tasks) {
    const tr = el("tr");
    const c1 = el("td");
    const b = el("button", "row-link", humanTask(t));
    b.type = "button";
    b.addEventListener("click", () => { const full = S.trials.find((x) => x.job === S.runSel && x.trial === t.trial); if (full) select(full); });
    c1.append(b, el("div", "row-sub", t.repository || t.task.split("-")[0]));
    const k = resultKey(t);
    const team = el("td", "ta-team");
    const chips = el("div", "ta-chips");
    for (const w of t.team) {
      const c = el("span", `ta-chip${w.sent_back ? " back" : ""}`);
      c.style.setProperty("--c", ROLE_COLOR[w.role] || "var(--a7)");
      c.title = `${w.worker}, ${w.role}: ${w.persona}${w.title ? ` (thread “${w.title}”)` : ""}${w.sent_back ? `; sent back ${plural(w.sent_back, "time")}` : ""}`;
      c.textContent = w.worker;
      chips.append(c);
    }
    team.append(chips, el("div", "row-sub", t.team.length ? teamWords(t.team) : "no team"));
    const talk = el("td", "ta-talk");
    if (t.posts_authority + t.posts_workers) {
      const bar = el("div", "ta-split");
      bar.style.width = `${(100 * (t.posts_authority + t.posts_workers)) / maxPosts}%`;
      const a = el("i", "a"); a.style.flexGrow = t.posts_authority;
      const w = el("i", "w"); w.style.flexGrow = t.posts_workers;
      bar.append(a, w);
      talk.append(bar, el("div", "row-sub", `${t.posts_authority} and ${t.posts_workers}`));
    } else talk.textContent = "–";
    tr.append(c1, cell(el("span", `st ${k === "not-passed" ? "not-passed" : k === "passed" ? "passed" : k}`, OUT[k][0])), team,
      el("td", "num", t.threads ? String(t.threads) : "–"), talk,
      el("td", "num", t.sent_back ? String(t.sent_back) : "–"), el("td", "num", t.refusals ? String(t.refusals) : "–"),
      el("td", "num", t.cost_usd ? money(t.cost_usd) : "–"), el("td", "num", t.duration_sec ? clock(t.duration_sec) : "–"));
    body.append(tr);
  }
  $("ta-note").textContent = `Roles are guessed from each worker's persona and thread title (reviewer, tester, investigator; anything else counts as an implementer); hover a name for its persona. “Sent back” counts the authority posting in a worker's thread after that worker had finished. With ${plural(gradedTasks.length, "graded task")}, these charts describe this run; they do not show that a team shape causes a result.`;
}

// ---------- insights across runs ----------

// Topic colours follow the role colours (implementation is the implementer's blue, and so on); plan is teal. Checked
// with the dataviz palette validator (CVD and normal-vision separation, light and dark); every use carries a label.
const KINDS = [["plan", "var(--a2)"], ["investigation", "var(--a3)"], ["implementation", "var(--a0)"], ["tests", "var(--a4)"], ["review", "var(--a6)"]];
const KIND_COLOR = Object.fromEntries(KINDS);
const IN = { bench: "all", extra: false, off: new Set(), data: null, at: 0 };
// The three pages: a run (or a task), Insights across runs, and New run.
function setPage(page) {
  S.page = page;
  $("nav-runs").setAttribute("aria-selected", String(page === "runs"));
  $("nav-insights").setAttribute("aria-selected", String(page === "insights"));
  $("nav-new").setAttribute("aria-current", page === "new" ? "page" : "false");
  $("insights").hidden = page !== "insights";
  $("newrun").hidden = page !== "new";
  if (page === "runs") return;
  $("run").hidden = true; $("trial").hidden = true; $("empty").hidden = true;
  S.sel = null; S.runSel = null;
  closeDrawer();
  history.replaceState(null, "", page === "new" ? "#new" : "#insights");
  renderRail();
  if (page === "insights") { renderInsightsFilters(); loadInsights(true); }
  if (page === "new") NewRun.show();
}
$("nav-new").addEventListener("click", () => setPage("new"));
$("nav-insights").addEventListener("click", () => setPage("insights"));
$("nav-runs").addEventListener("click", () => { setPage("runs"); if (S.runs.length) selectRun(S.runs[0].job); });
function inRuns() {
  return S.runs.filter((r) => (IN.extra || (!r.faux && r.benchmark !== "Replay")) && (IN.bench === "all" || r.benchmark === IN.bench));
}
// The filters are rebuilt only when the list of runs changes; otherwise their pressed state is set in place, so a
// poll never takes the keyboard focus away from a button.
function renderInsightsFilters() {
  const bench = $("in-bench");
  if (!bench.children.length) {
    for (const [k, label] of [["all", "All benchmarks"], ["DeepSWE", "DeepSWE"], ["SWE-bench Pro", "SWE-bench Pro V2"]]) {
      const b = el("button", "", label);
      b.type = "button";
      b.dataset.bench = k;
      b.addEventListener("click", () => { IN.bench = k; renderInsightsFilters(); loadInsights(true); });
      bench.append(b);
    }
  }
  for (const b of bench.children) b.setAttribute("aria-pressed", String(IN.bench === b.dataset.bench));
  $("in-extra").checked = IN.extra;
  const box = $("in-runs");
  const runs = inRuns();
  const sig = JSON.stringify(runs.map((r) => [r.job, runLabel(r)]));
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren();
    for (const r of runs) {
      const b = el("button", "in-run", runLabel(r));
      b.type = "button";
      b.dataset.job = r.job;
      b.title = r.job;
      b.addEventListener("click", () => { IN.off.has(r.job) ? IN.off.delete(r.job) : IN.off.add(r.job); renderInsightsFilters(); loadInsights(true); });
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute("aria-pressed", String(!IN.off.has(b.dataset.job)));
}
$("in-extra").addEventListener("change", (e) => { IN.extra = e.target.checked; renderInsightsFilters(); loadInsights(true); });
function selectedJobs() { return inRuns().filter((r) => !IN.off.has(r.job)).map((r) => r.job); }
async function loadInsights(force) {
  if (S.page !== "insights") return;
  if (!force && Date.now() - IN.at < 15000) return;
  const jobs = selectedJobs();
  IN.at = Date.now();
  if (!jobs.length) { IN.data = { runs: [] }; renderInsights(); return; }
  try {
    IN.data = await getJSON(`api/insights?jobs=${encodeURIComponent(jobs.join(","))}`);
    renderInsights();
  } catch (e) { /* keep what is shown */ }
}
function openTask(job, trial) {
  const t = S.trials.find((x) => x.job === job && x.trial === trial);
  if (t) { setPage("runs"); select(t); }
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function fmt1(x) { return (Math.round(x * 10) / 10).toString(); }
function renderInsights() {
  const runs = IN.data?.runs || [];
  const tasks = runs.flatMap((d) => d.tasks.map((t) => ({ ...t, job: d.run.job, runName: runLabel(d.run), run: d.run })));
  const graded = tasks.filter((t) => t.reward != null);
  const passed = graded.filter((t) => t.reward >= 1);
  const staffed = tasks.filter((t) => t.team.length);
  const threads = staffed.flatMap((t) => t.thread_list);
  $("in-lede").textContent = runs.length
    ? `${plural(runs.length, "run")}, ${plural(tasks.length, "task")}: ${passed.length} of ${graded.length} graded tasks passed. Teams averaged ${fmt1(mean(staffed.map((t) => t.team.length)))} workers and ${fmt1(mean(staffed.map((t) => t.threads)))} threads; the authority sent work back in ${staffed.filter((t) => t.sent_back).length} of ${staffed.length} tasks.`
    : "No runs selected. Pick a benchmark or tick a run above.";
  const benches = [...new Set(runs.map((d) => d.run.benchmark).filter((b) => b && b !== "Replay"))];
  $("in-banner").textContent = `${plural(tasks.length, "task")} in ${plural(runs.length, "run")}${benches.length > 1 ? `, from ${benches.length} benchmarks (their tasks are not comparable)` : ""}, one attempt each. These views describe what happened. At this size they cannot show that a team shape or setting causes a result: a single run of a task varies by several points, and bigger teams also spend more.`;

  // runs side by side
  const rb = $("in-runrows");
  rb.replaceChildren();
  for (const d of runs) {
    const ts = d.tasks, st = ts.filter((t) => t.team.length), g = ts.filter((t) => t.reward != null);
    const tr = el("tr");
    const c1 = el("td");
    const b = el("button", "row-link", runLabel(d.run));
    b.type = "button";
    b.addEventListener("click", () => { setPage("runs"); selectRun(d.run.job); });
    const rbName = (d.run.rulebook || "").split("/").pop().replace(/\.ya?ml$/, "");
    c1.append(b, el("div", "row-sub", [BENCH_WORD[d.run.benchmark] || d.run.benchmark, rbName && `rulebook ${rbName}`, d.run.faux ? "scripted" : d.run.authority_model].filter(Boolean).join(", ")));
    const costs = ts.map((t) => t.cost_usd).filter((x) => x), times = ts.map((t) => t.duration_sec).filter((x) => x);
    tr.append(c1, el("td", "num", g.length ? `${g.filter((t) => t.reward >= 1).length} of ${g.length}` : "–"),
      el("td", "num", st.length ? fmt1(mean(st.map((t) => t.team.length))) : "–"), el("td", "num", st.length ? fmt1(mean(st.map((t) => t.threads))) : "–"),
      el("td", "num", st.length ? fmt1(mean(st.map((t) => t.posts_authority + t.posts_workers))) : "–"),
      el("td", "num", String(st.reduce((a, t) => a + t.sent_back, 0))), el("td", "num", String(st.reduce((a, t) => a + t.refusals, 0))),
      el("td", "num", costs.length ? money(mean(costs)) : "–"), el("td", "num", times.length ? clock(mean(times)) : "–"));
    rb.append(tr);
  }

  // cost and result strip per run
  const cbox = $("in-cost");
  cbox.replaceChildren();
  const maxCost = Math.max(0.01, ...tasks.map((t) => t.cost_usd || 0));
  for (const d of runs) {
    const row = el("div", "in-strip");
    row.append(el("div", "in-strip-name", runLabel(d.run)));
    const lane = el("div", "in-lane");
    for (const t of d.tasks) {
      const k = resultKey(t);
      const dot = el("button", "ta-dot");
      dot.type = "button";
      dot.style.left = `calc(${(100 * (t.cost_usd || 0)) / maxCost}% - 8px)`;
      dot.style.background = OUT[k][1];
      dot.title = `${humanTask(t)}: ${OUT[k][0]}, ${money(t.cost_usd || 0)}`;
      dot.setAttribute("aria-label", dot.title);
      dot.addEventListener("click", () => openTask(d.run.job, t.trial));
      lane.append(dot);
    }
    row.append(lane);
    cbox.append(row);
  }
  if (runs.length) {
    const axis = el("div", "in-axis");
    axis.append(el("span", "", "$0"), el("span", "", money(maxCost / 2)), el("span", "", money(maxCost)));
    cbox.append(axis);
  }

  // thread topics
  const kbox = $("in-kinds");
  kbox.replaceChildren();
  const maxN = Math.max(1, ...KINDS.map(([k]) => threads.filter((th) => th.kind === k).length));
  for (const [k, color] of KINDS) {
    const ths = threads.filter((th) => th.kind === k);
    if (!ths.length) continue;
    const back = ths.filter((th) => th.sent_back).length;
    const line = el("div", "in-kind");
    const bar = el("div", "ta-track");
    const fill = el("i");
    fill.style.width = `${(100 * ths.length) / maxN}%`;
    fill.style.background = color;
    bar.append(fill);
    line.append(swatch(color, k), bar, el("span", "ta-num", String(ths.length)), el("span", "ta-sub", `${fmt1(mean(ths.map((th) => th.posts)))} posts each${back ? `, ${back} sent back` : ""}`));
    kbox.append(line);
  }

  // phases: one strip per task
  const pbox = $("in-phases");
  pbox.replaceChildren();
  const shown = staffed.slice(0, 40);
  for (const t of shown) {
    const t0 = ts(t.first_at || t.started_at);
    const ends = t.thread_list.map((th) => ts(th.closed_at || th.last_at)).filter(isFinite);
    const t1 = Math.max(t0 + 1000, ...ends);
    const row = el("div", "in-phase");
    const name = el("button", "row-link in-phase-name", humanTask(t));
    name.type = "button";
    name.title = `${t.runName}: ${humanTask(t)}`;
    name.addEventListener("click", () => openTask(t.job, t.trial));
    const lane = el("div", "in-phase-lane");
    t.thread_list.forEach((th, i) => {
      const a = ts(th.opened_at), b = ts(th.closed_at || th.last_at);
      if (!isFinite(a)) return;
      const bar = el("i", `in-th${th.sent_back ? " back" : ""}`);
      bar.style.left = `${(100 * (a - t0)) / (t1 - t0)}%`;
      bar.style.width = `max(4px, ${(100 * (Math.max(b, a) - a)) / (t1 - t0)}%)`;
      bar.style.top = `${(i % 6) * 5}px`;
      bar.style.background = KIND_COLOR[th.kind];
      bar.title = `${th.title} (${th.kind}): ${plural(th.posts, "post")}${th.sent_back ? `, sent back ${plural(th.sent_back, "time")}` : ""}`;
      lane.append(bar);
    });
    const k = resultKey(t);
    const nameBox = el("div", "in-phase-who");
    nameBox.append(name, el("div", "row-sub", t.runName));
    row.append(nameBox, lane, el("span", `st ${k}`, OUT[k][0]));
    pbox.append(row);
  }
  if (staffed.length > shown.length) pbox.append(el("p", "ta-sub", `Showing the first ${shown.length} of ${staffed.length} tasks.`));
  const lg = el("div", "ta-legend");
  lg.append(el("span", "ta-sub", "Topics"), ...KINDS.map(([k, c]) => swatch(c, k)));
  pbox.prepend(lg);

  // the same task across runs
  const m = $("in-matrix");
  m.replaceChildren();
  const taskIds = [...new Set(tasks.map((t) => t.task))].sort();
  const head = el("tr");
  head.append(el("th", "", "Task"));
  for (const d of runs) { const th = el("th", "in-mcol", runLabel(d.run)); th.scope = "col"; head.append(th); }
  const thead = el("thead"); thead.append(head);
  const tbody = el("tbody");
  for (const id of taskIds) {
    const tr = el("tr");
    const any = tasks.find((t) => t.task === id);
    const c1 = el("td"); c1.append(el("div", "in-mtask", humanTask(any)), el("div", "row-sub", any.repository || id.split("-")[0]));
    tr.append(c1);
    for (const d of runs) {
      const t = d.tasks.find((x) => x.task === id);
      const td = el("td", "in-mcell");
      if (t) {
        const k = resultKey(t);
        const b = el("button", "in-mbtn");
        b.type = "button";
        b.append(el("span", `st ${k}`, OUT[k][0]), el("span", "row-sub", t.team.length ? `${plural(t.team.length, "worker")}${t.cost_usd ? `, ${money(t.cost_usd)}` : ""}` : ""));
        b.addEventListener("click", () => openTask(d.run.job, t.trial));
        td.append(b);
      } else td.textContent = "–";
      tr.append(td);
    }
    tbody.append(tr);
  }
  m.append(thead, tbody);
  $("in-note").textContent = "Topics are guessed from each thread's title and goal by keywords; roles from each worker's persona. Results are per task, never averaged across benchmarks.";
}

// search
$("in-search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("in-q").value.trim();
  const list = $("in-hits");
  list.replaceChildren();
  document.querySelector(".in-more")?.remove();
  if (!q) return;
  const jobs = selectedJobs();
  if (!jobs.length) {
    $("in-search-sum").textContent = "Tick at least one run above to search it.";
    return;
  }
  $("in-search-sum").textContent = "Searching…";
  try {
    const d = await getJSON(`api/search?q=${encodeURIComponent(q)}&jobs=${encodeURIComponent(jobs.join(","))}`);
    $("in-search-sum").textContent = d.total ? `${plural(d.total, "match")} for “${q}”${d.more ? `, newest ${d.hits.length} shown` : ""}.` : `Nothing in the selected runs says “${q}”.`;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const h of d.hits) {
      const li = el("li", "in-hit");
      const top = el("div", "in-hit-top");
      const who = el("span", "who", h.author || "?");
      who.style.setProperty("--c", h.role === "authority" ? "var(--a0)" : ROLE_COLOR[h.role] || "var(--a7)");
      top.append(who, el("span", "ta-sub", `${h.role && h.role !== "authority" ? `${h.role}, ` : ""}${h.kind} in “${h.thread_title || h.thread}”`));
      const where = el("button", "row-link in-hit-where", `${h.title || h.task}`);
      where.type = "button";
      where.addEventListener("click", () => openTask(h.job, h.trial));
      const text = el("p", "in-hit-text");
      // show the text around the first match, with every match marked
      const low = h.text.toLowerCase();
      const at = Math.max(0, low.indexOf(words[0]) - 120);
      const snip = (at ? "…" : "") + h.text.slice(at, at + 360) + (h.text.length > at + 360 ? "…" : "");
      const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
      snip.split(re).forEach((part, i) => text.append(i % 2 ? el("mark", "", part) : document.createTextNode(part)));
      li.append(top, text, el("div", "in-hit-foot")); 
      li.lastChild.append(where, el("span", "ta-sub", ` in ${h.run}${h.earlier ? ", an earlier attempt" : ""}`));
      if (list.children.length >= 5) li.hidden = true;
      list.append(li);
    }
    if (d.hits.length > 5) {
      const more = el("button", "in-more", `Show all ${d.hits.length}`);
      more.type = "button";
      more.addEventListener("click", () => { for (const li of list.children) li.hidden = false; more.remove(); });
      list.after(more);
    }
  } catch (err) { $("in-search-sum").textContent = "Search failed; is the viewer server running?"; }
});
