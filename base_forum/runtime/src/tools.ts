// The forum's tools, as pi custom tools. Each one checks its rule (enforce.ts) before acting and, when it
// refuses, logs the refusal in the forum and throws, so the agent sees the reason as the tool's error.

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Decision } from "./enforce.ts";
import { checkFinish, checkPost, checkRead } from "./enforce.ts";
import type { Forum } from "./forum.ts";
import type { Rulebook } from "./rulebook.ts";

export interface WorkerSpec {
	name?: string;
	persona: string;
	instructions: string;
}

/** What the tools need from the runtime. */
export interface ForumHost {
	readonly forum: Forum;
	readonly rulebook: Rulebook;
	assignWorkers(by: string, thread: string, specs: WorkerSpec[]): Promise<string>;
	wait(agent: string, timeoutSec: number, signal: AbortSignal | undefined): Promise<string>;
	finishWorker(agent: string, summary: string, evidence: string | undefined): string;
	mergeWorker(worker: string): string;
	overview(agent: string): string;
	refuse(agent: string, tool: string, d: Exclude<Decision, { ok: true }>): never;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

function guard(host: ForumHost, agent: string, tool: string, d: Decision): void {
	if (!d.ok) host.refuse(agent, tool, d);
}

function threadTools(host: ForumHost, agent: string): ToolDefinition[] {
	const post = defineTool({
		name: "post",
		label: "Post",
		description: "Post a message in a forum thread. Every participant of the thread receives it.",
		parameters: Type.Object({
			thread: Type.String({ description: "Thread id, e.g. T1" }),
			text: Type.String({ description: "The message" }),
		}),
		execute: async (_id, p) => {
			const t = host.forum.thread(p.thread);
			guard(host, agent, "post", checkPost(host.rulebook, agent, t.participants));
			const posted = host.forum.post(p.thread, agent, p.text);
			return text(`Posted ${posted.id} in ${p.thread}.`);
		},
	});
	const readThread = defineTool({
		name: "read_thread",
		label: "Read thread",
		description: "Read a forum thread: its goal, participants, and every post.",
		parameters: Type.Object({ thread: Type.String({ description: "Thread id, e.g. T1" }) }),
		execute: async (_id, p) => {
			const t = host.forum.thread(p.thread);
			guard(host, agent, "read_thread", checkRead(host.rulebook, agent, t.participants));
			const posts = host.forum.posts(p.thread);
			const head = `${t.id} "${t.title}" (${t.status}), owner ${t.owner}, participants ${t.participants.join(", ")}\nGoal: ${t.goal || "(none)"}`;
			const body = posts.length ? posts.map((x) => `${x.id} ${x.author}: ${x.text}`).join("\n") : "(no posts)";
			return text(`${head}\n\n${body}${t.closingSummary ? `\n\nClosed: ${t.closingSummary}` : ""}`);
		},
	});
	const listThreads = defineTool({
		name: "list_threads",
		label: "List threads",
		description: "List the forum's threads and every worker's state.",
		parameters: Type.Object({}),
		execute: async () => text(host.overview(agent)),
	});
	const wait = defineTool({
		name: "wait",
		label: "Wait",
		description: "Block until a forum message arrives for you, or until the timeout. Returns the messages.",
		parameters: Type.Object({
			timeout_sec: Type.Optional(Type.Number({ description: "Seconds to wait, 10 to 1800 (default 600)" })),
		}),
		execute: async (_id, p, signal) => {
			const t = Math.min(1800, Math.max(10, p.timeout_sec ?? 600));
			return text(await host.wait(agent, t, signal));
		},
	});
	return [post, readThread, listThreads, wait] as unknown as ToolDefinition[];
}

export function authorityTools(host: ForumHost, agent: string): ToolDefinition[] {
	const openThread = defineTool({
		name: "open_thread",
		label: "Open thread",
		description: "Open a forum thread for a piece of work. You own it. Returns its id.",
		parameters: Type.Object({
			title: Type.String({ description: "Short title" }),
			goal: Type.String({ description: "What the thread is for and what done means" }),
		}),
		execute: async (_id, p) => {
			const t = host.forum.openThread(agent, p.title, p.goal);
			return text(`Opened ${t.id} "${t.title}".`);
		},
	});
	const assignWorkers = defineTool({
		name: "assign_workers",
		label: "Assign workers",
		description:
			"Start one or more worker agents on a thread. Each gets a persona and instructions and works until it calls finish. Workers see only their thread and what you write for them.",
		parameters: Type.Object({
			thread: Type.String({ description: "Thread id, e.g. T1" }),
			workers: Type.Array(
				Type.Object({
					name: Type.Optional(Type.String({ description: "Short lowercase name (letters, digits, -); default w1, w2, ..." })),
					persona: Type.String({ description: "Who the worker is and how it works" }),
					instructions: Type.String({ description: "Exactly what to do and what to report back" }),
				}),
				{ minItems: 1 },
			),
		}),
		execute: async (_id, p) => text(await host.assignWorkers(agent, p.thread, p.workers)),
	});
	const closeThread = defineTool({
		name: "close_thread",
		label: "Close thread",
		description: "Close a thread you own, with a summary of the outcome.",
		parameters: Type.Object({
			thread: Type.String({ description: "Thread id" }),
			summary: Type.String({ description: "What was decided or done" }),
		}),
		execute: async (_id, p) => {
			host.forum.closeThread(p.thread, p.summary);
			return text(`Closed ${p.thread}.`);
		},
	});
	const tools: ToolDefinition[] = [openThread, assignWorkers, closeThread, ...threadTools(host, agent)] as unknown as ToolDefinition[];
	if (host.rulebook.workspace === "isolated") {
		const merge = defineTool({
			name: "merge_worker",
			label: "Merge worker",
			description: "Merge a worker's branch (decorum/<worker>) into your checkout. On a conflict the merge is left in progress for you to resolve with git.",
			parameters: Type.Object({ worker: Type.String({ description: "Worker name" }) }),
			execute: async (_id, p) => text(host.mergeWorker(p.worker)),
		});
		tools.push(merge as unknown as ToolDefinition);
	}
	return tools;
}

export function workerTools(host: ForumHost, agent: string): ToolDefinition[] {
	const evidenceRequired = host.rulebook.closing === "evidence";
	const finish = defineTool({
		name: "finish",
		label: "Finish",
		description: "End your assignment and report to the authority.",
		parameters: Type.Object({
			summary: Type.String({ description: "What you did, what is left, anything the authority must know" }),
			evidence: evidenceRequired
				? Type.String({ description: "Commands you ran to check the work and what they printed" })
				: Type.Optional(Type.String({ description: "Commands you ran to check the work and what they printed" })),
		}),
		execute: async (_id, p) => {
			const evidence = (p as { evidence?: string }).evidence;
			guard(host, agent, "finish", checkFinish(host.rulebook, evidence));
			return text(host.finishWorker(agent, p.summary, evidence));
		},
	});
	return [...threadTools(host, agent), finish as unknown as ToolDefinition];
}
