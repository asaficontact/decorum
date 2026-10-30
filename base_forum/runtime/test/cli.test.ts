import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gitOut, gitRepo, tempDir } from "./helpers.ts";

const MAIN = join(import.meta.dirname, "..", "src", "main.ts");

function cli(args: string[], env: Record<string, string> = {}) {
	const clean = { ...process.env, MOONSHOT_API_KEY: "", OPENROUTER_API_KEY: "", ...env };
	const r = spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8", env: clean, timeout: 60_000 });
	return { code: r.status, out: r.stdout, err: r.stderr };
}

test("a missing provider key is a configuration error that names the variable", () => {
	const r = cli(["run", "--instruction", "x", "--repo", gitRepo(), "--out", tempDir(), "--work-dir", tempDir(), "--authority-model", "moonshotai/kimi-k3", "--worker-model", "moonshotai/kimi-k2.7-code"]);
	assert.equal(r.code, 2);
	assert.match(r.err, /No credentials for provider "moonshotai": set MOONSHOT_API_KEY/);
});

test("an unknown model, a bad rulebook and a missing flag exit 2 with the reason", () => {
	const repo = gitRepo();
	const base = ["run", "--instruction", "x", "--repo", repo, "--out", tempDir(), "--work-dir", tempDir()];
	const unknown = cli([...base, "--mode", "single", "--authority-model", "moonshotai/kimi-k9"], { MOONSHOT_API_KEY: "sk-test" });
	assert.equal(unknown.code, 2);
	assert.match(unknown.err, /pi knows no model "kimi-k9"/);
	const rb = join(tempDir(), "bad.yaml");
	writeFileSync(rb, "review: 2\n");
	const bad = cli([...base, "--rulebook", rb, "--faux", "smoke"]);
	assert.equal(bad.code, 2);
	assert.match(bad.err, /unknown rule "review"/);
	const noRepo = cli(["run", "--instruction", "x", "--out", tempDir()]);
	assert.equal(noRepo.code, 2);
	assert.match(noRepo.err, /--repo is required/);
	const badPolicy = cli([...base, "--faux", "smoke", "--commit-policy", "squash"]);
	assert.equal(badPolicy.code, 2);
	assert.match(badPolicy.err, /--commit-policy must be commit or leave/);
	const badClock = cli([...base, "--faux", "smoke", "--wall-clock-sec", "0"]);
	assert.equal(badClock.code, 2);
	assert.match(badClock.err, /--wall-clock-sec must be a positive number/);
	const noWorker = cli([...base, "--authority-model", "moonshotai/kimi-k3"], { MOONSHOT_API_KEY: "sk-test" });
	assert.equal(noWorker.code, 2);
	assert.match(noWorker.err, /--worker-model is required in forum mode/);
});

test("--faux smoke runs a whole forum trial from the command line and writes the trace", () => {
	const repo = gitRepo();
	const out = tempDir();
	const r = cli(["run", "--instruction", "Write smoke files.", "--repo", repo, "--out", out, "--work-dir", tempDir(), "--faux", "smoke"]);
	assert.equal(r.code, 0, r.err);
	for (const f of ["forum.jsonl", "summary.json", "runtime.log"]) assert.ok(existsSync(join(out, f)), f);
	const s = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
	assert.equal(s.end_reason, "authority_done");
	assert.equal(s.agents.length, 4);
	assert.match(gitOut(repo, "ls-files"), /DECORUM_SMOKE_w1.md/);
});

