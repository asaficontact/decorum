import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkBudget, checkFinish, checkPost, checkRead, checkSpawn } from "../src/enforce.ts";
import type { TrialState } from "../src/enforce.ts";
import { Forum, ForumError } from "../src/forum.ts";
import { BASE_RULEBOOK, describeRules, loadRulebook, parseRulebook, RulebookError, withBudget } from "../src/rulebook.ts";
import { tempDir } from "./helpers.ts";

const RULEBOOKS = join(import.meta.dirname, "..", "..", "rulebooks");

test("the shipped base-0 rulebook equals the runtime's default", () => {
	assert.deepEqual(loadRulebook(join(RULEBOOKS, "base-0.yaml")), BASE_RULEBOOK);
});

test("a rulebook may omit rules; omitted rules take base-0's value", () => {
	const rb = parseRulebook("name: tiny\nbudget:\n  usd_per_trial: 3\n");
	assert.equal(rb.visibility, "all");
	assert.equal(rb.authority, "manager");
	assert.equal(rb.budget.usd_per_trial, 3);
	assert.equal(rb.budget.max_live_workers, BASE_RULEBOOK.budget.max_live_workers);
});

test("an unknown rule, an unknown value or a bad number is refused, naming it", () => {
	assert.throws(() => parseRulebook("reviewers: 2\n"), (e: Error) => e instanceof RulebookError && /unknown rule "reviewers"/.test(e.message));
	assert.throws(() => parseRulebook("visibility: some\n"), /visibility must be one of all \| participants/);
	assert.throws(() => parseRulebook("authority: boss\n"), /authority must be one of manager \| player/);
	assert.throws(() => parseRulebook("budget:\n  max_live_workers: 1.5\n"), /max_live_workers must be an integer/);
	assert.throws(() => parseRulebook("budget:\n  max_live_workers: null\n"), /cannot be null/);
	assert.throws(() => parseRulebook("budget:\n  tokens: 5\n"), /unknown budget key "tokens"/);
	assert.throws(() => parseRulebook("budget:\n  min_workers_total: 7\n  max_workers_total: 6\n"), /min_workers_total \(7\) is more than budget.max_workers_total \(6\)/);
	assert.throws(() => parseRulebook("- a\n- b\n"), /must be a YAML mapping/);
});

test("null budget values mean no cap", () => {
	const rb = parseRulebook("budget:\n  usd_per_trial: null\n  wall_clock_sec: null\n");
	const s: TrialState = { costUsd: 1e6, startedAtMs: 0, nowMs: 1e12, liveWorkers: 0, totalWorkers: 0 };
	assert.deepEqual(checkBudget(rb, s), { ok: true });
});

test("budget: dollars and wall clock stop the trial", () => {
	const s: TrialState = { costUsd: 10, startedAtMs: 0, nowMs: 1000, liveWorkers: 0, totalWorkers: 0 };
	const d = checkBudget(BASE_RULEBOOK, s);
	assert.equal(d.ok, false);
	assert.equal(!d.ok && d.rule, "budget.usd_per_trial");
	assert.equal(!d.ok && d.terminate, true);
	const t = checkBudget(BASE_RULEBOOK, { ...s, costUsd: 0, nowMs: 9000 * 1000 });
	assert.equal(!t.ok && t.rule, "budget.wall_clock_sec");
	assert.deepEqual(checkBudget(BASE_RULEBOOK, { ...s, costUsd: 9.99 }), { ok: true });
});

test("budget: live and total worker caps", () => {
	const rb = parseRulebook("budget:\n  max_live_workers: 2\n  max_workers_total: 3\n");
	const s: TrialState = { costUsd: 0, startedAtMs: 0, nowMs: 0, liveWorkers: 1, totalWorkers: 1 };
	assert.deepEqual(checkSpawn(rb, s, 1), { ok: true });
	const live = checkSpawn(rb, s, 2);
	assert.equal(!live.ok && live.rule, "budget.max_live_workers");
	const total = checkSpawn(rb, { ...s, liveWorkers: 0, totalWorkers: 3 }, 1);
	assert.equal(!total.ok && total.rule, "budget.max_workers_total");
});

test("visibility, posting and closing follow their values", () => {
	const open = BASE_RULEBOOK;
	const closed = parseRulebook("visibility: participants\nposting: participants\nclosing: evidence\n");
	assert.deepEqual(checkRead(open, "w1", ["authority"]), { ok: true });
	assert.equal(checkRead(closed, "w1", ["authority"]).ok, false);
	assert.deepEqual(checkRead(closed, "w1", ["authority", "w1"]), { ok: true });
	assert.equal(checkPost(closed, "w2", ["authority", "w1"]).ok, false);
	assert.deepEqual(checkFinish(open, undefined), { ok: true });
	assert.equal(checkFinish(closed, "ok").ok, false);
	assert.deepEqual(checkFinish(closed, "pytest -q tests/test_x.py: 12 passed in 0.4s"), { ok: true });
});

test("describeRules says what is enforced, and the norms when there are any", () => {
	const text = describeRules(parseRulebook('norms: "Prefer small diffs."\n'));
	assert.match(text, /\$10 for the whole trial/);
	assert.match(text, /between 3 and 6 workers in the trial, at most 4 at a time/);
	assert.match(text, /Norms \(not enforced/);
	assert.doesNotMatch(describeRules(BASE_RULEBOOK), /Norms/);
});

test("the forum numbers threads, posts and assignments, and appends every event to its log", () => {
	const log = join(tempDir(), "forum.jsonl");
	const f = new Forum({ logPath: log });
	const t = f.openThread("authority", "Fix parser", "tests pass");
	assert.equal(t.id, "T1");
	f.assign("T1", "w1", "a tester", "write tests");
	assert.deepEqual(f.thread("T1").participants, ["authority", "w1"]);
	assert.equal(f.post("T1", "w1", "done").id, "P1");
	f.finish("w1", "finished", "wrote 3 tests", "pytest: 3 passed");
	f.closeThread("T1", "merged");
	assert.throws(() => f.post("T1", "w1", "late"), ForumError);
	assert.throws(() => f.thread("T9"), /No thread "T9"/);
	const kinds = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).kind);
	assert.deepEqual(kinds, ["thread_opened", "assigned", "post", "finished", "thread_closed"]);
});

test("a run can set the worker range and the spend cap; the result is checked like a rulebook", () => {
	assert.equal(withBudget(BASE_RULEBOOK, {}), BASE_RULEBOOK);
	assert.equal(withBudget(BASE_RULEBOOK, { min_workers_total: undefined }), BASE_RULEBOOK);
	const rb = withBudget(BASE_RULEBOOK, { min_workers_total: 2, max_workers_total: 4, max_live_workers: 2, usd_per_trial: 5 });
	assert.deepEqual(rb.budget, { ...BASE_RULEBOOK.budget, min_workers_total: 2, max_workers_total: 4, max_live_workers: 2, usd_per_trial: 5 });
	assert.match(rb.description, /budget set for this run: min_workers_total=2, max_workers_total=4, max_live_workers=2, usd_per_trial=5/);
	assert.equal(rb.name, BASE_RULEBOOK.name);
	assert.throws(() => withBudget(BASE_RULEBOOK, { min_workers_total: 7 }), /min_workers_total \(7\) is more than budget.max_workers_total \(6\)/);
	assert.throws(() => withBudget(BASE_RULEBOOK, { max_workers_total: 1.5 }), RulebookError);
	assert.throws(() => withBudget(BASE_RULEBOOK, { usd_per_trial: -1 }), /usd_per_trial must be a number >= 0/);
});
