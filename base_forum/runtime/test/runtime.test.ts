// The runtime end to end, on scripted agents: every behaviour the baseline depends on.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ForumEvent } from "../src/forum.ts";
import { mentionsIn } from "../src/forum.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { call, gitOut, runTrial, say } from "./helpers.ts";

const events = (outDir: string): ForumEvent[] =>
	readFileSync(join(outDir, "forum.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as ForumEvent);

const worker = (file: string) => ({ step }: { step: number }) => {
	if (step === 0) return call("write", { path: file, content: `${file}\n` });
	if (step === 1) return call("post", { thread: "T1", text: `wrote ${file}` });
	if (step === 2) return call("finish", { summary: `wrote ${file}` });
	return say("ok");
};

test("the authority opens a thread, assigns two workers with personas, and their work is committed", async () => {
	const { summary, repo, outDir } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "Two files", goal: "a.txt and b.txt exist" });
			if (step === 1)
				return call("assign_workers", {
					thread: "T1",
					workers: [
						{ name: "alice", persona: "You write a.txt.", instructions: "Write a.txt then finish." },
						{ persona: "You write b.txt.", instructions: "Write b.txt then finish." },
					],
				});
			if (!(seen.includes("alice finished") && seen.includes("w2 finished"))) return call("wait", { timeout_sec: 30 });
			return say("All done.");
		},
		alice: worker("a.txt"),
		w2: worker("b.txt"),
	});
	assert.equal(summary.end_reason, "authority_done");
	assert.equal(summary.auto_committed, true, "the authority never committed, so the runtime did");
	assert.deepEqual(gitOut(repo, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["a.txt", "b.txt"]);
	assert.equal(summary.forum.threads, 1);
	assert.equal(summary.forum.posts, 2);
	const workers = summary.agents.filter((a) => a.role === "worker");
	assert.deepEqual(workers.map((w) => [w.name, w.assignment?.status, w.assignment?.persona]), [
		["alice", "finished", "You write a.txt."],
		["w2", "finished", "You write b.txt."],
	]);
	for (const a of summary.agents) assert.ok(a.session_file && existsSync(join(outDir, a.session_file)), `${a.name} has a session file`);
	assert.ok(summary.cost_usd > 0, "cost is accounted");
	const kinds = events(outDir).map((e) => e.kind);
	assert.deepEqual(kinds.filter((k) => k === "finished").length, 2, "each worker finishes once; a peer's post does not wake a finished worker");
});

test("single mode is one pi agent with no forum tools", async () => {
	const { summary, repo } = await runTrial(
		{
			single: ({ step, ctx }) => {
				const tools = (ctx.tools ?? []).map((t) => t.name);
				assert.ok(!tools.includes("open_thread") && !tools.includes("assign_workers"), `single mode has no forum tools: ${tools}`);
				if (step === 0) return call("write", { path: "s.txt", content: "s\n" });
				return say("done");
			},
		},
		{ mode: "single" },
	);
	assert.equal(summary.mode, "single");
	assert.equal(summary.agents.length, 1);
	assert.equal(summary.models.worker, null);
	assert.ok(existsSync(join(repo, "s.txt")));
	assert.equal(gitOut(repo, "status", "--porcelain"), "", "the work is committed");
});

test("assigning past max_live_workers is refused, logged, and shown to the authority", async () => {
	const { summary, outDir } = await runTrial(
		{
			authority: ({ step, seen }) => {
				if (step === 0) return call("open_thread", { title: "t", goal: "g" });
				if (step === 1)
					return call("assign_workers", {
						thread: "T1",
						workers: [
							{ persona: "p", instructions: "i" },
							{ persona: "p", instructions: "i" },
						],
					});
				assert.match(seen, /Refused by the rulebook \(budget.max_live_workers\)/);
				return say("understood");
			},
		},
		{ rulebook: { budget: { max_live_workers: 1 } } },
	);
	assert.equal(summary.forum.assignments, 0);
	assert.equal(summary.refusals.length, 1);
	assert.equal(summary.refusals[0]!.rule, "budget.max_live_workers");
	assert.ok(events(outDir).some((e) => e.kind === "refusal"));
});