test("--min-workers, --max-workers, --max-live-workers and --budget-usd set the rulebook's budget for the run", () => {
	const repo = gitRepo();
	const out = tempDir();
	const r = cli(["run", "--instruction", "Write smoke files.", "--repo", repo, "--out", out, "--work-dir", tempDir(), "--faux", "smoke",
		"--min-workers", "2", "--max-workers", "3", "--max-live-workers", "2", "--budget-usd", "4"]);
	assert.equal(r.code, 0, r.err);
	const s = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
	assert.equal(s.rulebook.budget.min_workers_total, 2);
	assert.equal(s.rulebook.budget.max_workers_total, 3);
	assert.equal(s.rulebook.budget.max_live_workers, 2);
	assert.equal(s.rulebook.budget.usd_per_trial, 4);
	const base = ["run", "--instruction", "x", "--repo", gitRepo(), "--out", tempDir(), "--work-dir", tempDir(), "--faux", "smoke"];
	const flipped = cli([...base, "--min-workers", "5", "--max-workers", "2"]);
	assert.equal(flipped.code, 2);
	assert.match(flipped.err, /min_workers_total \(5\) is more than budget.max_workers_total \(2\)/);
	const word = cli([...base, "--budget-usd", "lots"]);
	assert.equal(word.code, 2);
	assert.match(word.err, /--budget-usd must be a number, got "lots"/);
});

test("--mode vote --faux smoke runs a whole majority vote from the command line", () => {
	const repo = gitRepo();
	const out = tempDir();
	const r = cli(["run", "--instruction", "Write smoke files.", "--repo", repo, "--out", out, "--work-dir", tempDir(), "--faux", "smoke",
		"--mode", "vote", "--workers", "3", "--instance-id", "smoke__smoke-1", "--commit-policy", "leave"]);
	assert.equal(r.code, 0, r.err);
	const s = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
	assert.equal(s.mode, "vote");
	assert.equal(s.end_reason, "vote_done");
	assert.deepEqual(s.agents.map((a: { name: string }) => a.name), ["worker1", "worker2", "worker3", "aggregator"]);
	assert.equal(s.evomas.aggregator.same_as, "worker1");
	assert.equal(gitOut(repo, "status", "--porcelain"), "?? DECORUM_SMOKE_worker1.md", "worker1's file, applied and left uncommitted");
	assert.match(readFileSync(join(out, "evomas", "aggregator_prompt.md"), "utf8"), /^Repository: .+\nInstance ID: smoke__smoke-1\n/);
});

test("vote mode checks its flags", () => {
	const base = ["run", "--instruction", "x", "--repo", gitRepo(), "--out", tempDir(), "--work-dir", tempDir(), "--mode", "vote"];
	const workers = cli([...base, "--faux", "smoke", "--workers", "0"]);
	assert.equal(workers.code, 2);
	assert.match(workers.err, /--workers must be a whole number from 1 to 20, got "0"/);
	const reserve = cli([...base, "--faux", "smoke", "--aggregator-reserve", "1"]);
	assert.equal(reserve.code, 2);
	assert.match(reserve.err, /--aggregator-reserve must be a share from 0 to 0.9/);
	const noWorker = cli([...base, "--authority-model", "moonshotai/kimi-k2.7-code"], { MOONSHOT_API_KEY: "sk-test" });
	assert.equal(noWorker.code, 2);
	assert.match(noWorker.err, /--worker-model is required in vote mode/);
	const mode = cli([...base.slice(0, -1), "pairs", "--faux", "smoke"]);
	assert.equal(mode.code, 2);
	assert.match(mode.err, /--mode must be forum, single, vote or peer-review/);
});

test("--mode peer-review --faux smoke runs creators, reviewers, revisers and an aggregator from the command line", () => {
	const repo = gitRepo();
	const out = tempDir();
	const r = cli(["run", "--instruction", "Write smoke files.", "--repo", repo, "--out", out, "--work-dir", tempDir(), "--faux", "smoke",
		"--mode", "peer-review", "--workers", "2", "--commit-policy", "leave"]);
	assert.equal(r.code, 0, r.err);
	const s = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
	assert.equal(s.end_reason, "peer_review_done");
	assert.deepEqual(s.agents.map((a: { name: string }) => a.name), ["creator1", "creator2", "reviewer1", "reviewer2", "reviser1", "reviser2", "aggregator"]);
	assert.equal(s.evomas.reserve, 0.45, "peer review keeps 45% for its three read-only layers by default");
	assert.equal(s.evomas.aggregator.same_as, "creator1");
	assert.equal(gitOut(repo, "status", "--porcelain"), "?? DECORUM_SMOKE_creator1.md");
});
