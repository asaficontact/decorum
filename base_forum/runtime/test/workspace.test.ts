import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { commitAll, createIsolatedWorkspace, ignoredTopLevel, isDirty, mergeBranch, prepareGit, removeStaleIndexLock } from "../src/workspace.ts";
import { gitOut, gitRepo, tempDir } from "./helpers.ts";

test("an isolated worktree links the checkout's installed dependencies and never commits the links", () => {
	const repo = gitRepo({ ".gitignore": "node_modules/\n.venv/\n", "a.txt": "a\n" });
	prepareGit(repo);
	mkdirSync(join(repo, "node_modules", "left-pad"), { recursive: true });
	writeFileSync(join(repo, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
	mkdirSync(join(repo, ".venv", "bin"), { recursive: true });
	writeFileSync(join(repo, ".venv", "bin", "python"), "#!/bin/sh\n");
	assert.deepEqual(ignoredTopLevel(repo), [".venv", "node_modules"]);

	const ws = createIsolatedWorkspace(repo, tempDir(), "w1");
	assert.equal(ws.branch, "decorum/w1");
	assert.deepEqual(ws.linked, [".venv", "node_modules"]);
	assert.ok(lstatSync(join(ws.dir, "node_modules")).isSymbolicLink());
	assert.ok(existsSync(join(ws.dir, "node_modules", "left-pad", "index.js")));
	assert.equal(isDirty(ws.dir), false, "the links must be ignored");

	writeFileSync(join(ws.dir, "b.txt"), "b\n");
	const c = commitAll(ws.dir, "w1: add b");
	assert.equal(c.committed, true);
	assert.deepEqual(gitOut(ws.dir, "show", "--name-only", "--format=", "HEAD").split("\n"), ["b.txt"]);

	const m = mergeBranch(repo, ws.branch);
	assert.equal(m.ok, true, m.output);
	assert.ok(existsSync(join(repo, "b.txt")));
});

test("commitAll commits nothing on a clean tree and everything not ignored on a dirty one", () => {
	const repo = gitRepo();
	prepareGit(repo);
	assert.equal(commitAll(repo, "x").committed, false);
	writeFileSync(join(repo, "new.txt"), "n\n");
	assert.equal(commitAll(repo, "add new").committed, true);
	assert.equal(gitOut(repo, "log", "-1", "--format=%s"), "add new");
});

test("a merge conflict is reported, not hidden", () => {
	const repo = gitRepo({ "f.txt": "one\n" });
	prepareGit(repo);
	const ws = createIsolatedWorkspace(repo, tempDir(), "w2");
	writeFileSync(join(ws.dir, "f.txt"), "worker\n");
	commitAll(ws.dir, "worker edit");
	writeFileSync(join(repo, "f.txt"), "authority\n");
	commitAll(repo, "authority edit");
	const m = mergeBranch(repo, ws.branch);
	assert.equal(m.ok, false);
	assert.match(m.output, /CONFLICT/);
});

test("a stale index.lock is removed so the final commit can run", () => {
	const repo = gitRepo();
	prepareGit(repo);
	writeFileSync(join(repo, ".git", "index.lock"), "");
	writeFileSync(join(repo, "late.txt"), "l\n");
	assert.equal(commitAll(repo, "blocked").committed, false);
	assert.equal(removeStaleIndexLock(repo), true);
	assert.equal(commitAll(repo, "after").committed, true);
	assert.equal(removeStaleIndexLock(repo), false);
});
