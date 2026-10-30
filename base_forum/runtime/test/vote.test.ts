// Majority vote (EvoMAS): the aggregator's prompt and the cleaning of its answer word for word, and whole trials on
// scripted agents: independent workers, every report in front of the aggregator, the answer applied to the checkout.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Turn } from "./helpers.ts";
import { call, gitOut, gitRepo, runTrial, say } from "./helpers.ts";
import { aggregatorPrompt, cleanPatch, failedReport, taskQuery } from "../src/vote.ts";

const DIFF = `diff --git a/x.py b/x.py
index 1111111..2222222 100644
--- a/x.py
+++ b/x.py
@@ -1 +1 @@
-a = 1
+a = 2
`;

test("the aggregator's prompt is EvoMAS's task query and context block, word for word", () => {
	const q = taskQuery("/app", "django__django-1", "Fix the bug.");
	assert.equal(
		q,
		[
			"Repository: /app",
			"Instance ID: django__django-1",
			"",
			"Fix the bug.",
			"",
			"CRITICAL INSTRUCTIONS:",
			"1. Read and analyze the relevant files in the repository at /app",
			"2. Identify the exact code changes needed to fix the issue",
			"3. Generate a git diff patch in unified diff format",
			"",
			'Your response MUST be ONLY the git diff patch, starting with "diff --git" and following this exact format:',
			"",
			"diff --git a/path/to/file.py b/path/to/file.py",
			"--- a/path/to/file.py",
			"+++ b/path/to/file.py",
			"@@ -line,count +line,count @@",
			" context line",
			"-removed line",
			"+added line",
			" context line",
			"",
			"Do NOT include any explanations, markdown formatting, or other text. ONLY output the raw diff patch.",
		].join("\n"),
	);
	const p = aggregatorPrompt("/app", "django__django-1", "Fix the bug.", [
		{ worker: "worker1", report: DIFF },
		{ worker: "worker2", report: failedReport("worker2", "No output generated") },
	]);
	assert.equal(p, `${q}\n\nContext from other agents:\n\n--- worker1 ---\n${DIFF}\n\n--- worker2 ---\nError: Agent worker2 execution failed: No output generated\n`);
});

test("cleanPatch follows EvoMAS's clean_swe_bench_output", () => {
	assert.equal(cleanPatch(DIFF), DIFF, "a bare diff is kept");
	assert.equal(cleanPatch(`Here is the fix.\n\n\`\`\`diff\n${DIFF}\`\`\`\nThat should do it.`), DIFF, "a ```diff fence is taken");
	assert.equal(cleanPatch(`\`\`\`\n${DIFF}\`\`\``), DIFF, "a plain fence holding a diff is taken");
	assert.equal(cleanPatch(`${DIFF}\nI changed a to 2.`), DIFF, "trailing prose is dropped");
	assert.equal(cleanPatch(`Explanation first.\n${DIFF}`), DIFF, "leading prose before the first diff is dropped");
	const traj = "diff --git a/run.traj b/run.traj\n--- a/run.traj\n+++ b/run.traj\n@@ -1 +1 @@\n-x\n+y\n";
	assert.equal(cleanPatch(`${traj}${DIFF}`), DIFF, "blocks for SWE-agent artifacts are dropped");
	assert.equal(cleanPatch("I could not find the bug."), "", "no diff, no patch");
	assert.equal(cleanPatch(""), "");
});

/** A worker that writes its own file (or edits a shared one) and leaves it uncommitted, as an agent might. */
const writer = (file: string, content = `${file}\n`) => ({ step }: Turn) => (step === 0 ? call("write", { path: file, content }) : say(`wrote ${file}`));

/** The aggregator's prompt: the first message of its session. */
const promptOf = (t: Turn) => {
	const c = t.ctx.messages[0]!.content;
	return typeof c === "string" ? c : c.map((x) => ("text" in x ? x.text : "")).join("");
};