test("the dollar budget stops every agent, and what was done is still committed", async () => {
	let authorityCalls = 0;
	const { summary, repo } = await runTrial(
		{
			authority: ({ step }) => {
				authorityCalls++;
				if (step === 0) return call("write", { path: "partial.txt", content: "p\n" });
				return call("bash", { command: "true" });
			},
		},
		{ rulebook: { budget: { usd_per_trial: 0.05 } }, cost: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 } },
	);
	assert.equal(summary.end_reason, "budget.usd_per_trial");
	assert.ok(summary.cost_usd >= 0.05);
	assert.ok(authorityCalls < 50, `stopped promptly (${authorityCalls} calls)`);
	assert.ok(existsSync(join(repo, "partial.txt")));
	assert.equal(gitOut(repo, "status", "--porcelain"), "");
	assert.ok(summary.refusals.some((r) => r.rule === "budget.usd_per_trial"));
});

test("the wall clock stops a trial whose agent is stuck in a command", async () => {
	const t0 = Date.now();
	const { summary } = await runTrial(
		{ authority: ({ step }) => (step === 0 ? call("bash", { command: "sleep 30" }) : say("late")) },
		{ rulebook: { budget: { wall_clock_sec: 1 } } },
	);
	assert.equal(summary.end_reason, "budget.wall_clock_sec");
	assert.ok(Date.now() - t0 < 15_000, "the stuck command was aborted");
});

test("a post reaches a busy authority between its tool calls (steering)", async () => {
	const { summary } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "t", goal: "g" });
			if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "post then finish" }] });
			// stay busy with commands instead of waiting; the post must arrive anyway
			if (!seen.includes("w1: hello from w1")) return call("bash", { command: "sleep 0.2" });
			if (!seen.includes("w1 finished")) return call("wait", { timeout_sec: 30 });
			return say("got it");
		},
		w1: ({ step }) => {
			if (step === 0) return call("post", { thread: "T1", text: "hello from w1" });
			if (step === 1) return call("finish", { summary: "posted" });
			return say("ok");
		},
	});
	assert.equal(summary.end_reason, "authority_done");
	assert.equal(summary.agents.find((a) => a.name === "w1")?.assignment?.status, "finished");
});

test("the authority can send a finished worker back with feedback", async () => {
	const { summary, repo } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "t", goal: "g" });
			if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "write v1" }] });
			if (!seen.includes("w1 finished its assignment: v1")) return call("wait", { timeout_sec: 30 });
			if (!seen.includes("Posted")) return call("post", { thread: "T1", text: "Also write v2.txt." });
			if (!seen.includes("w1 finished its assignment: v2")) return call("wait", { timeout_sec: 30 });
			return say("done");
		},
		w1: ({ step }) => {
			if (step === 0) return call("write", { path: "v1.txt", content: "1\n" });
			if (step === 1) return call("finish", { summary: "v1" });
			if (step === 2) return say("ok");
			if (step === 3) return call("write", { path: "v2.txt", content: "2\n" });
			if (step === 4) return call("finish", { summary: "v2" });
			return say("ok");
		},
	});
	assert.equal(summary.end_reason, "authority_done");
	assert.ok(existsSync(join(repo, "v1.txt")) && existsSync(join(repo, "v2.txt")));
});

test("a worker that stops without finish() is nudged, then marked stopped, and the authority hears of it", async () => {
	const { summary } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "t", goal: "g" });
			if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "i" }] });
			if (!seen.includes("w1 stopped without finishing")) return call("wait", { timeout_sec: 30 });
			return say("noted");
		},
		w1: () => say("I am thinking about it."),
	});
	const w1 = summary.agents.find((a) => a.name === "w1")!;
	assert.equal(w1.assignment?.status, "stopped");
	assert.equal(w1.usage.llmCalls, 3, "the first answer plus two nudges");
});

test("isolated workspace: a worker commits on its branch and the authority merges it", async () => {
	const { summary, repo } = await runTrial(
		{
			authority: ({ step, seen }) => {
				if (step === 0) return call("open_thread", { title: "t", goal: "g" });
				if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "write iso.txt" }] });
				if (!seen.includes("w1 finished")) return call("wait", { timeout_sec: 30 });
				if (!seen.includes("Merged decorum/w1")) return call("merge_worker", { worker: "w1" });
				return say("merged");
			},
			w1: ({ step, ctx }) => {
				assert.match(String(ctx.systemPrompt), /your own git worktree/);
				if (step === 0) return call("write", { path: "iso.txt", content: "iso\n" });
				if (step === 1) return call("finish", { summary: "wrote iso.txt" });
				return say("ok");
			},
		},
		{ rulebook: { workspace: "isolated" } },
	);
	assert.equal(summary.end_reason, "authority_done");
	assert.ok(existsSync(join(repo, "iso.txt")), "merged into the checkout");
	assert.equal(summary.agents.find((a) => a.name === "w1")?.branch, "decorum/w1");
	assert.match(gitOut(repo, "log", "--format=%s"), /w1: wrote iso.txt/);
});

