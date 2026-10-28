// Forum Decorum viewer: the New run page (the run sheet). Choose a benchmark, its tasks, the team and the limits; the
// sheet on the right says what will happen and starts it (POST /api/runs/start). Loaded after app.js and analysis.js,
// whose helpers it uses ($, el, S, toast, getJSON, pollTrials, selectRun, runLabel, shortDate); everything else is
// kept inside this function so that no name collides with theirs.
(() => {
"use strict";


const BANDS = ["easy", "medium", "hard", "very hard"];
const LANG_WORD = { js: "JavaScript", ts: "TypeScript", javascript: "JavaScript", typescript: "TypeScript", go: "Go", python: "Python", rust: "Rust" };
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const MODELS = [
  { id: "moonshotai/kimi-k3", name: "Kimi K3", maker: "Moonshot" },
  { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", maker: "Moonshot" },
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", maker: "OpenAI" },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra", maker: "OpenAI" },
  { id: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5", maker: "Anthropic" },
  { id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5", maker: "Anthropic" },
];
// Ordered by what the literature supports: at 10 to 50 tasks nothing reliably beats a seeded random draw
// (2506.07673, 2510.08730); difficulty strata cover every band (2610.29927) but have no direct test on agents yet.
const MODES = [
  ["random", "At random", "Drawn at random. Keep the seed to run the same tasks again"],
  ["difficulty", "By difficulty", "Spread over how hard the tasks are, and over repositories"],
  ["same", "Same as a run", "The tasks of an earlier run, for a fair comparison"],
  ["pick", "Pick them", "Search, filter and tick tasks one by one"],
  ["paste", "Paste a list", "Task ids, one per line or separated by commas"],
  ["number", "The first N", "In the benchmark's own order; it leans on a few repositories"],
];

function langWord(l) { return LANG_WORD[l] || (l ? l[0].toUpperCase() + l.slice(1) : "?"); }
function modelName(id) { return (MODELS.find((m) => m.id === id) || { name: id }).name; }

// a small, fast, seeded generator (mulberry32): the same seed gives the same tasks
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(xs, seed) {
  const r = rng(seed);
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function narrow(tasks, f) {
  const q = (f.q || "").toLowerCase();
  return tasks.filter((t) =>
    (!f.repo || t.repo === f.repo) && (!f.language || t.language === f.language) && (!f.band || t.band === f.band) &&
    (!f.category || t.category === f.category || (t.categories || []).includes(f.category)) && (!f.hard51 || t.hard51) &&
    (!q || t.id.toLowerCase().includes(q) || (t.title || "").toLowerCase().includes(q) || t.repo.toLowerCase().includes(q)));
}

// Round-robin over repositories so that a draw does not pile onto the largest one.
function spreadByRepo(xs) {
  const by = new Map();
  for (const t of xs) (by.get(t.repo) || by.set(t.repo, []).get(t.repo)).push(t);
  const lanes = [...by.values()];
  const out = [];
  for (let i = 0; out.length < xs.length; i++) for (const l of lanes) if (i < l.length) out.push(l[i]);
  return out;
}

// How many tasks per band: in proportion to the pool ("match"), the same in each ("even"), or set by hand.
function allocate(n, pool, mix, custom) {
  const have = Object.fromEntries(BANDS.map((b) => [b, pool.filter((t) => t.band === b).length]));
  if (mix === "custom") return Object.fromEntries(BANDS.map((b) => [b, Math.min(have[b], custom[b] || 0)]));
  const total = BANDS.reduce((a, b) => a + have[b], 0) || 1;
  const want = Object.fromEntries(BANDS.map((b) => [b, mix === "even" ? n / BANDS.length : (n * have[b]) / total]));
  const got = Object.fromEntries(BANDS.map((b) => [b, Math.min(have[b], Math.floor(want[b]))]));
  // hand out the remainder to the bands with the largest fractions that still have tasks
  let left = Math.min(n, total) - BANDS.reduce((a, b) => a + got[b], 0);
  const order = BANDS.slice().sort((x, y) => (want[y] - Math.floor(want[y])) - (want[x] - Math.floor(want[x])));
  while (left > 0) {
    let moved = false;
    for (const b of order) if (left > 0 && got[b] < have[b]) { got[b]++; left--; moved = true; }
    if (!moved) break;
  }
  return got;
}

function parsePaste(text, tasks) {
  const tokens = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const found = [], unknown = [], ambiguous = [];
  for (const tok of tokens) {
    if (byId.has(tok)) { found.push(byId.get(tok)); continue; }
    const low = tok.toLowerCase().replace(/^instance_/, "");
    const hits = tasks.filter((t) => t.id.toLowerCase().replace(/^instance_/, "").startsWith(low) || t.id.toLowerCase().includes(low));
    if (hits.length === 1) found.push(hits[0]);
    else if (hits.length > 1) ambiguous.push([tok, hits.length]);
    else unknown.push(tok);
  }
  return { found: [...new Set(found)], unknown, ambiguous };
}

// The tasks a set of choices selects, in run order.
function pickTasks(bench, st) {
  const all = bench.tasks;
  const pool = narrow(all, st.filters);
  const n = Math.max(0, Math.min(st.n, pool.length));
  if (st.mode === "paste") return parsePaste(st.paste, all).found;
  if (st.mode === "pick") return all.filter((t) => st.picked.has(t.id));
  if (st.mode === "same") {
    const r = (st.sameRuns || [])[st.sameRun || 0];
    const byId = new Map(all.map((t) => [t.id, t]));
    return r ? r.ids.map((id) => byId.get(id)).filter(Boolean) : [];
  }
  if (st.mode === "number") {
    if (st.order === "first") return pool.slice(0, n);
    const step = pool.length / Math.max(n, 1);
    return Array.from({ length: n }, (_, i) => pool[Math.floor(i * step)]);
  }
  if (st.mode === "random") return shuffled(pool, st.seed).slice(0, n);
  // by difficulty
  const per = allocate(n, pool, st.mix, st.custom);
  const out = [];
  for (const b of BANDS) {
    let lane = shuffled(pool.filter((t) => t.band === b), st.seed + BANDS.indexOf(b));
    if (st.spread) lane = spreadByRepo(lane);
    out.push(...lane.slice(0, per[b]));
  }
  return out;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
// Wilson 95% interval for a pass rate measured on n tasks
function wilson(p, n, z = 1.96) {
  if (!n) return [0, 1];
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function stats(bench, sel) {
  const solved = sel.map((t) => t.solve).filter((x) => x != null);
  const benchSolve = mean(bench.tasks.map((t) => t.solve).filter((x) => x != null));
  const count = (key) => {
    const m = new Map();
    for (const t of sel) m.set(t[key], (m.get(t[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    n: sel.length,
    bands: Object.fromEntries(BANDS.map((b) => [b, sel.filter((t) => t.band === b).length])),
    langs: count("language"),
    repos: count("repo"),
    solve: mean(solved),
    benchSolve,
    ci50: wilson(0.5, sel.length),
    // as an estimate of the whole benchmark's score: the finite-population correction
    fpc: Math.sqrt(Math.max(0, (bench.tasks.length - sel.length) / Math.max(1, bench.tasks.length - 1))),
  };
}


// ---------- the page ----------


const LANG_SWATCH = { go: "var(--a2)", python: "var(--a0)", ts: "var(--a6)", typescript: "var(--a6)", js: "var(--a3)", javascript: "var(--a3)", rust: "var(--a1)" };
const BAND_WORD = { easy: "Easy", medium: "Medium", hard: "Hard", "very hard": "Very hard" };

let CAT = null; // /api/catalog's benchmarks
let CAT_START = true;
const ST = {
  benchKey: "swebenchpro", sameRuns: [], scripted: false, busy: false,
  mode: "random", n: 10, seed: 7, order: "first", paste: "", picked: new Set(), sameRun: 0,
  filters: { repo: "", language: "", band: "", category: "", hard51: false, q: "" },
  mix: "match", custom: { easy: 3, medium: 3, hard: 2, "very hard": 2 }, spread: true,
  team: { mode: "forum", authority: "moonshotai/kimi-k3", athink: "max", worker: "moonshotai/kimi-k2.7-code", wthink: "high", min: 3, max: 6, live: 4 },
  run: { name: "", concurrency: 3, retries: 0, budget: 10 },
};
const bench = () => CAT[ST.benchKey];
const selection = () => pickTasks(bench(), ST);
const plural = (n, w) => `${n} ${n === 1 ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`}`;
const pct = (x) => (isFinite(x) ? `${Math.round(x * 100)}%` : "–");
const money = (x) => `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
function limitLabel(b) { return `${hours(b.agent_timeout_sec)} per task (${b.name}'s own limit)`; }
function hours(sec) { const h = sec / 3600; return h < 1 ? `${Math.round(sec / 60)} min` : `${h % 1 ? h.toFixed(1) : h} h`; }

// ---------- small controls ----------

function segmented(options, value, onPick, label) {
  const g = el("div", "seg");
  g.setAttribute("role", "radiogroup");
  if (label) g.setAttribute("aria-label", label);
  for (const [v, text, title] of options) {
    const b = el("button", "", text);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(v === value));
    if (title) b.title = title;
    b.addEventListener("click", () => onPick(v));
    g.append(b);
  }
  return g;
}
function stepper(value, min, max, onSet, label) {
  const w = el("div", "stepper");
  const minus = el("button", "", "−");
  const plus = el("button", "", "+");
  const input = el("input");
  input.type = "number"; input.min = min; input.max = max; input.value = value;
  input.setAttribute("aria-label", label);
  minus.type = plus.type = "button";
  minus.setAttribute("aria-label", `Fewer: ${label}`);
  plus.setAttribute("aria-label", `More: ${label}`);
  const set = (v) => { v = Math.max(min, Math.min(max, Math.round(v) || min)); input.value = v; onSet(v); };
  minus.addEventListener("click", () => set(+input.value - 1));
  plus.addEventListener("click", () => set(+input.value + 1));
  input.addEventListener("change", () => set(+input.value));
  w.append(minus, input, plus);
  return w;
}
function select_(options, value, onSet, label) {
  const s = el("select");
  s.setAttribute("aria-label", label);
  for (const [v, text] of options) { const o = el("option", "", text); o.value = v; o.selected = v === value; s.append(o); }
  s.addEventListener("change", () => onSet(s.value));
  return s;
}
function field(labelText, control, hint) {
  const f = el("label", "field");
  f.append(el("span", "f-label", labelText), control);
  if (hint) f.append(el("span", "f-hint", hint));
  return f;
}

// ---------- benchmark ----------

function benchCards(compact) {
  const w = el("div", compact ? "bench-cards compact" : "bench-cards");
  for (const key of ["swebenchpro", "deepswe"]) {
    const b = CAT[key];
    const card = el("button", "bench-card");
    card.type = "button";
    card.setAttribute("aria-pressed", String(ST.benchKey === key));
    const repos = new Set(b.tasks.map((t) => t.repo)).size;
    const langs = [...new Set(b.tasks.map((t) => langWord(t.language)))];
    const head = el("div", "bc-head");
    head.append(el("span", "bc-name", b.name), el("span", "bc-ver", `${b.version}, latest`));
    card.append(head, el("div", "bc-count", plural(b.tasks.length, "task")), el("div", "bc-meta", `${plural(repos, "repository")} · ${langs.slice(0, 4).join(", ")}`));
    if (!compact) {
      const bar = el("div", "bc-bar");
      for (const band of BANDS) {
        const n = b.tasks.filter((t) => t.band === band).length;
        const s = el("i", `bd-${band.replace(" ", "-")}`);
        s.style.flexGrow = n;
        s.title = `${BAND_WORD[band]}: ${n}`;
        bar.append(s);
      }
      card.append(bar, el("div", "bc-meta", limitLabel(b)));
    }
    card.addEventListener("click", () => {
      if (ST.benchKey === key) return;
      ST.benchKey = key;
      ST.picked = new Set();
      ST.filters = { repo: "", language: "", band: "", category: "", hard51: false, q: "" };
      ST.sameRun = 0;
      if (ST.mode === "pick" || ST.mode === "same") ST.mode = "random"; // those were the other benchmark's tasks
      render();
    });
    w.append(card);
  }
  return w;
}

// ---------- tasks: the ways to choose ----------

function modeTabs() {
  const w = el("div", "mode-tabs");
  w.setAttribute("role", "tablist");
  for (const [k, name, about] of MODES) {
    const b = el("button", "mode-tab");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(ST.mode === k));
    b.append(el("b", "", name), el("span", "", about));
    b.addEventListener("click", () => { toMode(k); });
    w.append(b);
  }
  return w;
}
function toMode(k) {
  if (k === "pick" && ST.mode !== "pick" && !ST.picked.size) ST.picked = new Set(selection().map((t) => t.id)); // keep what was chosen, to edit
  ST.mode = k;
  render();
}

function narrowRow(showBand = true) {
  const b = bench();
  const w = el("div", "narrow");
  const repos = [...new Set(b.tasks.map((t) => t.repo))].sort();
  const langs = [...new Set(b.tasks.map((t) => t.language))].sort();
  w.append(el("span", "f-hint", "From"));
  w.append(select_([["", "every repository"], ...repos.map((r) => [r, r])], ST.filters.repo, (v) => { ST.filters.repo = v; refresh(); }, "Repository"));
  w.append(select_([["", "every language"], ...langs.map((l) => [l, langWord(l)])], ST.filters.language, (v) => { ST.filters.language = v; refresh(); }, "Language"));
  if (showBand) w.append(select_([["", "every difficulty"], ...BANDS.map((x) => [x, BAND_WORD[x]])], ST.filters.band, (v) => { ST.filters.band = v; refresh(); }, "Difficulty"));
  if (ST.benchKey === "swebenchpro") {
    const c = el("label", "check");
    const i = el("input");
    i.type = "checkbox"; i.checked = ST.filters.hard51;
    i.addEventListener("change", () => { ST.filters.hard51 = i.checked; refresh(); });
    c.append(i, " HARD-51 only");
    w.append(c);
  }
  return w;
}

function modeBody() {
  const b = bench();
  const w = el("div", "mode-body");
  const nField = () => field("How many", stepper(ST.n, 1, b.tasks.length, (v) => { ST.n = v; refresh(); }, "Number of tasks"), `of ${b.tasks.length}`);
  const presets = el("div", "presets");
  presets.append(el("span", "f-hint", "Saved lists"));
  for (const p of b.presets) {
    const c = el("button", "chip", `${p.name} (${p.ids.length})`);
    c.type = "button";
    c.title = p.about;
    c.addEventListener("click", () => { ST.picked = new Set(p.ids); ST.mode = "pick"; render(); });
    presets.append(c);
  }
  if (ST.mode === "random") {
    const seed = el("div", "row");
    seed.append(field("Seed", stepper(ST.seed, 0, 99999, (v) => { ST.seed = v; refresh(); }, "Seed")));
    const again = el("button", "ghost", "Draw again");
    again.type = "button";
    again.addEventListener("click", () => { ST.seed = Math.floor(Math.random() * 99999); render(); });
    seed.append(again);
    const r = el("div", "row");
    r.append(nField(), seed);
    w.append(r, narrowRow(), el("p", "why", "A seeded random draw is the fairest small sample: at 10 to 50 tasks no cleverer method reliably does better. The same seed always gives the same tasks, so a later run can be compared task by task."));
  } else if (ST.mode === "difficulty") {
    const r = el("div", "row");
    r.append(nField(), field("Mix", segmented([["match", "Like the benchmark"], ["even", "Even"], ["custom", "Set each"]], ST.mix, (v) => { ST.mix = v; render(); }, "Mix")));
    w.append(r);
    if (ST.mix === "custom") {
      const c = el("div", "row");
      for (const band of BANDS) {
        ST.custom[band] = Math.min(ST.custom[band], b.tasks.filter((t) => t.band === band).length); // a count can come from the other benchmark
      }
      ST.n = BANDS.reduce((a, x) => a + ST.custom[x], 0);
      for (const band of BANDS) c.append(field(BAND_WORD[band], stepper(ST.custom[band], 0, b.tasks.filter((t) => t.band === band).length, (v) => { ST.custom[band] = v; ST.n = BANDS.reduce((a, x) => a + ST.custom[x], 0); refresh(); }, `${BAND_WORD[band]} tasks`)));
      w.append(c);
    }
    const sp = el("label", "check");
    const i = el("input");
    i.type = "checkbox"; i.checked = ST.spread;
    i.addEventListener("change", () => { ST.spread = i.checked; refresh(); });
    sp.append(i, " Spread each band over the repositories");
    w.append(narrowRow(false), sp, el("p", "why", `Difficulty is how often published attempts solved each task (${b.solve_source}), cut into four bands at the quartiles. Tasks with the same rate stay together, so the bands are not always equal: ${ST.benchKey === "swebenchpro" ? "on SWE-bench Pro the very hard band holds every task no published model solved. " : ""}Every band is covered, so the run cannot be all easy or all hard by chance.`));
  } else if (ST.mode === "same") {
    const runs = ST.sameRuns;
    const list = el("div", "same-list");
    if (!runs.length) list.append(el("p", "f-hint", `No earlier run on ${b.name} yet.`));
    runs.forEach((r, i) => {
      const c = el("button", "same-run");
      c.type = "button";
      c.setAttribute("aria-pressed", String(ST.sameRun === i));
      c.append(el("b", "", r.name), el("span", "", `${r.when} · ${plural(r.ids.length, "task")}`));
      c.addEventListener("click", () => { ST.sameRun = i; render(); });
      list.append(c);
    });
    w.append(list, el("p", "why", "Comparing two setups on the same tasks, task by task, removes the luck of the draw from the comparison."));
  } else if (ST.mode === "pick") {
    w.append(pickTable());
  } else if (ST.mode === "paste") {
    const ta = el("textarea", "paste");
    ta.value = ST.paste;
    ta.rows = 6;
    ta.placeholder = ST.benchKey === "swebenchpro" ? "instance_ansible__ansible-83fb24b9…\ninstance_qutebrowser__qutebrowser-fea33d6\nflipt-io__flipt-0b119520" : "igel-persist-feature-schema\nbandit-incremental-cache-control";
    ta.setAttribute("aria-label", "Task ids");
    ta.addEventListener("input", () => { ST.paste = ta.value; refresh(); });
    w.append(ta, el("div", "paste-check", ""), el("p", "why", "A full id, or any unique start of one: “qutebrowser-fea33d6” is enough."));
  } else {
    const r = el("div", "row");
    r.append(nField(), field("Order", segmented([["first", "First N"], ["even", "Spread evenly"]], ST.order, (v) => { ST.order = v; refresh(); }, "Order")));
    w.append(r, narrowRow(), el("p", "why caution", "The benchmark lists its tasks by repository, so the first N come from only one or two repositories. Use it to try the setup, not to measure."));
  }
  if (ST.mode !== "same") w.append(presets);
  return w;
}

function pickTable() {
  const b = bench();
  const w = el("div", "pick");
  const top = el("div", "pick-top");
  const q = el("input", "search");
  q.type = "search";
  q.placeholder = "Search titles, ids, repositories";
  q.value = ST.filters.q;
  q.setAttribute("aria-label", "Search tasks");
  q.addEventListener("input", () => { ST.filters.q = q.value; refreshPick(); });
  const all = el("button", "ghost", "Tick all shown");
  all.type = "button";
  all.addEventListener("click", () => { for (const t of narrow(b.tasks, ST.filters)) ST.picked.add(t.id); refresh(); });
  const none = el("button", "ghost", "Clear");
  none.type = "button";
  none.addEventListener("click", () => { ST.picked.clear(); refresh(); });
  top.append(q, all, none);
  w.append(top, narrowRow(), el("div", "pick-list", ""));
  w.querySelector(".pick-list").id = "pick-list";
  return w;
}
function refreshPick() {
  const box = $("pick-list");
  if (!box) return;
  const b = bench();
  const shown = narrow(b.tasks, ST.filters);
  box.replaceChildren();
  const head = el("div", "pl-head", `${shown.length} shown, ${ST.picked.size} ticked`);
  box.append(head);
  for (const t of shown.slice(0, 200)) {
    const row = el("label", "pl-row");
    const i = el("input");
    i.type = "checkbox";
    i.checked = ST.picked.has(t.id);
    i.addEventListener("change", () => { i.checked ? ST.picked.add(t.id) : ST.picked.delete(t.id); refresh(false); head.textContent = `${shown.length} shown, ${ST.picked.size} ticked`; });
    const sw = el("i", "lang-dot");
    sw.style.background = LANG_SWATCH[t.language] || "var(--a7)";
    row.append(i, el("span", "pl-title", t.title), el("span", "pl-repo", t.repo), el("span", `pl-band b-${(t.band || "").replace(" ", "-")}`, BAND_WORD[t.band] || "–"));
    row.prepend(sw);
    box.append(row);
  }
  if (shown.length > 200) box.append(el("p", "f-hint", `Showing 200 of ${shown.length}; search or filter to find the rest.`));
}

// ---------- the task map: every task of the benchmark, by difficulty ----------

function taskMap(interactive) {
  const b = bench();
  const chosen = new Set(selection().map((t) => t.id));
  const w = el("div", "tmap");
  w.setAttribute("role", "group");
  w.setAttribute("aria-label", `Every task in ${b.name}, by difficulty; ${chosen.size} chosen`);
  const cuts = b.cut;
  const sub = { easy: `solved in over ${pct(cuts[2])} of attempts`, medium: `${pct(cuts[1])} to ${pct(cuts[2])}`, hard: cuts[0] === 0 ? `solved, but in ${pct(cuts[1])} of attempts or fewer` : `${pct(cuts[0])} to ${pct(cuts[1])}`, "very hard": cuts[0] === 0 ? "no published model solved it" : `under ${pct(cuts[0])}` };
  for (const band of BANDS) {
    const col = el("div", "tm-col");
    const tasks = b.tasks.filter((t) => t.band === band).sort((x, y) => x.repo.localeCompare(y.repo) || y.solve - x.solve);
    const n = tasks.filter((t) => chosen.has(t.id)).length;
    const h = el("div", "tm-head");
    h.append(el("b", "", BAND_WORD[band]), el("span", "", `${n} of ${tasks.length} · ${sub[band]}`));
    const grid = el("div", "tm-grid");
    let repo = null;
    for (const t of tasks) {
      if (t.repo !== repo) {
        repo = t.repo;
        const mine = tasks.filter((x) => x.repo === repo);
        const lab = el(interactive ? "button" : "span", "tm-break", `${repo.split("/")[1] || repo} ${mine.filter((x) => chosen.has(x.id)).length}/${mine.length}`);
        if (interactive) {
          lab.type = "button";
          lab.title = `Choose or drop every ${BAND_WORD[band].toLowerCase()} task of ${repo}`;
          lab.addEventListener("click", () => {
            const ids = mine.map((x) => x.id);
            const allOn = ids.every((id) => chosen.has(id));
            ST.picked = new Set(chosen);
            ST.mode = "pick";
            for (const id of ids) allOn ? ST.picked.delete(id) : ST.picked.add(id);
            render();
          });
        }
        grid.append(lab);
      }
      const tile = el(interactive ? "button" : "i", `tile${chosen.has(t.id) ? " on" : ""}`);
      tile.style.setProperty("--c", LANG_SWATCH[t.language] || "var(--a7)");
      tile.title = `${t.title}\n${t.repo} · ${langWord(t.language)} · solved in ${pct(t.solve)} of attempts${t.hard51 ? " · HARD-51" : ""}`;
      if (interactive) {
        tile.type = "button";
        tile.setAttribute("aria-pressed", String(chosen.has(t.id)));
        tile.setAttribute("aria-label", `${t.title}, ${BAND_WORD[band]}`);
        tile.addEventListener("click", () => {
          if (ST.mode !== "pick") { ST.picked = new Set(chosen); ST.mode = "pick"; }
          ST.picked.has(t.id) ? ST.picked.delete(t.id) : ST.picked.add(t.id);
          render();
        });
      }
      grid.append(tile);
    }
    col.append(h, grid);
    w.append(col);
  }
  const legend = el("div", "tm-legend");
  const langs = [...new Set(b.tasks.map((t) => t.language))];
  for (const l of langs) { const s = el("span"); const d = el("i"); d.style.background = LANG_SWATCH[l] || "var(--a7)"; s.append(d, langWord(l)); legend.append(s); }
  legend.append(el("span", "tm-key", interactive ? "Filled: chosen. Click a tile to add or remove it." : "Filled: chosen."));
  const box = el("div", "tmap-wrap");
  box.append(w, legend);
  return box;
}

// ---------- team and limits ----------

function modelPicker(value, onSet, label) {
  const w = el("div", "model");
  const list = el("div", "model-list");
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", label);
  for (const m of MODELS) {
    const b = el("button", "model-opt");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === value));
    b.append(el("b", "", m.name), el("span", "", m.maker));
    b.addEventListener("click", () => onSet(m.id));
    list.append(b);
  }
  const other = el("input", "model-other");
  other.placeholder = "or any provider/model";
  other.value = MODELS.some((m) => m.id === value) ? "" : value;
  other.setAttribute("aria-label", `${label}: another model`);
  other.addEventListener("change", () => { if (other.value.includes("/")) onSet(other.value.trim()); });
  w.append(list, other);
  return w;
}
function thinkingPicker(value, onSet, label) {
  return segmented(THINKING.map((x) => [x, x]), value, onSet, label);
}
// the team as seats: the authority's chair, then up to 8 worker seats; the chosen range is filled
function seats() {
  const w = el("div", "seats");
  w.setAttribute("aria-hidden", "true");
  const chair = el("span", "seat chair");
  chair.title = "The authority";
  w.append(chair);
  for (let i = 1; i <= 8; i++) {
    const s = el("button", `seat${i <= ST.team.max ? (i <= ST.team.min ? " must" : " may") : ""}`);
    s.type = "button";
    s.tabIndex = -1;
    s.title = i <= ST.team.min ? `Worker ${i}: always` : i <= ST.team.max ? `Worker ${i}: if the authority wants it` : `Worker ${i}: not allowed`;
    s.addEventListener("click", () => {
      if (i <= ST.team.min) ST.team.min = i === ST.team.min ? Math.max(1, i - 1) : i;
      else if (i <= ST.team.max) ST.team.min = i;
      else ST.team.max = i;
      if (ST.team.min > ST.team.max) ST.team.max = ST.team.min;
      render();
    });
    w.append(s);
  }
  return w;
}
function teamControls() {
  const w = el("div", "team");
  w.append(field("The team", segmented([["forum", "The forum: an authority and workers"], ["single", "One agent, no forum"]], ST.team.mode, (v) => { ST.team.mode = v; render(); }, "Mode")));
  const a = el("div", "nr-who");
  a.append(el("h4", "", "Authority"), modelPicker(ST.team.authority, (v) => { ST.team.authority = v; render(); }, "Authority model"), field("Thinking", thinkingPicker(ST.team.athink, (v) => { ST.team.athink = v; render(); }, "Authority thinking")));
  w.append(a);
  if (ST.team.mode === "forum") {
    const wk = el("div", "nr-who");
    wk.append(el("h4", "", "Workers"), modelPicker(ST.team.worker, (v) => { ST.team.worker = v; render(); }, "Worker model"), field("Thinking", thinkingPicker(ST.team.wthink, (v) => { ST.team.wthink = v; render(); }, "Worker thinking")));
    const range = el("div", "range");
    range.append(field("At least", stepper(ST.team.min, 0, 8, (v) => { ST.team.min = v; if (v > ST.team.max) ST.team.max = v; render(); }, "Fewest workers per task")),
      field("At most", stepper(ST.team.max, 1, 8, (v) => { ST.team.max = v; if (v < ST.team.min) ST.team.min = v; render(); }, "Most workers per task")),
      field("At once", stepper(ST.team.live, 1, 8, (v) => { ST.team.live = v; refresh(); }, "Most workers working at the same time")));
    wk.append(el("h5", "", "Workers per task"), seats(), range, el("p", "f-hint", `The authority decides how many it needs, between ${ST.team.min} and ${ST.team.max}; the rulebook refuses anything outside that.`));
    w.append(wk);
  }
  return w;
}
function runControls() {
  const w = el("div", "runset");
  const name = el("input");
  name.value = ST.run.name;
  name.placeholder = "e.g. Kimi K3 + K2, try 3";
  name.setAttribute("aria-label", "Run name");
  name.addEventListener("input", () => { ST.run.name = name.value; refresh(); });
  w.append(field("Name", name, "Optional; you can rename it later"),
    field("Tasks at once", stepper(ST.run.concurrency, 1, 12, (v) => { ST.run.concurrency = v; refresh(); }, "Tasks at once"), "Docker needs disk for each"),
    field("Spend cap per task", stepper(ST.run.budget, 1, 100, (v) => { ST.run.budget = v; refresh(); }, "Dollars per task"), "dollars; the rulebook stops a task at this"),
    field("Retries on a crash", stepper(ST.run.retries, 0, 3, (v) => { ST.run.retries = v; refresh(); }, "Retries"), "Docker or network only; never a timeout"));
  const sc = el("label", "check scripted");
  const i = el("input");
  i.type = "checkbox";
  i.checked = ST.scripted;
  i.addEventListener("change", () => { ST.scripted = i.checked; refresh(); });
  sc.append(i, el("span", "", "Scripted agents: no model calls and no cost. Checks that Docker, Pier and the tasks work before a real run; every task scores 0."));
  w.append(sc);
  return w;
}

// ---------- the run sheet: what will happen, and the start ----------

function summary(full) {
  const b = bench();
  const sel = selection();
  const s = stats(b, sel);
  const w = el("div", "sheet");
  const line = (k, v) => { const r = el("div", "sh-line"); r.append(el("span", "sh-k", k), el("span", "sh-v", v)); return r; };
  w.append(el("div", "sh-title", ST.run.name || "New run"));
  w.append(line("§ Benchmark", `${b.name} ${b.version}`));
  w.append(line("§ Tasks", `${plural(s.n, "task")}, ${MODES.find((m) => m[0] === ST.mode)[1].toLowerCase()}${ST.mode === "random" ? `, seed ${ST.seed}` : ""}`));
  const bar = el("div", "sh-bar");
  for (const band of BANDS) {
    if (!s.bands[band]) continue;
    const i = el("i", `bd-${band.replace(" ", "-")}`);
    i.style.flexGrow = s.bands[band];
    i.title = `${BAND_WORD[band]}: ${s.bands[band]}`;
    bar.append(i);
  }
  w.append(bar, el("div", "sh-small", BANDS.filter((x) => s.bands[x]).map((x) => `${s.bands[x]} ${BAND_WORD[x].toLowerCase()}`).join(" · ") || "no tasks yet"));
  if (s.langs.length) w.append(el("div", "sh-small", s.langs.map(([l, n]) => `${n} ${langWord(l)}`).join(" · ") + ` · ${plural(s.repos.length, "repository")}`));
  w.append(line("§ Team", ST.team.mode === "forum" ? `${modelName(ST.team.authority)} (${ST.team.athink}) leads ${ST.team.min} to ${ST.team.max} ${modelName(ST.team.worker)} workers (${ST.team.wthink})` : `${modelName(ST.team.authority)} alone (${ST.team.athink})`));
  w.append(line("§ Limits", `${limitLabel(b)}; at most ${money(ST.run.budget)} a task`));
  if (s.n) {
    const lo = s.ci50[0], hi = s.ci50[1];
    const est = el("div", "sh-est");
    est.append(el("b", "", `At most ${money(s.n * ST.run.budget)} and about ${hours(Math.ceil(s.n / ST.run.concurrency) * b.agent_timeout_sec)}`), el("span", "", ` if every task used its whole budget and time; most use far less.`));
    w.append(est);
    const read = el("div", "sh-read");
    const harder = isFinite(s.solve) ? (s.solve < s.benchSolve - 0.05 ? "harder than" : s.solve > s.benchSolve + 0.05 ? "easier than" : "about as hard as") : null;
    if (harder) read.append(el("p", "", `These tasks are ${harder} the whole benchmark: published attempts solved ${pct(s.solve)} of them, against ${pct(s.benchSolve)} overall.`));
    read.append(el("p", "", `With ${plural(s.n, "task")}, a pass rate of 50% means the true rate on these tasks is somewhere from ${pct(lo)} to ${pct(hi)}${s.n < b.tasks.length ? `; as a guess at the whole benchmark, about ±${Math.round(((hi - lo) / 2) * s.fpc * 100)} points` : ""}. Keep the same tasks to compare two setups.`));
    w.append(read);
  }
  if (ST.scripted) w.append(el("p", "sh-scripted", "Scripted agents: no model calls, every task scores 0. A check of the setup, not a result."));
  if (full) {
    const d = el("details", "sh-cmd");
    d.append(el("summary", "", "What it runs"), el("pre", "", commandText(sel)));
    w.append(d);
  }
  if (!CAT_START) {
    w.append(el("p", "sh-scripted", "Starting runs is switched off in this viewer (it was started with --no-start)."));
  }
  const go = el("button", "primary start", s.n ? `Start ${plural(s.n, "task")}` : "Choose some tasks");
  go.type = "button";
  go.disabled = !s.n || !CAT_START || ST.busy;
  go.addEventListener("click", () => confirmStart(sel, s));
  w.append(go);
  return w;
}
function request(sel) {
  const t = ST.team;
  return {
    benchmark: ST.benchKey, tasks: sel.map((x) => x.id), mode: t.mode, scripted: ST.scripted,
    authority_model: t.authority, authority_thinking: t.athink, worker_model: t.worker, worker_thinking: t.wthink,
    min_workers: t.min, max_workers: t.max, max_live_workers: t.live,
    concurrency: ST.run.concurrency, retries: ST.run.retries, budget_usd: ST.run.budget, name: ST.run.name.trim(),
  };
}
function commandText(sel) {
  const r = request(sel);
  const lines = [`# the ${plural(sel.length, "task")} are written to base_forum/tasks/runs/<run>.tsv, then:`, `BENCHMARK=${r.benchmark} MODE=${r.mode} TASKS=base_forum/tasks/runs/<run>.tsv \\`, `AUTHORITY_MODEL=${r.authority_model} AUTHORITY_THINKING=${r.authority_thinking} \\`];
  if (r.mode === "forum") lines.push(`WORKER_MODEL=${r.worker_model} WORKER_THINKING=${r.worker_thinking} MIN_WORKERS=${r.min_workers} MAX_WORKERS=${r.max_workers} MAX_LIVE_WORKERS=${r.max_live_workers} \\`);
  lines.push(`CONCURRENCY=${r.concurrency} RETRIES=${r.retries} BUDGET_USD=${r.budget_usd}${r.scripted ? " FAUX=smoke" : ""} \\`, "base_forum/scripts/run_baseline.sh");
  return lines.join("\n");
}
function confirmStart(sel, s) {
  const d = $("start-dialog");
  $("sd-go").textContent = `Start ${plural(s.n, "task")}`;
  $("sd-go").onclick = async () => {
    d.close();
    ST.busy = true;
    refresh(false);
    try {
      const res = await fetch("api/runs/start", { method: "POST", headers: { "Content-Type": "application/json", "X-Decorum-Viewer": "1" }, body: JSON.stringify(request(sel)) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.status);
      toast(`Started: ${plural(body.tasks, "task")}. Pier is preparing the first ones.`);
      await pollTrials();
      selectRun(body.job);
    } catch (e) {
      toast(`Could not start: ${e.message}`);
    } finally {
      ST.busy = false;
      if (!$("newrun").hidden) refresh(false);
    }
  };
  $("sd-title").textContent = `Start ${plural(s.n, "task")} on ${bench().name}?`;
  $("sd-text").textContent = `${ST.team.mode === "forum" ? `${modelName(ST.team.authority)} leads ${ST.team.min} to ${ST.team.max} ${modelName(ST.team.worker)} workers` : `${modelName(ST.team.authority)} works alone`}, ${Math.min(ST.run.concurrency, s.n) > 1 ? `${Math.min(ST.run.concurrency, s.n)} tasks at a time` : "one task at a time"}. ${ST.scripted ? "Scripted agents: no model calls, no cost." : `It can spend up to ${money(s.n * ST.run.budget)}.`} It appears in the list at once.`;
  d.showModal();
}

// ---------- the page ----------

function layoutSheet() {
  const w = el("div", "L-sheet");
  const left = el("div", "ls-main");
  const sec = (n, title, ...kids) => { const s = el("section", "ls-sec"); s.append(el("h3", "", `§ ${n}  ${title}`), ...kids); return s; };
  left.append(sec(1, "Benchmark", benchCards(false)), sec(2, "Tasks", modeTabs(), modeBody(), taskMap(true)), sec(3, "Team", teamControls()), sec(4, "Run", runControls()));
  const right = el("aside", "ls-side");
  right.id = "summary";
  right.append(summary(true));
  w.append(left, right);
  return w;
}

function render() {
  const main = $("main");
  const keepY = main.scrollTop;
  ST.sameRuns = sameRuns();
  $("newrun").replaceChildren(layoutSheet());
  refresh();
  main.scrollTop = keepY;
}
// what depends on the choice of tasks, redrawn without touching the inputs being typed in
function refresh(withPick = true) {
  if (withPick) refreshPick();
  const s = $("summary");
  if (s) s.replaceChildren(summary(true));
  for (const m of document.querySelectorAll("#newrun .tmap-wrap")) m.replaceWith(taskMap(true));
  const pc = document.querySelector(".paste-check");
  if (pc) {
    const r = parsePaste(ST.paste, bench().tasks);
    pc.replaceChildren();
    pc.append(el("span", "ok", `${r.found.length} found`));
    if (r.unknown.length) pc.append(el("span", "bad", `not in ${bench().name}: ${r.unknown.slice(0, 4).join(", ")}${r.unknown.length > 4 ? "…" : ""}`));
    if (r.ambiguous.length) pc.append(el("span", "bad", `matches more than one task: ${r.ambiguous.map(([t, n]) => `${t} (${n})`).join(", ")}`));
  }
}


// Runs of this benchmark that can be repeated task for task, newest first (the viewer's own run list).
function sameRuns() {
  const word = CAT && CAT[ST.benchKey] ? CAT[ST.benchKey].name : "";
  return S.runs
    .filter((r) => r.benchmark === word && (r.task_ids || []).length && r.status !== "starting")
    .map((r) => ({ name: runLabel(r), when: shortDate(r.started_at), ids: r.task_ids }));
}

async function show() {
  if (!CAT) {
    const d = await getJSON("api/catalog");
    CAT = d.benchmarks;
    CAT_START = d.start;
    if (!CAT[ST.benchKey]) ST.benchKey = Object.keys(CAT)[0];
  }
  render();
}
$("sd-cancel").addEventListener("click", () => $("start-dialog").close());
window.NewRun = { show };
})();
