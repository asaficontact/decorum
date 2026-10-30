// EvoMAS's multi-agent systems on SWE-bench (amazon-science/EvoMAS, mas_pools/swebench/), as its code runs them.
// EvoMAS runs every system through one DAG executor (src/mas/runtime.py, _execute_dag): the agents run layer by
// layer, and each one is handed the task plus every report made before it. On SWE-bench its coding agents
// (SWE-agent) change the checkout and report their patch; every other agent (a smolagents CodeAgent that may read the
// repository but not change it) gets the same task query, with every earlier report under "Context from other
// agents", and answers with a patch. The last agent, the aggregator, has the final say: its answer, cleaned to a
// diff, is the trial's patch. Two of its systems are here:
//
//   vote (majority_vote.yaml):        worker1..N (coding)  -> aggregator
//   peer-review (peer_review.yaml):   creator1..N (coding) -> reviewer1..N -> reviser1..N -> aggregator
//
// Nothing counts votes, and nothing asks a reviewer to review: EvoMAS's review and revise prompt templates and its
// own peer-review routine are never called on this path (its runners ignore an agent's `prompt`), so its reviewers,
// revisers and aggregator differ only by what they have seen. This file holds the parts that must match EvoMAS word
// for word: the task query (src/utils/mas_runner.py, for a smolagents-backend MAS) and the context block
// (src/agents/runners/smolagents.py), a failed agent's report (src/mas/runtime.py), and the cleaning of the final
// answer (src/utils/output_cleaner.py, clean_swe_bench_output). Applying the cleaned patch starts as the SWE-bench
// harness does (which graded EvoMAS's predictions) and goes further: an aggregator's hand-written diff often miscounts
// its hunks, so the counts are retaken from the hunks, and a patch that still does not apply goes back to the
// aggregator once with git's error (runtime.ts). Both depart from EvoMAS on purpose.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./workspace.ts";

export const AGGREGATOR = "aggregator";

export type Topology = "vote" | "peer-review";

/** One layer of agents: coding agents change their own copy of the checkout; readers read and answer. */
export interface LayerSpec {
	/** The agents' role and name prefix: worker -> worker1..workerN, as EvoMAS names them. */
	role: string;
	kind: "coder" | "reader";
	count: number;
}

/** The layers before the aggregator, each of N agents. */
export function topologyLayers(topology: Topology, n: number): LayerSpec[] {
	if (topology === "vote") return [{ role: "worker", kind: "coder", count: n }];
	return [
		{ role: "creator", kind: "coder", count: n },
		{ role: "reviewer", kind: "reader", count: n },
		{ role: "reviser", kind: "reader", count: n },
	];
}

/** The default number of agents per layer: 5 for a vote (EvoMAS's pool has 6), 6 for peer review (as EvoMAS). */
export const DEFAULT_AGENTS: Record<Topology, number> = { vote: 5, "peer-review": 6 };

/**
 * The default share of the trial's dollars and wall clock kept for the read-only layers after the coding agents: the
 * aggregator alone in a vote, three layers in peer review.
 */
export const DEFAULT_RESERVE: Record<Topology, number> = { vote: 0.15, "peer-review": 0.45 };

/** What one agent hands the agents after it: a coding agent's patch, a reader's answer, or EvoMAS's error line. */
export interface AgentReport {
	agent: string;
	ok: boolean;
	/** The text the agents after it read for this agent. */
	report: string;
	/** A coding agent's patch, or a reader's answer cleaned to a diff, in bytes. */
	patch_bytes: number;
	files: string[];
	error: string | null;
}

/** smolagents' words for an agent that answered nothing (SmolagentsRunner.run). */
export const EMPTY_ANSWER = "Agent returned empty response - execution may have failed";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The shared checkout's path where it appears as a path (/app, /app/lib, "cd /app"), not inside another name
 * (/application). Paths into the entries linked into a worktree (node_modules, .venv) are left out: a worker reads its
 * installed dependencies through them.
 */
export function repoPathPattern(repo: string, linked: string[] = []): RegExp {
	// a name goes on with a letter, digit, - or a dot followed by one ("/app.d"); a dot that ends a sentence does not
	const end = "(?![\\w-]|\\.[\\w-])";
	const keep = linked.length ? `(?!/(?:${linked.map(escape).join("|")})${end})` : "";
	return new RegExp(`(?<![\\w./-])${escape(repo)}${keep}${end}`, "g");
}

/**
 * A coding agent's instruction: the task's, with the shared checkout's path replaced by the agent's own copy. A
 * benchmark's instruction names the checkout ("A code repository is available in the /app directory"); a worker
 * that took it at its word would change the shared checkout, where the other workers and the grader are.
 */
