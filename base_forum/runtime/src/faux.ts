// Scripted agents on pi's faux provider, so the whole runtime (and the Pier adapter around it) can be run
// end to end with no model and no key. `--faux smoke` drives one forum trial: the authority opens a thread,
// assigns two workers with different personas, waits for both, commits, and ends. In vote mode each worker writes
// and commits its own file, and the aggregator lists the checkout and answers with worker1's patch in a fenced
// block, as a model might. Not for measuring anything.

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const COST = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 };

export function registerFaux(rt: ModelRuntime): void {
	const faux = fauxProvider({
		provider: "faux",
		models: [
			{ id: "authority", cost: COST, contextWindow: 200_000, maxTokens: 8_000 },
			{ id: "worker", cost: COST, contextWindow: 200_000, maxTokens: 8_000 },
		],
	});
	rt.registerNativeProvider(faux.provider);
	faux.setResponses(Array.from({ length: 400 }, () => (ctx: Context) => smoke(ctx)));
}

function transcript(ctx: Context): string {
	return ctx.messages
		.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("\n")))
		.join("\n");
}

function agentName(ctx: Context): string {
	const sys = String(ctx.systemPrompt ?? "");
	const w = /worker "([a-z0-9-]+)"/.exec(sys);
	if (w) return w[1]!;
	if (sys.includes('You are "authority"')) return "authority";
	// vote mode: a worker works in worktrees/workerN; the aggregator's prompt holds the workers' reports
	const v = /worktrees\/(worker\d+)/.exec(sys);
	if (v) return `vote-${v[1]}`;
	if (transcript(ctx).includes("Context from other agents:")) return "aggregator";
	return "single";
}

function smoke(ctx: Context) {
	const who = agentName(ctx);
	const step = ctx.messages.filter((m) => m.role === "assistant").length;
	const seen = transcript(ctx);
	if (who.startsWith("vote-")) {
		const name = who.slice("vote-".length);
		if (step === 0) return fauxAssistantMessage(fauxToolCall("write", { path: `DECORUM_SMOKE_${name}.md`, content: `written by ${name}\n` }), { stopReason: "toolUse" });
		if (step === 1) return fauxAssistantMessage(fauxToolCall("bash", { command: `git add -A && git commit -qm '${name}: smoke' && git log --oneline -1` }), { stopReason: "toolUse" });
		return fauxAssistantMessage(`Done: wrote DECORUM_SMOKE_${name}.md.`);
	}
	if (who === "aggregator") {
		if (step === 0) return fauxAssistantMessage(fauxToolCall("ls", { path: "." }), { stopReason: "toolUse" });
		const prompt = transcript({ ...ctx, messages: ctx.messages.slice(0, 1) });
		const first = /--- worker1 ---\n([\s\S]*?)(?:\n--- worker\d+ ---|$)/.exec(prompt)?.[1] ?? "";
		return fauxAssistantMessage(`The workers agree; worker1's patch is the cleanest.\n\n\`\`\`diff\n${first.trim()}\n\`\`\``);
	}
	if (who === "single") {
		if (step === 0) return fauxAssistantMessage(fauxToolCall("write", { path: "DECORUM_SMOKE_single.md", content: "written by the single agent\n" }), { stopReason: "toolUse" });
		if (step === 1) return fauxAssistantMessage(fauxToolCall("bash", { command: "git add -A && git commit -qm 'single: smoke' && git log --oneline -1" }), { stopReason: "toolUse" });
		return fauxAssistantMessage("Done: wrote and committed the smoke file.");
	}
	if (who === "authority") {
		// pi's grep and find need rg and fd in the sandbox; the smoke trial exercises both before it starts the forum
		if (step === 0) return fauxAssistantMessage([fauxToolCall("grep", { pattern: "a", limit: 1 }), fauxToolCall("find", { pattern: "*", limit: 1 })], { stopReason: "toolUse" });
		if (step === 1) return fauxAssistantMessage(fauxToolCall("open_thread", { title: "Smoke files", goal: "Each worker writes its own smoke file." }), { stopReason: "toolUse" });
		if (step === 2)
			return fauxAssistantMessage(
				fauxToolCall("assign_workers", {
					thread: "T1",
					workers: [
						{ name: "w1", persona: "A careful writer.", instructions: "Write DECORUM_SMOKE_w1.md, post in T1, then finish." },
						{ name: "w2", persona: "A terse writer.", instructions: "Write DECORUM_SMOKE_w2.md, post in T1, then finish." },
						{ name: "w3", persona: "A quiet writer.", instructions: "Write DECORUM_SMOKE_w3.md, post in T1, then finish." },
					],
				}),
				{ stopReason: "toolUse" },
			);
		const bothDone = ["w1", "w2", "w3"].every((w) => seen.includes(`${w} finished its assignment`));
		if (!bothDone) return fauxAssistantMessage(fauxToolCall("wait", { timeout_sec: 60 }), { stopReason: "toolUse" });
		if (!seen.includes("authority: smoke")) {
			return fauxAssistantMessage(fauxToolCall("bash", { command: "git add -A && git commit -qm 'authority: smoke' && git log --oneline -1" }), { stopReason: "toolUse" });
		}
		if (!seen.includes("Closed T1")) return fauxAssistantMessage(fauxToolCall("close_thread", { thread: "T1", summary: "Both files written." }), { stopReason: "toolUse" });
		return fauxAssistantMessage(fauxText("Done: both workers wrote their files; committed."));
	}
	// a worker
	if (step === 0) return fauxAssistantMessage(fauxToolCall("write", { path: `DECORUM_SMOKE_${who}.md`, content: `written by ${who}\n` }), { stopReason: "toolUse" });
	if (step === 1) return fauxAssistantMessage(fauxToolCall("post", { thread: "T1", text: `${who}: wrote DECORUM_SMOKE_${who}.md` }), { stopReason: "toolUse" });
	if (step === 2) return fauxAssistantMessage(fauxToolCall("finish", { summary: `${who} wrote its file.` }), { stopReason: "toolUse" });
	return fauxAssistantMessage("Finished.");
}