const reportOf = (prompt: string, worker: string) => new RegExp(`--- ${worker} ---\\n([\\s\\S]*?)(?:\\n--- worker\\d+ ---|$)`).exec(prompt)?.[1]?.trim() ?? "";

test("three independent workers, every patch in front of the aggregator, its answer applied to the working tree", async () => {
	const seenBy: Record<string, string> = {};
	let aggregatorTools: string[] = [];
	const worker = (file: string) => (t: Turn) => {
		seenBy[file] = t.seen;
		return writer(file)(t);
	};
	const { summary, repo, outDir } = await runTrial(
		{
			worker1: worker("a.txt"),
			worker2: worker("b.txt"),
			worker3: worker("c.txt"),
			aggregator: (t) => {
				aggregatorTools = (t.ctx.tools ?? []).map((x) => x.name);
				if (t.step === 0) return call("ls", { path: "." });
				return say(`worker2's patch is right.\n\n\`\`\`diff\n${reportOf(promptOf(t), "worker2")}\n\`\`\``);
			},
		},
		{ mode: "vote", extra: { voteWorkers: 3, instanceId: "demo__demo-1", commitPolicy: "leave" } },
	);
	assert.equal(summary.mode, "vote");
	assert.equal(summary.end_reason, "vote_done");
	// independence: no worker saw another's work
	for (const [file, seen] of Object.entries(seenBy)) {
		for (const other of ["a.txt", "b.txt", "c.txt"].filter((f) => f !== file)) assert.ok(!seen.includes(other), `${file}'s worker never saw ${other}`);
	}
	// the aggregator: read-only tools, EvoMAS's prompt with every report in worker order
	assert.deepEqual(aggregatorTools.sort(), ["find", "grep", "ls", "read"]);
	const prompt = readFileSync(join(outDir, "vote", "aggregator_prompt.md"), "utf8");
	assert.match(prompt, /^Repository: .+\nInstance ID: demo__demo-1\n\nDo the task\.\n\nCRITICAL INSTRUCTIONS:/);
	assert.ok(prompt.indexOf("--- worker1 ---") < prompt.indexOf("--- worker2 ---") && prompt.indexOf("--- worker2 ---") < prompt.indexOf("--- worker3 ---"));
	assert.match(reportOf(prompt, "worker1"), /^diff --git a\/a\.txt b\/a\.txt\nnew file mode/);
	// the final patch is worker2's, applied, uncommitted (SWE-bench Pro grades the working tree)
	const v = summary.vote!;
	assert.deepEqual(v.reports.map((r) => [r.worker, r.ok, r.files]), [["worker1", true, ["a.txt"]], ["worker2", true, ["b.txt"]], ["worker3", true, ["c.txt"]]]);
	assert.equal(v.aggregator.same_as, "worker2");
	assert.equal(v.aggregator.apply?.applied, true);
	assert.equal(v.aggregator.apply?.method, "git apply --verbose");
	assert.equal(gitOut(repo, "status", "--porcelain"), "?? b.txt");
	assert.equal(gitOut(repo, "rev-list", "--count", "HEAD"), "1", "nothing was committed on the task's branch");
	for (const f of ["worker1.patch", "worker2.patch", "worker3.patch", "aggregator_prompt.md", "aggregator_answer.md", "final.patch"]) assert.ok(existsSync(join(outDir, "vote", f)), f);
	assert.deepEqual(summary.agents.map((a) => [a.name, a.role]), [["worker1", "worker"], ["worker2", "worker"], ["worker3", "worker"], ["aggregator", "aggregator"]]);
	assert.equal(summary.models.worker !== null, true);
});