export function workerInstruction(instruction: string, repo: string, dir: string): string {
	return instruction.replace(repoPathPattern(repo), dir);
}

/** EvoMAS's runtime turns an agent with no output into this report (MasRuntime._execute_agent). */
export function failedReport(agent: string, error: string): string {
	return `Error: Agent ${agent} execution failed: ${error}`;
}

/** The task query EvoMAS gives a smolagents-backend MAS on SWE-bench, verbatim (MasRunner.run_single_task). */
export function taskQuery(repo: string, instanceId: string, instruction: string): string {
	return `Repository: ${repo}
Instance ID: ${instanceId}

${instruction}

CRITICAL INSTRUCTIONS:
1. Read and analyze the relevant files in the repository at ${repo}
2. Identify the exact code changes needed to fix the issue
3. Generate a git diff patch in unified diff format

Your response MUST be ONLY the git diff patch, starting with "diff --git" and following this exact format:

diff --git a/path/to/file.py b/path/to/file.py
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -line,count +line,count @@
 context line
-removed line
+added line
 context line

Do NOT include any explanations, markdown formatting, or other text. ONLY output the raw diff patch.`;
}

/** A reader's whole input: the task query, then every report made before it, in order (SmolagentsRunner.run). */
export function readerPrompt(repo: string, instanceId: string, instruction: string, reports: Array<{ agent: string; report: string }>): string {
	let prompt = taskQuery(repo, instanceId, instruction);
	if (reports.length) {
		prompt += "\n\nContext from other agents:\n";
		for (const r of reports) prompt += `\n--- ${r.agent} ---\n${r.report}\n`;
	}
	return prompt;
}

/** The least wall-clock time the aggregator gets (at most 40% of the trial's): it reads every report and then types the whole patch. */
export const AGGREGATOR_MIN_SEC = 900;

/** How long before the wall clock ends the trial the aggregator is told to answer now. */
export const AGGREGATOR_WARN_SEC = 150;

/**
 * Where each layer ends, as a share of the trial's dollars and clock, the aggregator last (always 1). The coding layer
 * ends by 1 - reserve, then the readers' layers (the aggregator last) split the reserve equally. The aggregator reads
 * every report and types out the whole patch, which took Kimi 4 to 15 minutes; when its share of the clock would be
 * less than AGGREGATOR_MIN_SEC (at most 40% of the clock), the layers before it end proportionally sooner.
 */
export function layerEnds(layers: LayerSpec[], reserve: number, wallClockSec: number | null): number[] {
	const readers = layers.filter((l) => l.kind === "reader").length + 1;
	const first = layers.findIndex((x) => x.kind === "reader");
	const shares = layers.map((l, i) => (l.kind === "coder" ? 1 - reserve : 1 - reserve + (reserve * (i - first + 1)) / readers));
	const floor = wallClockSec ? Math.min(AGGREGATOR_MIN_SEC, wallClockSec * 0.4) / wallClockSec : 0;
	const last = shares.at(-1)!;
	return [...shares.map((x) => (1 - last < floor ? (x * (1 - floor)) / last : x)), 1];
}

/** What a running aggregator is told when the wall clock is about to end the trial. */
export function timeWarning(seconds: number): string {
	return `About ${seconds} seconds are left before this task is stopped, and an unfinished answer is lost. Stop reading and answer now with your final patch: ONLY the raw diff patch, starting with "diff --git".`;
}

/** The aggregator's one second chance (not in EvoMAS): its patch did not apply, and this is what git said. */
export function retryPrompt(repo: string, error: string): string {
	const said = error.length > 4000 ? `${error.slice(0, 4000)}\n[...]` : error;
	return `Your patch could not be applied to the repository at ${repo}. Applying it reported:

${said}

Read again the files your patch changes, and answer with the complete corrected patch, all files included: every hunk's context and removed lines must match the files exactly as they are, and every hunk header's line counts must match the hunk's lines.

Your response MUST be ONLY the git diff patch, starting with "diff --git". Do NOT include any explanations, markdown formatting, or other text. ONLY output the raw diff patch.`;
}

// Files and patterns that are not source changes (clean_swe_bench_output's exclude list).
const EXCLUDE = [".sweagent_output/", ".traj", "_helpers", "Subproject commit"];
const DIFF_LINE = ["diff ", "---", "+++", "@@", "+", "-", " ", "index ", "new file", "deleted file", "Binary files", "\\"];
const DIFF_LINE_STRIPPED = DIFF_LINE.filter((p) => p !== " ");

/** Python's str.strip(): whitespace off both ends. */
const strip = (s: string) => s.replace(/^\s+|\s+$/g, "");

