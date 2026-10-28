// Test helpers: a scratch git repo, and scripted agents on pi's faux provider, one policy per agent name.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Rulebook } from "../src/rulebook.ts";
import { BASE_RULEBOOK } from "../src/rulebook.ts";
import type { Mode, RuntimeOptions } from "../src/runtime.ts";
import { ForumRuntime } from "../src/runtime.ts";

export function tempDir(prefix = "decorum-test-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function gitRepo(files: Record<string, string> = { "README.md": "base\n" }): string {
	const dir = tempDir("decorum-repo-");
	const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	g("init", "-q", "-b", "main");
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
	g("add", "-A");
	g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
	return dir;
}

export function gitOut(dir: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

export interface Turn {
	/** Assistant messages this agent has produced so far in its session. */
	step: number;
	/** Every message's text in the agent's context, joined. */
	seen: string;
	ctx: Context;
}

export type Policy = (t: Turn) => AssistantMessage | Promise<AssistantMessage>;

export const call = (name: string, args: Record<string, unknown>) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
export const say = (text: string) => fauxAssistantMessage(text);

function agentOf(ctx: Context): string {
	const sys = String(ctx.systemPrompt ?? "");
	const w = /worker "([a-z0-9-]+)"/.exec(sys);
	if (w) return w[1]!;
	return sys.includes('You are "authority"') ? "authority" : "single";
}

function seenOf(ctx: Context): string {
	return ctx.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("\n"))).join("\n");
}

let nProviders = 0;

/** A model runtime whose faux provider answers each agent with its own policy. */
export async function scriptedRuntime(policies: Record<string, Policy>, cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }) {
	const provider = `faux${++nProviders}`;
	const rt = await ModelRuntime.create({ authPath: join(tempDir(), "auth.json"), modelsPath: join(tempDir(), "models.json") });
	const faux = fauxProvider({ provider, models: [{ id: "authority", cost }, { id: "worker", cost }] });
	rt.registerNativeProvider(faux.provider);
	const calls: string[] = [];
	faux.setResponses(
		Array.from({ length: 2000 }, () => async (ctx: Context) => {
			const who = agentOf(ctx);
			calls.push(who);
			const p = policies[who] ?? policies["*"];
			if (!p) return say(`(no policy for ${who})`);
			return p({ step: ctx.messages.filter((m) => m.role === "assistant").length, seen: seenOf(ctx), ctx });
		}),
	);
	return { rt, authority: rt.getModel(provider, "authority")!, worker: rt.getModel(provider, "worker")!, calls };
}

export async function runTrial(
	policies: Record<string, Policy>,
	opts: { mode?: Mode; rulebook?: Partial<Omit<Rulebook, "budget">> & { budget?: Partial<Rulebook["budget"]> }; repo?: string; extra?: Partial<RuntimeOptions>; cost?: { input: number; output: number; cacheRead: number; cacheWrite: number } } = {},
) {
	const { rt, authority, worker, calls } = await scriptedRuntime(policies, opts.cost);
	const repo = opts.repo ?? gitRepo();
	const outDir = tempDir("decorum-out-");
	// Tests of other behaviour run without base-0's minimum team (3 workers); the minimum has its own tests.
	const rulebook: Rulebook = { ...BASE_RULEBOOK, ...opts.rulebook, budget: { ...BASE_RULEBOOK.budget, min_workers_total: 0, ...opts.rulebook?.budget } };
	const runtime = new ForumRuntime({
		instruction: "Do the task.",
		repo,
		outDir,
		mode: opts.mode ?? "forum",
		rulebook,
		modelRuntime: rt,
		authorityModel: authority,
		workerModel: worker,
		authorityThinking: "off",
		workerThinking: "off",
		workDir: tempDir("decorum-work-"),
		log: () => undefined,
		...opts.extra,
	});
	const summary = await runtime.run();
	return { summary, repo, outDir, runtime, calls };
}