test("a worker that changes nothing is reported to the aggregator with EvoMAS's error line", async () => {
	const { summary, outDir } = await runTrial(
		{
			worker1: writer("a.txt"),
			worker2: () => say("I looked and changed nothing."),
			aggregator: () => say("Nothing to add."),
		},
		{ mode: "vote", extra: { voteWorkers: 2 } },
	);
	const prompt = readFileSync(join(outDir, "vote", "aggregator_prompt.md"), "utf8");
	assert.match(prompt, /--- worker2 ---\nError: Agent worker2 execution failed: No output generated\n$/);
	assert.equal(summary.vote!.reports[1]!.ok, false);
	assert.equal(summary.end_reason, "vote_no_patch", "an answer with no diff applies nothing");
	assert.equal(summary.vote!.aggregator.patch_bytes, 0);
});

test("the aggregator may combine patches into one no worker wrote; commit mode commits it", async () => {
	const repo = gitRepo({ "x.py": "a = 1\nb = 1\n" });
	const combined = "diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1,2 +1,2 @@\n-a = 1\n-b = 1\n+a = 2\n+b = 2\n";
	const { summary } = await runTrial(
		{
			worker1: writer("x.py", "a = 2\nb = 1\n"),
			worker2: writer("x.py", "a = 1\nb = 2\n"),
			aggregator: () => say(combined),
		},
		{ mode: "vote", repo, extra: { voteWorkers: 2, commitPolicy: "commit" } },
	);
	assert.equal(summary.end_reason, "vote_done");
	assert.equal(summary.vote!.aggregator.same_as, null);
	assert.equal(readFileSync(join(repo, "x.py"), "utf8"), "a = 2\nb = 2\n");
	assert.equal(summary.auto_committed, true);
	assert.equal(gitOut(repo, "status", "--porcelain"), "");
});

test("an answer whose patch does not apply leaves the checkout clean", async () => {
	const bad = "diff --git a/missing.py b/missing.py\n--- a/missing.py\n+++ b/missing.py\n@@ -1 +1 @@\n-x\n+y\n";
	const { summary, repo } = await runTrial({ worker1: writer("a.txt"), aggregator: () => say(bad) }, { mode: "vote", extra: { voteWorkers: 1 } });
	assert.equal(summary.end_reason, "vote_no_patch");
	assert.equal(summary.vote!.aggregator.apply?.applied, false);
	assert.equal(gitOut(repo, "status", "--porcelain"), "");
});

test("at most max_live_workers workers work at once", async () => {
	let live = 0;
	let peak = 0;
	const slow = (file: string) => async ({ step }: Turn) => {
		if (step === 0) {
			live++;
			peak = Math.max(peak, live);
			await new Promise((r) => setTimeout(r, 150));
			return call("write", { path: file, content: "x\n" });
		}
		live--;
		return say("done");
	};
	const { summary } = await runTrial(
		{ worker1: slow("a"), worker2: slow("b"), worker3: slow("c"), worker4: slow("d"), aggregator: () => say("none") },
		{ mode: "vote", rulebook: { budget: { max_live_workers: 2 } }, extra: { voteWorkers: 4 } },
	);
	assert.equal(peak, 2);
	assert.equal(summary.vote!.reports.filter((r) => r.ok).length, 4);
});

test("workers that spend their share of the budget are stopped, and the aggregator still runs", async () => {
	let aggregatorRan = false;
	const busy = (file: string) => ({ step }: Turn) => (step === 0 ? call("write", { path: file, content: "x\n" }) : call("bash", { command: "true" }));
	const { summary } = await runTrial(
		{
			worker1: busy("a.txt"),
			worker2: busy("b.txt"),
			aggregator: (t) => {
				aggregatorRan = true;
				return say(reportOf(promptOf(t), "worker1"));
			},
		},
		{ mode: "vote", rulebook: { budget: { usd_per_trial: 0.1 } }, cost: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 }, extra: { voteWorkers: 2, aggregatorReserve: 0.5 } },
	);
	assert.ok(aggregatorRan, "the aggregator ran on the reserve");
	assert.match(summary.vote!.workers_stopped ?? "", /their share of the \$0.1 budget/);
	assert.equal(summary.vote!.reports.filter((r) => r.ok).length, 2, "each stopped worker's work so far is its patch");
	assert.equal(summary.end_reason, "vote_done");
});
