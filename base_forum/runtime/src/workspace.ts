// Git plumbing for the two workspace rules. Shared: every agent works in the task checkout. Isolated:
// each worker gets a git worktree on its own branch, with the checkout's ignored top-level entries
// (installed dependencies such as node_modules or .venv) linked in so its tests can run; the authority
// merges a finished worker's branch. Either way the runtime commits whatever is left at the end, because
// the benchmark grades `git diff base..HEAD` and an uncommitted change is invisible to it.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface GitResult {
	ok: boolean;
	output: string;
}

export function git(cwd: string, args: string[]): GitResult {
	try {
		const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
		return { ok: true, output: out.trim() };
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string; message: string };
		return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message };
	}
}

/** Commits made inside the sandbox need an identity; the sandbox's git may have none. */
export function gitIdentityEnv(): Record<string, string> {
	return {
		GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "decorum-agent",
		GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "decorum-agent@localhost",
		GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "decorum-agent",
		GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "decorum-agent@localhost",
	};
}

export function prepareGit(repo: string): void {
	Object.assign(process.env, gitIdentityEnv());
	git(repo, ["config", "--global", "--add", "safe.directory", "*"]);
}

export function headSha(repo: string): string | null {
	const r = git(repo, ["rev-parse", "HEAD"]);
	return r.ok ? r.output : null;
}

export function isDirty(dir: string): boolean {
	const r = git(dir, ["status", "--porcelain"]);
	return r.ok && r.output.length > 0;
}

/** Remove .git/index.lock if one is left behind (a git command killed mid-run). Call only when no agent can be running git. */
export function removeStaleIndexLock(repo: string): boolean {
	const gitDir = git(repo, ["rev-parse", "--absolute-git-dir"]);
	if (!gitDir.ok) return false;
	const lock = join(gitDir.output, "index.lock");
	if (!existsSync(lock)) return false;
	rmSync(lock, { force: true });
	return true;
}

/** Stage and commit everything not ignored. Returns true if a commit was made. */
export function commitAll(dir: string, message: string): GitResult & { committed: boolean } {
	if (!isDirty(dir)) return { ok: true, output: "nothing to commit", committed: false };
	const add = git(dir, ["add", "-A"]);
	if (!add.ok) return { ...add, committed: false };
	const c = git(dir, ["commit", "-q", "--no-verify", "-m", message]);
	return { ...c, committed: c.ok };
}

/** Top-level paths git ignores in the checkout (node_modules, .venv, target, ...). */
export function ignoredTopLevel(repo: string): string[] {
	const r = git(repo, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"]);
	if (!r.ok || !r.output) return [];
	const tops = new Set<string>();
	for (const line of r.output.split("\n")) {
		const top = line.replace(/\/$/, "").split("/")[0];
		if (top && top !== ".git") tops.add(top);
	}
	return [...tops].sort();
}

export interface IsolatedWorkspace {
	dir: string;
	branch: string;
	linked: string[];
}

/** A worktree for one worker, branched from the checkout's current HEAD, with ignored entries linked in. */
export function createIsolatedWorkspace(repo: string, baseDir: string, worker: string): IsolatedWorkspace {
	mkdirSync(baseDir, { recursive: true });
	const dir = join(baseDir, worker);
	const branch = `decorum/${worker}`;
	const r = git(repo, ["worktree", "add", "-q", "-b", branch, dir, "HEAD"]);
	if (!r.ok) throw new Error(`git worktree add failed for ${worker}: ${r.output}`);
	const linked: string[] = [];
	for (const top of ignoredTopLevel(repo)) {
		const target = join(dir, top);
		if (existsSync(target)) continue;
		try {
			symlinkSync(join(repo, top), target);
			linked.push(top);
		} catch {
			// a link we cannot make leaves the worker without that entry; its tests will say so
		}
	}
	// A pattern like `node_modules/` matches directories only, and a symlink is not one, so `git add -A`
	// in the worktree would commit the link. The common exclude file covers every worktree.
	if (linked.length) {
		const common = git(dir, ["rev-parse", "--git-common-dir"]);
		if (common.ok) {
			const excludePath = join(isAbsolute(common.output) ? common.output : join(dir, common.output), "info", "exclude");
			mkdirSync(dirname(excludePath), { recursive: true });
			const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
			const add = linked.map((t) => `/${t}`).filter((line) => !existing.split("\n").includes(line));
			if (add.length) appendFileSync(excludePath, (existing.endsWith("\n") || !existing ? "" : "\n") + add.join("\n") + "\n");
		}
	}
	return { dir, branch, linked };
}

/** Merge a worker's branch into the checkout's current branch. A conflict is left for the caller to resolve. */
export function mergeBranch(repo: string, branch: string): GitResult {
	return git(repo, ["merge", "--no-edit", branch]);
}
