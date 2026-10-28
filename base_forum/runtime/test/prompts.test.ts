import assert from "node:assert/strict";
import { test } from "node:test";
import { Forum } from "../src/forum.ts";
import { authoritySystemPrompt, workerSystemPrompt } from "../src/prompts.ts";
import { BASE_RULEBOOK, parseRulebook } from "../src/rulebook.ts";

const opts = { repo: "/app", workerModel: "moonshotai/kimi-k2.7-code" };

test("the authority prompt makes it the manager and carries the whole procedure", () => {
	const p = authoritySystemPrompt(BASE_RULEBOOK, opts);
	for (const part of [
		"# Your role: the manager of a team of coding agents",
		"You do not write or edit code yourself; workers do.",
		"Workers run on moonshotai/kimi-k2.7-code",
		'Open a thread "Plan" and post the list there, numbered R1, R2',
		"usually 2 to 4",
		"Every file is changed by at most one worker",
		"a persona: its expertise and how it works",
		"the exact commands that verify its work",
		"A finish report is a claim, not a fact.",
		"Two review rounds are enough.",
		"Do not stop before every requirement is verified",
		"Only you commit",
		"assign_workers(thread, [{name, persona, instructions}])",
		'Rulebook "base-0"',
		"- Authority: the authority manages; it may not write or edit files",
	]) assert.ok(p.includes(part), `missing: ${part}`);
	assert.ok(!p.includes("merge_worker"), "no merge tool in a shared checkout");
	assert.ok(p.split(/\s+/).length < 1300, `concise: ${p.split(/\s+/).length} words`);
});

test("the authority prompt follows the rule values: player, isolated", () => {
	const p = authoritySystemPrompt(parseRulebook("authority: player\nworkspace: isolated\n"), opts);
	assert.ok(p.includes("You may also change code yourself"));
	assert.ok(!p.includes("You do not write or edit code yourself"));
	assert.ok(p.includes("merge_worker(worker)"));
	assert.ok(p.includes("its own git worktree on the branch decorum/<name>"));
	assert.ok(p.includes("- Authority: the authority may also write and edit files itself."));
});

test("the worker prompt carries the persona, the thread, and the working agreement", () => {
	const f = new Forum();
	const t = f.openThread("authority", "Async API", "R2, R3 pass");
	const a = f.assign(t.id, "w1", "A careful Python engineer.", "Implement R2 and R3.");
	const p = workerSystemPrompt(BASE_RULEBOOK, { name: "w1", cwd: "/app", thread: t, assignment: a });
	for (const part of [
		'# Your role: worker "w1" on a team run by "authority"',
		"Persona: A careful Python engineer.",
		'You were assigned to thread T1, "Async API". Goal: R2, R3 pass',
		"1. Plan before you edit.",
		"2. Stay in your scope. Change only the files you own.",
		"3. The checkout is shared (/app).",
		"4. Tell others what they rely on.",
		"Never remove or weaken a test",
		"6. Finish once.",
		"finish(summary, evidence?)",
	]) assert.ok(p.includes(part), `missing: ${part}`);
	const iso = workerSystemPrompt(parseRulebook("workspace: isolated\nclosing: evidence\n"), { name: "w1", cwd: "/tmp/wt/w1", branch: "decorum/w1", thread: t, assignment: a });
	assert.ok(iso.includes("3. You work in your own git worktree (/tmp/wt/w1, branch decorum/w1)."));
	assert.ok(iso.includes("finish(summary, evidence)"));
});