/**
 * The aggregator's answer cleaned to a patch, as EvoMAS's clean_swe_bench_output does it: take a ```diff fence (or a
 * plain fence holding a diff), keep the diff blocks whose header is a source file, drop trailing non-diff lines, and
 * end with a newline. Returns "" when the answer holds no diff.
 */
export function cleanPatch(answer: string): string {
	let content = strip(answer);
	const fenced = /```diff\s*\n([\s\S]*?)\n```/.exec(content);
	if (fenced) content = strip(fenced[1]!);
	else {
		const code = /```\s*\n([\s\S]*?)\n```/.exec(content);
		if (code) {
			const potential = strip(code[1]!);
			if (potential.startsWith("diff ")) content = potential;
		}
	}
	const excluded = (header: string) => EXCLUDE.some((p) => header.includes(p));
	const blocks: string[] = [];
	let current: string[] = [];
	let header = "";
	for (const line of content.split("\n")) {
		if (line.startsWith("diff --git") || line.startsWith("diff ")) {
			if (current.length && header && !excluded(header)) blocks.push(current.join("\n"));
			current = [line];
			header = line;
		} else if (current.length) current.push(line);
	}
	if (current.length && header && !excluded(header)) blocks.push(current.join("\n"));
	if (!blocks.length) return strip(content).startsWith("diff ") ? strip(content) : "";

	const lines = strip(blocks.join("\n")).split("\n");
	let last = lines.length - 1;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		const s = strip(line);
		if (s === "```") {
			last = i - 1;
			continue;
		}
		if (!s) continue;
		if (!(DIFF_LINE.some((p) => line.startsWith(p)) || DIFF_LINE_STRIPPED.some((p) => s.startsWith(p)))) {
			last = i - 1;
			continue;
		}
		last = i;
		break;
	}
	const result = strip(lines.slice(0, last + 1).join("\n"));
	return result && !result.endsWith("\n") ? `${result}\n` : result;
}

/**
 * A worker's patch: everything it changed in its worktree, committed or not, new files included, against the base
 * commit. (EvoMAS took `git diff HEAD`, which drops a new file whenever the worker also edited a tracked one; that is
 * a bug in its capture, not part of the method, so it is not copied.)
 */
export function worktreePatch(dir: string, base: string): { patch: string; files: string[]; error: string | null } {
	const add = git(dir, ["add", "-A"]);
	if (!add.ok) return { patch: "", files: [], error: `git add failed: ${add.output}` };
	// the index against the base: the worker's commits and its uncommitted work together
	const diff = git(dir, ["diff", "--cached", base]);
	if (!diff.ok) return { patch: "", files: [], error: `git diff failed: ${diff.output}` };
	const names = git(dir, ["diff", "--cached", "--name-only", base]);
	const patch = diff.output ? `${diff.output}\n` : "";
	return { patch, files: names.ok && names.output ? names.output.split("\n") : [], error: null };
}

export interface ApplyResult {
	applied: boolean;
	/** The command that applied it, or null. */
	method: string | null;
	output: string;
}

/**
 * The patch with every hunk header's line counts taken from the hunk itself. An aggregator writes its diff by hand and
 * often miscounts (a header says 7 old lines where the hunk holds 6), which git rejects as a corrupt patch although
 * every line of the change is there. Inside a hunk an empty line is a blank context line whose space was dropped;
 * empty lines at a hunk's end only separate it from what follows.
 */
export function recountPatch(patch: string): string {
	const lines = patch.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[i]!);
		if (!m) {
			out.push(lines[i]!);
			i++;
			continue;
		}
		let j = i + 1;
		const body: string[] = [];
		const ends = (k: number) => lines[k]!.startsWith("@@") || lines[k]!.startsWith("diff ") || (lines[k]!.startsWith("--- ") && (lines[k + 1] ?? "").startsWith("+++ "));
		while (j < lines.length && !ends(j)) body.push(lines[j++]!);
		let blanks = 0;
		while (body.length && body.at(-1) === "") {
			body.pop();
			blanks++;
		}
		const hunk = body.map((l) => (l === "" ? " " : l));
		const old = hunk.filter((l) => l[0] === " " || l[0] === "-").length;
		const now = hunk.filter((l) => l[0] === " " || l[0] === "+").length;
		out.push(`@@ -${m[1]},${old} +${m[2]},${now} @@${m[3]}`, ...hunk, ...Array<string>(blanks).fill(""));
		i = j;
	}
	return out.join("\n");
}

