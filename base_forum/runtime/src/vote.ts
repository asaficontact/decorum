// Majority vote, as EvoMAS runs it on SWE-bench (amazon-science/EvoMAS, mas_pools/swebench/majority_vote.yaml):
// N workers each solve the task on their own, every worker's patch is put in front of one aggregator, and the
// aggregator's answer, cleaned to a diff, is the trial's patch. EvoMAS calls it a vote, but nothing counts or
// compares patches: the aggregator reads them all and writes the final one, copying one or combining several as
// it sees fit. This file holds the parts that must match EvoMAS word for word: the aggregator's prompt
// (src/utils/mas_runner.py, the task query for a smolagents-backend MAS, plus the context block from
// src/agents/runners/smolagents.py), a worker's report when it produced nothing (src/mas/runtime.py), and the
// cleaning of the aggregator's answer (src/utils/output_cleaner.py, clean_swe_bench_output). Applying the cleaned
// patch follows the SWE-bench harness, which is what graded EvoMAS's predictions.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { git } from "./workspace.ts";

export const AGGREGATOR = "aggregator";

/** EvoMAS names its workers worker1..workerN; the aggregator reads those names in its prompt. */
export function voteWorkerName(i: number): string {
	return `worker${i}`;
}

/** What one worker hands the aggregator: its patch, or EvoMAS's error line when it produced none. */
export interface WorkerReport {
	worker: string;
	ok: boolean;
	/** The text the aggregator reads for this worker. */
	report: string;
	patch_bytes: number;
	files: string[];
	error: string | null;
}

/** EvoMAS's runtime turns a worker with no output into this report (MasRuntime._execute_agent). */
export function failedReport(worker: string, error: string): string {
	return `Error: Agent ${worker} execution failed: ${error}`;
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

/** The aggregator's whole input: the task query, then every worker's report (SmolagentsRunner.run). */
export function aggregatorPrompt(repo: string, instanceId: string, instruction: string, reports: Array<{ worker: string; report: string }>): string {
	let prompt = taskQuery(repo, instanceId, instruction);
	if (reports.length) {
		prompt += "\n\nContext from other agents:\n";
		for (const r of reports) prompt += `\n--- ${r.worker} ---\n${r.report}\n`;
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