test("visibility: participants keeps a worker out of other threads", async () => {
	const { summary } = await runTrial(
		{
			authority: ({ step, seen }) => {
				if (step === 0) return call("open_thread", { title: "private", goal: "g" });
				if (step === 1) return call("open_thread", { title: "work", goal: "g" });
				if (step === 2) return call("assign_workers", { thread: "T2", workers: [{ name: "w1", persona: "p", instructions: "i" }] });
				if (!seen.includes("w1 finished")) return call("wait", { timeout_sec: 30 });
				return say("done");
			},
			w1: ({ step, seen }) => {
				if (step === 0) return call("read_thread", { thread: "T1" });
				if (step === 1) {
					assert.match(seen, /Refused by the rulebook \(visibility\)/);
					return call("finish", { summary: "could not read T1" });
				}
				return say("ok");
			},
		},
		{ rulebook: { visibility: "participants" } },
	);
	assert.deepEqual(summary.refusals.map((r) => [r.agent, r.rule]), [["w1", "visibility"]]);
});

test("closing: evidence refuses a finish without evidence", async () => {
	const { summary } = await runTrial(
		{
			authority: ({ step, seen }) => {
				if (step === 0) return call("open_thread", { title: "t", goal: "g" });
				if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "i" }] });
				if (!seen.includes("w1 finished")) return call("wait", { timeout_sec: 30 });
				return say("done");
			},
			w1: ({ step }) => {
				if (step === 0) return call("finish", { summary: "done", evidence: "trust me" });
				if (step === 1) return call("finish", { summary: "done", evidence: "ran: pytest -q -> 14 passed in 1.2s" });
				return say("ok");
			},
		},
		{ rulebook: { closing: "evidence" } },
	);
	assert.deepEqual(summary.refusals.map((r) => r.rule), ["closing"]);
	assert.equal(summary.agents.find((a) => a.name === "w1")?.assignment?.evidence, "ran: pytest -q -> 14 passed in 1.2s");
});

// ---- regressions from the fresh review (2026-10-27) ----

test("a stop while a worker has a queued message ends the trial; nothing keeps running", async () => {
	const t0 = Date.now();
	const { summary } = await runTrial(
		{
			authority: ({ step }) => {
				if (step === 0) return call("open_thread", { title: "t", goal: "g" });
				if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "keep working" }] });
				return call("post", { thread: "T1", text: `keep going ${step}` });
			},
			w1: () => call("bash", { command: "sleep 0.3" }),
		},
		{ rulebook: { budget: { wall_clock_sec: 2 } } },
	);
	assert.equal(summary.end_reason, "budget.wall_clock_sec");
	assert.ok(Date.now() - t0 < 15_000, `run() returned promptly (${Date.now() - t0} ms)`);
	const w1 = summary.agents.find((a) => a.name === "w1")!;
	assert.equal(w1.assignment?.status, "stopped");
});

test("two assign_workers calls in one message respect the live cap and never reuse a name", async () => {
	const { summary } = await runTrial(
		{
			authority: ({ step, seen }) => {
				if (step === 0) return call("open_thread", { title: "t", goal: "g" });
				if (step === 1)
					return fauxAssistantMessage(
						[
							fauxToolCall("assign_workers", { thread: "T1", workers: [{ persona: "p", instructions: "i" }, { persona: "p", instructions: "i" }] }),
							fauxToolCall("assign_workers", { thread: "T1", workers: [{ persona: "p", instructions: "i" }, { persona: "p", instructions: "i" }, { persona: "p", instructions: "i" }] }),
						],
						{ stopReason: "toolUse" },
					);
				if (!seen.includes("w2 finished")) return call("wait", { timeout_sec: 30 });
				return say("done");
			},
			"*": ({ step }) => (step === 0 ? call("finish", { summary: "ok" }) : say("ok")),
		},
		{ rulebook: { budget: { max_live_workers: 4 } } },
	);
	const workers = summary.agents.filter((a) => a.role === "worker");
	assert.deepEqual(workers.map((w) => w.name), ["w1", "w2"]);
	assert.equal(summary.forum.assignments, 2);
	assert.deepEqual(summary.refusals.map((r) => r.rule), ["budget.max_live_workers"]);
});

