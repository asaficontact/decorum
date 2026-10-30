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
// answer (src/utils/output_cleaner.py, clean_swe_bench_output). Applying the cleaned patch follows the SWE-bench
// harness, which is what graded EvoMAS's predictions.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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

// The SWE-bench harness tries these in order and keeps the first that succeeds (harness/constants GIT_APPLY_CMDS).
const APPLY_CMDS: Array<{ label: string; cmd: string; args: (file: string) => string[] }> = [
	{ label: "git apply --verbose", cmd: "git", args: (f) => ["apply", "--verbose", f] },
	{ label: "git apply --verbose --reject", cmd: "git", args: (f) => ["apply", "--verbose", "--reject", f] },
	{ label: "patch --batch --fuzz=5 -p1 -i", cmd: "patch", args: (f) => ["--batch", "--fuzz=5", "-p1", "-i", f] },
];

function run(cmd: string, args: string[], cwd: string): { ok: boolean; output: string } {
	try {
		const out = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
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

/**
 * Apply the final patch to the checkout's working tree, as the SWE-bench harness would. A failed attempt is undone
 * before the next, and the .rej and .orig files the attempts leave are removed, so the grader sees only the patch.
 */
export function applyPatch(repo: string, patchFile: string): ApplyResult {
	const before = untracked(repo);
	const notes: string[] = [];
	const tidy = () => {
		for (const f of untracked(repo)) if (!before.has(f) && /\.(rej|orig)$/.test(f)) rmSync(join(repo, f), { force: true });
	};
	const undo = () => {
		git(repo, ["checkout", "--", "."]);
		for (const f of untracked(repo)) if (!before.has(f)) rmSync(join(repo, f), { force: true, recursive: true });
	};
	for (const c of APPLY_CMDS) {
		if (c.cmd === "patch" && !run("sh", ["-c", "command -v patch"], repo).ok) {
			notes.push(`${c.label}: patch is not installed`);
			continue;
		}
		const r = run(c.cmd, c.args(patchFile), repo);
		if (r.ok) {
			tidy();
			return { applied: true, method: c.label, output: [...notes, `${c.label}: ${r.output}`].join("\n").trim() };
		}
		notes.push(`${c.label}: ${r.output}`);
		undo();
	}
	return { applied: false, method: null, output: notes.join("\n") };
}