/** The lines a patch adds and removes, whitespace-normalised, with a line both removed and added (no change) left out. */
function netChange(patch: string): { added: string[]; removed: string[] } {
	const add = new Map<string, number>();
	const rem = new Map<string, number>();
	for (const l of patch.split("\n")) {
		if (l.startsWith("+++") || l.startsWith("---")) continue;
		const m = l[0] === "+" ? add : l[0] === "-" ? rem : null;
		if (!m) continue;
		const k = l.slice(1).replace(/\s+/g, " ").trim();
		m.set(k, (m.get(k) ?? 0) + 1);
	}
	const rest = (a: Map<string, number>, b: Map<string, number>) => [...a].flatMap(([k, n]) => Array<string>(Math.max(0, n - (b.get(k) ?? 0))).fill(k)).sort();
	return { added: rest(add, rem), removed: rest(rem, add) };
}

/**
 * Ways to apply the final patch, tried in order: as written (the SWE-bench harness's first command), then with the
 * hunk headers recounted, then also accepting hunks without context lines, then also ignoring whitespace and needing
 * one line of context, then patch with a little fuzz. Every success is checked (applyPatch), so a lenient way never
 * stands unless it made exactly the patch's change.
 */
const APPLY_CMDS: Array<{ label: string; cmd: string; recount: boolean; args: (file: string) => string[] }> = [
	{ label: "git apply", cmd: "git", recount: false, args: (f) => ["apply", "--verbose", f] },
	{ label: "git apply --recount", cmd: "git", recount: true, args: (f) => ["apply", "--verbose", "--recount", f] },
	{ label: "git apply --recount --unidiff-zero", cmd: "git", recount: true, args: (f) => ["apply", "--verbose", "--recount", "--unidiff-zero", f] },
	{ label: "git apply --recount --ignore-whitespace -C1", cmd: "git", recount: true, args: (f) => ["apply", "--verbose", "--recount", "--ignore-whitespace", "-C1", f] },
	{ label: "patch --fuzz=3 -l (recounted)", cmd: "patch", recount: true, args: (f) => ["--batch", "--fuzz=3", "-l", "-p1", "-i", f] },
];

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): { ok: boolean; output: string } {
	try {
		const out = execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
		return { ok: true, output: out.trim() };
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string; message: string };
		return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message };
	}
}

function untracked(repo: string): Set<string> {
	const r = git(repo, ["ls-files", "--others", "--exclude-standard"]);
	return new Set(r.ok && r.output ? r.output.split("\n") : []);
}

/** What the working tree now holds for these paths against HEAD, new files included, without touching the real index. */
function changeOf(repo: string, paths: string[]): string {
	const index = join(tmpdir(), `decorum-apply-${process.pid}-${Date.now()}.index`);
	const env = { ...process.env, GIT_INDEX_FILE: index };
	try {
		run("git", ["read-tree", "HEAD"], repo, env);
		run("git", ["add", "-A"], repo, env);
		return run("git", ["diff", "--cached", "HEAD", "--", ...paths], repo, env).output;
	} finally {
		rmSync(index, { force: true });
	}
}

/**
 * Apply the final patch to the checkout's working tree. A way that fails, or that applies something other than the
 * patch's change (lines it adds and removes, whitespace aside), is undone before the next is tried; the .rej and
 * .orig files the attempts leave are removed, so the grader sees only the patch.
 */
export function applyPatch(repo: string, patchFile: string): ApplyResult {
	const text = readFileSync(patchFile, "utf8");
	const recounted = `${patchFile}.recounted`;
	writeFileSync(recounted, recountPatch(text));
	const want = JSON.stringify(netChange(recountPatch(text)));
	const paths = [...new Set([...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)].flatMap((m) => [m[1]!, m[2]!]))];
	const before = untracked(repo);
	const notes: string[] = [];
	const tidy = () => {
		for (const f of untracked(repo)) if (!before.has(f) && /\.(rej|orig)$/.test(f)) rmSync(join(repo, f), { force: true });
	};
	const undo = () => {
		git(repo, ["checkout", "--", "."]);
		for (const f of untracked(repo)) if (!before.has(f)) rmSync(join(repo, f), { force: true, recursive: true });
	};
	try {
		for (const c of APPLY_CMDS) {
			if (c.cmd === "patch" && !run("sh", ["-c", "command -v patch"], repo).ok) {
				notes.push(`${c.label}: patch is not installed`);
				continue;
			}
			const r = run(c.cmd, c.args(c.recount ? recounted : patchFile), repo);
			if (!r.ok) {
				notes.push(`${c.label}: ${r.output}`);
				undo();
				continue;
			}
			tidy();
			if (paths.length && JSON.stringify(netChange(changeOf(repo, paths))) !== want) {
				notes.push(`${c.label}: applied, but not as the patch's change; undone`);
				undo();
				continue;
			}
			return { applied: true, method: c.label, output: [...notes, `${c.label}: ${r.output}`].join("\n").trim() };
		}
		return { applied: false, method: null, output: notes.join("\n") };
	} finally {
		rmSync(recounted, { force: true });
	}
}