test("a finished worker can be sent back even when max_workers_total is reached", async () => {
	const { summary, repo } = await runTrial(
		{
			authority: ({ step, seen }) => {
				if (step === 0) return call("open_thread", { title: "t", goal: "g" });
				if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "write a" }] });
				if (!seen.includes("w1 finished its assignment: a")) return call("wait", { timeout_sec: 30 });
				if (!seen.includes("Posted")) return call("post", { thread: "T1", text: "now write b" });
				if (!seen.includes("w1 finished its assignment: b")) return call("wait", { timeout_sec: 30 });
				return say("done");
			},
			w1: ({ step }) => {
				if (step === 0) return call("write", { path: "a.txt", content: "a\n" });
				if (step === 1) return call("finish", { summary: "a" });
				if (step === 2) return say("ok");
				if (step === 3) return call("write", { path: "b.txt", content: "b\n" });
				if (step === 4) return call("finish", { summary: "b" });
				return say("ok");
			},
		},
		{ rulebook: { budget: { max_workers_total: 1 } } },
	);
	assert.equal(summary.end_reason, "authority_done");
	assert.ok(existsSync(join(repo, "b.txt")));
	assert.equal(summary.refusals.length, 0);
});

// ---- routing: mentions and joining a thread by posting (Tawab, 2026-10-27) ----

test("an @name reaches that agent from any thread, and wakes it if it had finished", async () => {
	const { summary, outDir } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "a", goal: "g" });
			if (step === 1) return call("open_thread", { title: "b", goal: "g" });
			if (step === 2) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "tell w2" }] });
			if (step === 3) return call("assign_workers", { thread: "T2", workers: [{ name: "w2", persona: "p", instructions: "finish" }] });
			if (!(seen.includes("w1 finished") && seen.includes("w2 finished its assignment: second"))) return call("wait", { timeout_sec: 30 });
			return say("done");
		},
		w1: ({ step, seen }) => {
			if (step === 0) return call("wait", { timeout_sec: 1 });
			if (step === 1) return call("post", { thread: "T1", text: "@w2 please also check the parser" });
			if (step === 2) return call("finish", { summary: "told w2" });
			assert.ok(!seen.includes("[T2]"), "w1 is not a participant of T2");
			return say("ok");
		},
		w2: ({ step, seen }) => {
			if (step === 0) return call("finish", { summary: "first" });
			if (step === 1) return say("ok");
			assert.match(seen, /\[T1\] w1: @w2 please also check the parser/);
			if (step === 2) return call("finish", { summary: "second" });
			return say("ok");
		},
	});
	assert.equal(summary.end_reason, "authority_done");
	const posts = events(outDir).flatMap((e) => (e.kind === "post" ? [e.post] : []));
	assert.deepEqual(posts.find((p) => p.author === "w1")?.mentions, ["w2"]);
});

test("a worker that posts in another thread becomes a participant and receives the replies", async () => {
	const { summary } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "a", goal: "g" });
			if (step === 1) return call("open_thread", { title: "b", goal: "g" });
			if (step === 2) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "ask in T2" }] });
			if (!seen.includes("[T2] w1: is the API frozen?")) return call("wait", { timeout_sec: 30 });
			if (!seen.includes("Posted")) return call("post", { thread: "T2", text: "yes, frozen" });
			if (!seen.includes("w1 finished")) return call("wait", { timeout_sec: 30 });
			return say("done");
		},
		w1: ({ step, seen }) => {
			if (step === 0) return call("post", { thread: "T2", text: "is the API frozen?" });
			if (!seen.includes("[T2] authority: yes, frozen")) return call("wait", { timeout_sec: 30 });
			if (!seen.includes("Finished;")) return call("finish", { summary: "got the answer" });
			return say("ok");
		},
	});
	assert.equal(summary.end_reason, "authority_done");
	assert.equal(summary.agents.find((a) => a.name === "w1")?.assignment?.status, "finished");
	assert.ok(summary.duration_sec < 10, `no message waited out a 30 s wait (${summary.duration_sec} s)`);
});

test("a second finish() is a no-op, not a second report", async () => {
	const { outDir } = await runTrial({
		authority: ({ step, seen }) => {
			if (step === 0) return call("open_thread", { title: "a", goal: "g" });
			if (step === 1) return call("assign_workers", { thread: "T1", workers: [{ name: "w1", persona: "p", instructions: "i" }] });
			if (!seen.includes("w1 finished")) return call("wait", { timeout_sec: 30 });
			return say("done");
		},
		w1: ({ step }) => (step < 2 ? call("finish", { summary: `report ${step}` }) : say("ok")),
	});
	assert.equal(events(outDir).filter((e) => e.kind === "finished").length, 1);
});

test("mentionsIn finds each @name once and ignores e-mail addresses", () => {
	assert.deepEqual(mentionsIn("@w1 and @api-2, again @w1; mail me@host.com or @@x"), ["w1", "api-2"]);
});
