// The forum: threads, posts and assignments, kept in memory and appended as one JSON event per line to
// forum.jsonl, so a trial's whole conversation can be replayed and handed to the optimizer as a trace.
// One process owns the forum; agents reach it only through the tools in tools.ts.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Thread {
	id: string;
	title: string;
	goal: string;
	owner: string;
	participants: string[];
	status: "open" | "closed";
	openedAt: string;
	closedAt?: string;
	closingSummary?: string;
}

export interface Post {
	id: string;
	thread: string;
	author: string;
	text: string;
	/** Agents named as @name in the text; each is delivered the post wherever it is written. */
	mentions: string[];
	at: string;
}

const MENTION = /(?<![\w@])@([a-z][a-z0-9-]{0,23})\b/g;

/** The @names in a post, in order, without repeats. */
export function mentionsIn(text: string): string[] {
	return [...new Set([...text.matchAll(MENTION)].map((m) => m[1]!))];
}

export type AssignmentStatus = "working" | "finished" | "stopped";

export interface Assignment {
	id: string;
	thread: string;
	worker: string;
	persona: string;
	instructions: string;
	status: AssignmentStatus;
	assignedAt: string;
	finishedAt?: string;
	summary?: string;
	evidence?: string;
}

export type ForumEvent =
	| { seq: number; at: string; kind: "thread_opened"; thread: Thread }
	| { seq: number; at: string; kind: "post"; post: Post }
	| { seq: number; at: string; kind: "assigned"; assignment: Assignment }
	| { seq: number; at: string; kind: "finished"; assignment: Assignment }
	| { seq: number; at: string; kind: "thread_closed"; thread: Thread }
	| { seq: number; at: string; kind: "refusal"; agent: string; tool: string; rule: string; reason: string }
	| { seq: number; at: string; kind: "note"; agent: string; text: string };

type Without<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewForumEvent = Without<ForumEvent, "seq" | "at">;

export class ForumError extends Error {}

export class Forum {
	readonly events: ForumEvent[] = [];
	private readonly threadsById = new Map<string, Thread>();
	private readonly postsByThread = new Map<string, Post[]>();
	private readonly assignmentsById = new Map<string, Assignment>();
	private readonly listeners: Array<(ev: ForumEvent) => void> = [];
	private readonly logPath: string | undefined;
	private readonly now: () => Date;
	private nPosts = 0;

	constructor(opts: { logPath?: string; now?: () => Date } = {}) {
		this.logPath = opts.logPath;
		this.now = opts.now ?? (() => new Date());
		if (this.logPath) mkdirSync(dirname(this.logPath), { recursive: true });
	}

