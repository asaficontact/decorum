// Scripted agents on pi's faux provider, so the whole runtime (and the Pier adapter around it) can be run
// end to end with no model and no key. `--faux smoke` drives one forum trial: the authority opens a thread,
// assigns two workers with different personas, waits for both, commits, and ends. Not for measuring anything.

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
	return sys.includes('You are "authority"') ? "authority" : "single";
}

function smoke(ctx: Context) {
	const who = agentName(ctx);
	const step = ctx.messages.filter((m) => m.role === "assistant").length;
	const seen = transcript(ctx);
	if (who === "single") {
		if (step === 0) return fauxAssistantMessage(fauxToolCall("write", { path: "DECORUM_SMOKE_single.md", content: "written by the single agent\n" }), { stopReason: "toolUse" });
		if (step === 1) return fauxAssistantMessage(fauxToolCall("bash", { command: "git add -A && git commit -qm 'single: smoke' && git log --oneline -1" }), { stopReason: "toolUse" });
		return fauxAssistantMessage("Done: wrote and committed the smoke file.");
	}
	if (who === "authority") {
		if (step === 0) return fauxAssistantMessage(fauxToolCall("open_thread", { title: "Smoke files", goal: "Each worker writes its own smoke file." }), { stopReason: "toolUse" });
		if (step === 1)
			return fauxAssistantMessage(
				fauxToolCall("assign_workers", {
					thread: "T1",
					workers: [
						{ name: "w1", persona: "A careful writer.", instructions: "Write DECORUM_SMOKE_w1.md, post in T1, then finish." },
						{ name: "w2", persona: "A terse writer.", instructions: "Write DECORUM_SMOKE_w2.md, post in T1, then finish." },
					],
				}),
				{ stopReason: "toolUse" },
			);
		const bothDone = seen.includes("w1 finished its assignment") && seen.includes("w2 finished its assignment");
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
