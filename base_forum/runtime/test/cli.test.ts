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
	assert.equal(s.agents.length, 3);
	assert.match(gitOut(repo, "ls-files"), /DECORUM_SMOKE_w1.md/);
});