	subscribe(listener: (ev: ForumEvent) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const i = this.listeners.indexOf(listener);
			if (i >= 0) this.listeners.splice(i, 1);
		};
	}

	private emit(ev: NewForumEvent): ForumEvent {
		const full = { ...ev, seq: this.events.length + 1, at: this.now().toISOString() } as ForumEvent;
		this.events.push(full);
		if (this.logPath) appendFileSync(this.logPath, JSON.stringify(full) + "\n");
		for (const l of [...this.listeners]) l(full);
		return full;
	}

	threads(): Thread[] {
		return [...this.threadsById.values()];
	}

	thread(id: string): Thread {
		const t = this.threadsById.get(id);
		if (!t) throw new ForumError(`No thread "${id}". Threads: ${this.threads().map((x) => x.id).join(", ") || "none yet"}.`);
		return t;
	}

	posts(threadId: string): Post[] {
		this.thread(threadId);
		return [...(this.postsByThread.get(threadId) ?? [])];
	}

	assignments(): Assignment[] {
		return [...this.assignmentsById.values()];
	}

	assignmentOf(worker: string): Assignment | undefined {
		return this.assignments().filter((a) => a.worker === worker).at(-1);
	}

	openThread(owner: string, title: string, goal: string): Thread {
		if (!title.trim()) throw new ForumError("A thread needs a title.");
		const t: Thread = {
			id: `T${this.threadsById.size + 1}`,
			title: title.trim(),
			goal: goal.trim(),
			owner,
			participants: [owner],
			status: "open",
			openedAt: this.now().toISOString(),
		};
		this.threadsById.set(t.id, t);
		this.postsByThread.set(t.id, []);
		this.emit({ kind: "thread_opened", thread: { ...t, participants: [...t.participants] } });
		return t;
	}

	addParticipant(threadId: string, agent: string): void {
		const t = this.thread(threadId);
		if (!t.participants.includes(agent)) t.participants.push(agent);
	}

	post(threadId: string, author: string, text: string): Post {
		const t = this.thread(threadId);
		if (t.status === "closed") throw new ForumError(`Thread ${threadId} is closed.`);
		if (!text.trim()) throw new ForumError("A post needs text.");
		// Posting in a thread makes the author a participant of it, so replies there reach it.
		if (!t.participants.includes(author)) t.participants.push(author);
		const p: Post = { id: `P${++this.nPosts}`, thread: threadId, author, text: text.trim(), mentions: mentionsIn(text), at: this.now().toISOString() };
		this.postsByThread.get(threadId)!.push(p);
		this.emit({ kind: "post", post: p });
		return p;
	}

	assign(threadId: string, worker: string, persona: string, instructions: string): Assignment {
		const t = this.thread(threadId);
		if (t.status === "closed") throw new ForumError(`Thread ${threadId} is closed.`);
		const a: Assignment = {
			id: `A${this.assignmentsById.size + 1}`,
			thread: threadId,
			worker,
			persona: persona.trim(),
			instructions: instructions.trim(),
			status: "working",
			assignedAt: this.now().toISOString(),
		};
		this.assignmentsById.set(a.id, a);
		this.addParticipant(threadId, worker);
		this.emit({ kind: "assigned", assignment: { ...a } });
		return a;
	}

	/** Mark a worker's assignment finished (it called finish) or stopped (it ended without finishing, or was stopped). */
	finish(worker: string, status: "finished" | "stopped", summary: string, evidence?: string): Assignment {
		const a = this.assignmentOf(worker);
		if (!a) throw new ForumError(`${worker} has no assignment.`);
		a.status = status;
		a.finishedAt = this.now().toISOString();
		a.summary = summary.trim();
		if (evidence !== undefined) a.evidence = evidence.trim();
		this.emit({ kind: "finished", assignment: { ...a } });
		return a;
	}

	/** A finished worker given more work in its thread goes back to working. */
	reopenAssignment(worker: string): void {
		const a = this.assignmentOf(worker);
		if (a) a.status = "working";
	}

	closeThread(threadId: string, summary: string): Thread {
		const t = this.thread(threadId);
		if (t.status === "closed") throw new ForumError(`Thread ${threadId} is already closed.`);
		t.status = "closed";
		t.closedAt = this.now().toISOString();
		t.closingSummary = summary.trim();
		this.emit({ kind: "thread_closed", thread: { ...t, participants: [...t.participants] } });
		return t;
	}

	refusal(agent: string, tool: string, rule: string, reason: string): void {
		this.emit({ kind: "refusal", agent, tool, rule, reason });
	}

	note(agent: string, text: string): void {
		this.emit({ kind: "note", agent, text });
	}
}

/** One event as an agent reads it in its inbox. */
export function formatEvent(ev: ForumEvent): string {
	switch (ev.kind) {
		case "post":
			return `[${ev.post.thread}] ${ev.post.author}: ${ev.post.text}`;
		case "finished":
			return `[${ev.assignment.thread}] ${ev.assignment.worker} ${ev.assignment.status === "finished" ? "finished its assignment" : "stopped without finishing"}: ${ev.assignment.summary || "(no summary)"}${ev.assignment.evidence ? `\nEvidence: ${ev.assignment.evidence}` : ""}`;
		case "thread_closed":
			return `[${ev.thread.id}] closed by ${ev.thread.owner}: ${ev.thread.closingSummary || "(no summary)"}`;
		case "thread_opened":
			return `[${ev.thread.id}] opened by ${ev.thread.owner}: ${ev.thread.title}`;
		case "assigned":
			return `[${ev.assignment.thread}] ${ev.assignment.worker} assigned`;
		case "refusal":
			return `refused ${ev.agent}'s ${ev.tool} (${ev.rule}): ${ev.reason}`;
		case "note":
			return `${ev.agent}: ${ev.text}`;
	}
}
