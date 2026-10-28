// The decorum runtime: one process that hosts the authority agent and its workers as pi sessions, owns the
// forum, delivers forum messages between agents, enforces the rulebook at every tool call, and at the end
// commits what is left and writes the trial's trace (forum.jsonl, one pi session file per agent, summary.json).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Decision, TrialState } from "./enforce.ts";
import { checkAuthorityTool, checkBudget, checkFinishTrial, checkResume, checkSpawn } from "./enforce.ts";
import type { ForumEvent } from "./forum.ts";
import { Forum, ForumError } from "./forum.ts";
import { AUTHORITY, authoritySystemPrompt, digest, WORKER_NUDGE, workerFirstPrompt, workerSystemPrompt } from "./prompts.ts";
import type { Rulebook } from "./rulebook.ts";
import type { ForumHost, WorkerSpec } from "./tools.ts";
import { authorityTools, workerTools } from "./tools.ts";
import { commitAll, createIsolatedWorkspace, headSha, mergeBranch, prepareGit, removeStaleIndexLock, resetToBase } from "./workspace.ts";

export const VERSION = "0.1.0";

export type Mode = "forum" | "single";
export type CommitPolicy = "commit" | "leave";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface RuntimeOptions {
	instruction: string;
	repo: string;
	outDir: string;
	mode: Mode;
	rulebook: Rulebook;
	modelRuntime: ModelRuntime;
	authorityModel: Model<any>;
	workerModel: Model<any>;
	authorityThinking: ThinkingLevel;
	workerThinking: ThinkingLevel;
	/** Where isolated worktrees and pi's private agent dir go. Default: <outDir>/../decorum-work under /tmp. */
	workDir?: string;
	/** How many times the authority may be woken after ending its turn. */
	maxAuthorityWakes?: number;
	/** How many times a worker that stops without finish() is nudged before it is marked stopped. */
	maxWorkerNudges?: number;
	/**
	 * What the benchmark grades. "commit" (DeepSWE: the committed diff from the base): the authority commits and the
	 * runtime commits anything left at the end. "leave" (SWE-bench Pro: the working tree): nobody commits, and if an
	 * agent committed anyway the runtime moves HEAD back to the base, keeping every change in the working tree.
	 */
	commitPolicy?: CommitPolicy;
	/** A wall-clock cap from the benchmark (its agent time limit less a margin for wrapping up); the tighter of this and the rulebook's applies. */
	wallClockSec?: number;
	now?: () => number;
	log?: (line: string) => void;
}

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd: number;
	llmCalls: number;
	compactions: number;
}

interface AgentHandle {
	name: string;
	role: "authority" | "worker";
	session: AgentSession;
	model: string;
	thinking: ThinkingLevel;
	cwd: string;
	branch?: string;
	running: boolean;
	waiting: ((events: ForumEvent[]) => void) | null;
	inbox: ForumEvent[];
	finished: boolean;
	loop: Promise<void> | null;
	nudges: number;
	usage: Usage;
	errors: string[];
	lastText: string;
	/** Forum messages handed to pi's steering queue in the current run, so any pi never delivered can be put back. */
	steered: Array<{ text: string; events: ForumEvent[] }>;
}

export interface Summary {
	decorum_version: string;
	mode: Mode;
	rulebook: Rulebook;
	models: { authority: string; worker: string | null; authority_thinking: ThinkingLevel; worker_thinking: ThinkingLevel | null };
	repo: string;
	started_at: string;
	ended_at: string;
	duration_sec: number;
	end_reason: string;
	base_sha: string | null;
	final_sha: string | null;
	auto_committed: boolean;
	commit_policy: CommitPolicy;
	/** Under "leave": commits agents made that the runtime undid (their changes stay in the working tree). */
	commits_undone: number;
	cost_usd: number;
	tokens: { input: number; output: number; cache_read: number; cache_write: number };
	llm_calls: number;
	authority_wakes: number;
	agents: Array<{
		name: string;
		role: string;
		model: string;
		thinking: ThinkingLevel;
		cwd: string;
		branch: string | null;
		session_file: string | null;
		usage: Usage;
		assignment: { thread: string; persona: string; instructions: string; status: string; summary?: string; evidence?: string } | null;
		errors: string[];
	}>;
	forum: { threads: number; posts: number; assignments: number; refusals: number; events: number };
	refusals: Array<{ agent: string; tool: string; rule: string; reason: string; at: string }>;
	errors: string[];
}

const NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;

export class ForumRuntime implements ForumHost {
	readonly forum: Forum;
	readonly rulebook: Rulebook;
	private readonly o: Required<Omit<RuntimeOptions, "workDir" | "log" | "now">> & { workDir: string; now: () => number; log: (line: string) => void };
	private readonly agents = new Map<string, AgentHandle>();
	private readonly startedAtMs: number;
	private stopped: string | null = null;
	private stopReason = "";
	private readonly abort = new AbortController();
	private authorityWake: (() => void) | null = null;
	private authorityWakes = 0;
	private totalWorkers = 0;
	/** assign_workers calls run one at a time: pi runs a message's tool calls in parallel, and the cap and the names must not race. */
	private assignLock: Promise<unknown> = Promise.resolve();
	private readonly errors: string[] = [];
	private wallTimer: NodeJS.Timeout | null = null;

	constructor(opts: RuntimeOptions) {
		const now = opts.now ?? Date.now;
		this.o = {
			maxAuthorityWakes: 60,
			maxWorkerNudges: 2,
			commitPolicy: "commit",
			wallClockSec: undefined as unknown as number,
			...opts,
			workDir: opts.workDir ?? join("/tmp", "decorum-work"),
			now,
			log: opts.log ?? ((line) => process.stdout.write(line + "\n")),
		};
		// The tighter of the rulebook's clock and the benchmark's is the one enforced, and the one agents are told.
		const ruleWall = opts.rulebook.budget.wall_clock_sec;
		const wall = opts.wallClockSec !== undefined ? (ruleWall === null ? opts.wallClockSec : Math.min(ruleWall, opts.wallClockSec)) : ruleWall;
		this.rulebook = { ...opts.rulebook, budget: { ...opts.rulebook.budget, wall_clock_sec: wall } };
		this.startedAtMs = now();
		mkdirSync(opts.outDir, { recursive: true });
		this.forum = new Forum({ logPath: join(opts.outDir, "forum.jsonl"), now: () => new Date(now()) });
		this.forum.subscribe((ev) => this.route(ev));
	}

	// ---------- the trial ----------

	async run(): Promise<Summary> {
		const startedIso = new Date(this.startedAtMs).toISOString();
		prepareGit(this.o.repo);
		const baseSha = headSha(this.o.repo);
		const wall = this.rulebook.budget.wall_clock_sec;
		if (wall !== null) {
			this.wallTimer = setTimeout(() => {
				const d = checkBudget(this.rulebook, this.state());
				this.stop(d.ok ? "budget.wall_clock_sec" : d.rule, d.ok ? `Wall clock of ${wall} s reached.` : d.reason);
			}, wall * 1000);
		}
		this.log(`decorum ${VERSION}: mode=${this.o.mode} rulebook=${this.rulebook.name} authority=${modelId(this.o.authorityModel)} worker=${this.o.mode === "forum" ? modelId(this.o.workerModel) : "-"} repo=${this.o.repo}`);
		let endReason = "authority_done";
		try {
			const authority = await this.createAgent({
				name: AUTHORITY,
				role: "authority",
				cwd: this.o.repo,
				model: this.o.authorityModel,
				thinking: this.o.authorityThinking,
				appendPrompt:
					this.o.mode === "forum"
						? authoritySystemPrompt(this.rulebook, { repo: this.o.repo, workerModel: modelId(this.o.workerModel), commitPolicy: this.o.commitPolicy })
						: "",
				customTools: (h) => (this.o.mode === "forum" ? authorityTools(this, h) : []),
			});
			endReason = await this.authorityLoop(authority);
		} catch (e) {
			endReason = "error";
			this.errors.push(errorText(e));
			this.log(`error: ${errorText(e)}`);
		}
		if (this.stopped) endReason = this.stopped;
		await this.stopAll(this.stopped ? this.stopReason : "The authority ended the trial.");
		if (this.wallTimer) clearTimeout(this.wallTimer);
		let autoCommitted = false;
		let commitsUndone = 0;
		// An agent's git command killed by a stop can leave index.lock behind; no agent is running now.
		if (removeStaleIndexLock(this.o.repo)) this.log("removed a stale .git/index.lock left by a stopped command");
		if (this.o.commitPolicy === "commit") {
			const c = commitAll(this.o.repo, "decorum: commit work left uncommitted at the end of the trial");
			autoCommitted = c.committed;
			if (!c.ok) this.errors.push(`final commit failed: ${c.output}`);
			if (c.committed) this.log("committed the work left uncommitted at the end of the trial");
		} else if (baseSha) {
			const r = resetToBase(this.o.repo, baseSha);
			commitsUndone = r.commitsUndone;
			if (!r.ok) this.errors.push(`could not move HEAD back to the base: ${r.output}`);
			if (r.commitsUndone) this.log(`agents made ${r.commitsUndone} commit(s); HEAD moved back to the base, every change kept in the working tree`);
		}
		const summary = this.summary({ startedIso, baseSha, endReason, autoCommitted, commitsUndone });
		writeFileSync(join(this.o.outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
		for (const a of this.agents.values()) a.session.dispose();
		this.log(`done: end_reason=${endReason} cost=$${summary.cost_usd.toFixed(4)} agents=${summary.agents.length} threads=${summary.forum.threads} posts=${summary.forum.posts}`);
		return summary;
	}

	private async authorityLoop(m: AgentHandle): Promise<string> {
		let prompt = this.o.instruction;
		for (;;) {
			await this.runPrompt(m, prompt);
			if (this.stopped) return this.stopped;
			if (this.o.mode === "single") return "authority_done";
			if (m.inbox.length === 0 && this.liveWorkers() === 0) {
				const d = checkFinishTrial(this.rulebook, this.state());
				if (d.ok) return "authority_done";
				if (this.authorityWakes >= this.o.maxAuthorityWakes) return "authority_wake_limit";
				// it ended its turn with too small a team: send it back with the reason, and leave a row
				this.forum.refusal(AUTHORITY, "end_turn", d.rule, d.reason);
				this.authorityWakes++;
				prompt = `[rulebook] ${d.reason}`;
				continue;
			}
			if (this.authorityWakes >= this.o.maxAuthorityWakes) {
				this.forum.note("runtime", `The authority was woken ${this.authorityWakes} times; the limit is ${this.o.maxAuthorityWakes}. Ending the trial.`);
				return "authority_wake_limit";
			}
			if (m.inbox.length === 0) await this.untilAuthorityHasMail();
			if (this.stopped) return this.stopped;
			this.authorityWakes++;
			prompt = digest(this.drain(m), this.workerStatusLine());
		}
	}

	private untilAuthorityHasMail(): Promise<void> {
		return new Promise((resolve) => {
			const m = this.agents.get(AUTHORITY)!;
			if (m.inbox.length || this.liveWorkers() === 0 || this.stopped) return resolve();
			this.authorityWake = () => {
				this.authorityWake = null;
				resolve();
			};
		});
	}

	private async workerLoop(w: AgentHandle, first: string): Promise<void> {
		let prompt = first;
		while (!this.stopped) {
			await this.runPrompt(w, prompt);
			if (this.stopped || w.finished) break;
			if (w.inbox.length) {
				prompt = digest(this.drain(w));
				continue;
			}
			if (w.nudges < this.o.maxWorkerNudges) {
				w.nudges++;
				prompt = WORKER_NUDGE;
				continue;
			}
			w.finished = true;
			this.forum.finish(w.name, "stopped", `(stopped without calling finish) ${w.lastText}`.trim());
			break;
		}
		w.loop = null;
		// A post that arrived after finish() but before the loop ended would otherwise wait forever.
		if (!this.stopped && w.finished && w.inbox.some((e) => this.wakesFinished(w, e))) this.revive(w);
		else this.onWorkerIdle();
	}

	private async runPrompt(a: AgentHandle, text: string): Promise<void> {
		a.running = true;
		try {
			await a.session.prompt(text);
		} catch (e) {
			a.errors.push(errorText(e));
			this.log(`${a.name}: prompt failed: ${errorText(e)}`);
		} finally {
			a.running = false;
			this.reclaimSteers(a);
		}
	}

	/**
	 * A message steered after pi's last steering check of a run stays in pi's queue when the run ends. Take any such
	 * messages back into the inbox, in order, so the loop that called runPrompt sees them.
	 */
	private reclaimSteers(a: AgentHandle): void {
		const left = a.session.clearQueue().steering;
		const back: ForumEvent[] = [];
		for (const s of a.steered) if (left.includes(s.text)) back.push(...s.events);
		a.steered = [];
		if (back.length) a.inbox.unshift(...back);
	}

	// ---------- message delivery ----------

	private route(ev: ForumEvent): void {
		let recipients: string[] = [];
		if (ev.kind === "post") {
			// the thread's participants, plus anyone named as @name, wherever they work
			const named = ev.post.mentions.filter((m) => this.agents.has(m));
			recipients = [...new Set([...this.forum.thread(ev.post.thread).participants, ...named])].filter((p) => p !== ev.post.author);
		}
		else if (ev.kind === "finished") {
			const owner = this.forum.thread(ev.assignment.thread).owner;
			if (owner !== ev.assignment.worker) recipients = [owner];
		} else if (ev.kind === "thread_closed") recipients = ev.thread.participants.filter((p) => p !== ev.thread.owner);
		for (const r of recipients) this.deliver(r, ev);
	}

	private deliver(name: string, ev: ForumEvent): void {
		const a = this.agents.get(name);
		if (!a || this.stopped) return;
		a.inbox.push(ev);
		if (a.waiting) {
			const resolve = a.waiting;
			a.waiting = null;
			resolve(this.drain(a));
			return;
		}
		if (a.running) {
			const evs = this.drain(a);
			// A finished worker still in its last turn that is sent back gets its assignment reopened now, so the
			// report it files for the new work is a report, not a repeat.
			if (a.role === "worker" && a.finished && evs.some((e) => this.wakesFinished(a, e))) {
				a.finished = false;
				a.nudges = 0;
				this.forum.reopenAssignment(a.name);
			}
			const text = digest(evs);
			a.steered.push({ text, events: evs });
			a.session.steer(text).catch((e: unknown) => {
				a.steered = a.steered.filter((s) => s.text !== text);
				a.inbox.unshift(...evs);
				a.errors.push(`steer failed: ${errorText(e)}`);
			});
			return;
		}
		if (a.role === "authority") {
			this.authorityWake?.();
			return;
		}
		if (a.finished && !a.loop && this.wakesFinished(a, ev)) this.revive(a);
	}

	/** A finished worker is woken only by the thread's owner or by a post that names it (@name); peers' chatter waits in its inbox. */
	private wakesFinished(w: AgentHandle, ev: ForumEvent): boolean {
		if (ev.kind !== "post") return false;
		return ev.post.author === this.forum.thread(ev.post.thread).owner || ev.post.mentions.includes(w.name);
	}

	/** A finished worker that receives a post in its thread goes back to work, if a slot is free. */
	private revive(w: AgentHandle): void {
		const d = checkResume(this.rulebook, this.state());
		if (!d.ok) {
			// The post stays in its inbox; onWorkerIdle resumes it when a slot frees.
			this.forum.note("runtime", `${w.name} has new messages and will resume when a slot frees: ${d.reason}`);
			return;
		}
		w.finished = false;
		w.nudges = 0;
		this.forum.reopenAssignment(w.name);
		w.loop = this.workerLoop(w, digest(this.drain(w)));
	}

	private drain(a: AgentHandle): ForumEvent[] {
		return a.inbox.splice(0, a.inbox.length);
	}

	private onWorkerIdle(): void {
		if (!this.stopped) {
			for (const w of this.agents.values()) {
				if (w.role === "worker" && w.finished && !w.loop && w.inbox.some((e) => this.wakesFinished(w, e)) && checkResume(this.rulebook, this.state()).ok) this.revive(w);
			}
		}
		if (this.liveWorkers() > 0) return;
		const m = this.agents.get(AUTHORITY);
		if (m?.waiting) {
			const resolve = m.waiting;
			m.waiting = null;
			resolve(this.drain(m));
		}
		this.authorityWake?.();
	}

	// ---------- ForumHost: what the tools call ----------

	assignWorkers(by: string, threadId: string, specs: WorkerSpec[]): Promise<string> {
		const run = this.assignLock.then(() => this.assignWorkersNow(by, threadId, specs));
		this.assignLock = run.catch(() => undefined);
		return run;
	}

	private async assignWorkersNow(by: string, threadId: string, specs: WorkerSpec[]): Promise<string> {
		if (this.stopped) throw new ForumError(`The trial is stopping: ${this.stopReason}`);
		const thread = this.forum.thread(threadId);
		if (thread.status === "closed") throw new ForumError(`Thread ${threadId} is closed.`);
		if (!specs.length) throw new ForumError("Give at least one worker.");
		const d = checkSpawn(this.rulebook, this.state(), specs.length);
		if (!d.ok) this.refuse(by, "assign_workers", d);
		const names: string[] = [];
		for (const spec of specs) {
			let name = spec.name?.trim().toLowerCase();
			if (!name) {
				let i = this.totalWorkers + names.length + 1;
				while (this.agents.has(`w${i}`) || names.includes(`w${i}`)) i++;
				name = `w${i}`;
			}
			if (!NAME_RE.test(name) || name === AUTHORITY) throw new ForumError(`"${name}" is not a valid worker name: lowercase letters, digits and -, starting with a letter.`);
			if (this.agents.has(name) || names.includes(name)) throw new ForumError(`A worker named "${name}" already exists; post in its thread to give it more work, or pick another name.`);
			names.push(name);
		}
		const started: string[] = [];
		for (let i = 0; i < specs.length; i++) {
			const name = names[i]!;
			const spec = specs[i]!;
			let cwd = this.o.repo;
			let branch: string | undefined;
			if (this.rulebook.workspace === "isolated") {
				const ws = createIsolatedWorkspace(this.o.repo, join(this.o.workDir, "worktrees"), name);
				cwd = ws.dir;
				branch = ws.branch;
			}
			const assignment = this.forum.assign(threadId, name, spec.persona, spec.instructions);
			this.totalWorkers++;
			const w = await this.createAgent({
				name,
				role: "worker",
				cwd,
				branch,
				model: this.o.workerModel,
				thinking: this.o.workerThinking,
				appendPrompt: workerSystemPrompt(this.rulebook, { name, cwd, branch, thread: this.forum.thread(threadId), assignment, commitPolicy: this.o.commitPolicy }),
				customTools: (h) => workerTools(this, h),
			});
			w.loop = this.workerLoop(w, workerFirstPrompt(assignment));
			started.push(`${name}${branch ? ` (worktree ${cwd}, branch ${branch})` : ""}`);
			this.log(`${by} assigned ${name} to ${threadId}`);
		}
		return `Started ${started.join(", ")} on ${threadId}. Their messages will reach you as they post or finish.`;
	}

	wait(agent: string, timeoutSec: number, signal: AbortSignal | undefined): Promise<string> {
		const a = this.agents.get(agent)!;
		// A message steered while this agent was busy would otherwise sit in pi's queue until wait returns.
		this.reclaimSteers(a);
		if (a.inbox.length) return Promise.resolve(digest(this.drain(a)));
		if (a.role === "authority" && this.liveWorkers() === 0) return Promise.resolve("No worker is working, so no message will arrive. Continue, or finish.");
		if (this.stopped) return Promise.resolve(`The trial is stopping: ${this.stopReason}`);
		return new Promise((resolve) => {
			const done = (out: string) => {
				clearTimeout(timer);
				a.waiting = null;
				signal?.removeEventListener("abort", onAbort);
				this.abort.signal.removeEventListener("abort", onAbort);
				resolve(out);
			};
			const onAbort = () => done(`Stopped while waiting${this.stopped ? `: ${this.stopReason}` : "."}`);
			const timer = setTimeout(() => done(`No forum message in ${timeoutSec} s. ${this.workerStatusLine()}`), timeoutSec * 1000);
			a.waiting = (evs) => done(evs.length ? digest(evs) : `Every worker has stopped. ${this.workerStatusLine()}`);
			signal?.addEventListener("abort", onAbort, { once: true });
			this.abort.signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	finishWorker(agent: string, summary: string, evidence: string | undefined): string {
		const w = this.agents.get(agent)!;
		if (w.finished) return "You have already finished; the authority has your report. End your turn now.";
		let note = "";
		if (this.rulebook.workspace === "isolated") {
			const c = commitAll(w.cwd, `${agent}: ${summary.split("\n")[0]!.slice(0, 72)}`);
			note = c.committed ? ` Your uncommitted changes were committed on ${w.branch}.` : "";
		}
		this.forum.finish(agent, "finished", summary, evidence);
		w.finished = true;
		return `Finished; the authority has your report.${note} End your turn now.`;
	}

	mergeWorker(worker: string): string {
		const w = this.agents.get(worker);
		if (!w || w.role !== "worker" || !w.branch) throw new ForumError(`No worker "${worker}" with a branch.`);
		if (!w.finished) commitAll(w.cwd, `${worker}: work in progress, committed for a merge`);
		const r = mergeBranch(this.o.repo, w.branch);
		return r.ok ? `Merged ${w.branch}.\n${r.output}` : `The merge of ${w.branch} stopped:\n${r.output}\nResolve it with git in ${this.o.repo}, or run git merge --abort.`;
	}

	overview(_agent: string): string {
		const threads = this.forum.threads();
		const lines = threads.length
			? threads.map((t) => `${t.id} "${t.title}" (${t.status}) owner ${t.owner}; participants ${t.participants.join(", ")}; ${this.forum.posts(t.id).length} posts`)
			: ["(no threads)"];
		return `${lines.join("\n")}\n\n${this.workerStatusLine()}`;
	}

	refuse(agent: string, tool: string, d: Exclude<Decision, { ok: true }>): never {
		if (d.terminate) this.stop(d.rule, d.reason, agent, tool);
		else this.forum.refusal(agent, tool, d.rule, d.reason);
		throw new ForumError(`Refused by the rulebook (${d.rule}): ${d.reason}`);
	}

	// ---------- agents ----------

	private async createAgent(spec: {
		name: string;
		role: "authority" | "worker";
		cwd: string;
		branch?: string;
		model: Model<any>;
		thinking: ThinkingLevel;
		appendPrompt: string;
		customTools: (name: string) => ToolDefinition[];
	}): Promise<AgentHandle> {
		const agentDir = join(this.o.workDir, "pi-agent");
		const runtime = this;
		const loader = new DefaultResourceLoader({
			cwd: spec.cwd,
			agentDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			appendSystemPrompt: spec.appendPrompt ? [spec.appendPrompt] : [],
			extensionFactories: [
				{
					name: "decorum-rulebook",
					factory: (pi) => {
						pi.on("tool_call", async (event) => {
							if (runtime.stopped) return { block: true, reason: `The trial is stopping: ${runtime.stopReason}`, terminate: true };
							const d = checkBudget(runtime.rulebook, runtime.state());
							if (!d.ok) {
								runtime.stop(d.rule, d.reason, spec.name, event.toolName);
								return { block: true, reason: d.reason, terminate: true };
							}
							// the manager rule binds the authority only, and only when there is a forum to manage
							if (spec.role === "authority" && runtime.o.mode === "forum") {
								const a = checkAuthorityTool(runtime.rulebook, event.toolName);
								if (!a.ok) {
									runtime.forum.refusal(spec.name, event.toolName, a.rule, a.reason);
									return { block: true, reason: a.reason };
								}
							}
							return undefined;
						});
					},
				},
			],
		});
		await loader.reload();
		const customTools = spec.customTools(spec.name);
		const { session } = await createAgentSession({
			cwd: spec.cwd,
			agentDir,
			model: spec.model,
			thinkingLevel: spec.thinking,
			modelRuntime: this.o.modelRuntime,
			resourceLoader: loader,
			tools: ["read", "bash", "edit", "write", "grep", "find", "ls", ...customTools.map((t) => t.name)],
			customTools,
			sessionManager: SessionManager.create(spec.cwd, join(this.o.outDir, "sessions", spec.name)),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 4 } }),
		});
		const handle: AgentHandle = {
			name: spec.name,
			role: spec.role,
			session,
			model: modelId(spec.model),
			thinking: spec.thinking,
			cwd: spec.cwd,
			branch: spec.branch,
			running: false,
			waiting: null,
			inbox: [],
			finished: false,
			loop: null,
			nudges: 0,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, llmCalls: 0, compactions: 0 },
			errors: [],
			lastText: "",
			steered: [],
		};
		session.subscribe((ev) => {
			if (ev.type === "compaction_end") {
				// Compaction is an LLM call too, and on a large context an expensive one.
				const cu = ev.result?.usage;
				if (cu) {
					handle.usage.input += cu.input ?? 0;
					handle.usage.output += cu.output ?? 0;
					handle.usage.cacheRead += cu.cacheRead ?? 0;
					handle.usage.cacheWrite += cu.cacheWrite ?? 0;
					handle.usage.costUsd += cu.cost?.total || costFromTable(spec.model, cu);
					handle.usage.llmCalls++;
					handle.usage.compactions++;
				}
				const d = checkBudget(this.rulebook, this.state());
				if (!d.ok) this.stop(d.rule, d.reason);
				return;
			}
			if (ev.type !== "message_end" || ev.message.role !== "assistant") return;
			const m = ev.message;
			const u = m.usage;
			if (u) {
				handle.usage.input += u.input ?? 0;
				handle.usage.output += u.output ?? 0;
				handle.usage.cacheRead += u.cacheRead ?? 0;
				handle.usage.cacheWrite += u.cacheWrite ?? 0;
				handle.usage.costUsd += u.cost?.total || costFromTable(spec.model, u);
			}
			handle.usage.llmCalls++;
			const textOut = m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n").trim();
			if (textOut) handle.lastText = textOut.slice(0, 2000);
			if (m.stopReason === "error" && m.errorMessage) handle.errors.push(m.errorMessage);
			const d = checkBudget(this.rulebook, this.state());
			if (!d.ok) this.stop(d.rule, d.reason);
		});
		this.agents.set(spec.name, handle);
		return handle;
	}

	private liveWorkers(): number {
		let n = 0;
		for (const a of this.agents.values()) if (a.role === "worker" && a.loop) n++;
		return n;
	}

	private state(): TrialState {
		let cost = 0;
		for (const a of this.agents.values()) cost += a.usage.costUsd;
		return { costUsd: cost, startedAtMs: this.startedAtMs, nowMs: this.o.now(), liveWorkers: this.liveWorkers(), totalWorkers: this.totalWorkers };
	}

	private workerStatusLine(): string {
		const ws = [...this.agents.values()].filter((a) => a.role === "worker");
		if (!ws.length) return "Workers: none.";
		return `Workers: ${ws.map((w) => `${w.name} ${w.loop ? "working" : (this.forum.assignmentOf(w.name)?.status ?? "idle")}`).join(", ")}.`;
	}

	/** Stop the trial. A stop for a rule (not the authority's normal end) leaves a refusal row in the forum. */
	stop(rule: string, reason: string, agent = "runtime", tool = "*"): void {
		if (this.stopped) return;
		this.stopped = rule;
		this.stopReason = reason;
		if (rule !== "authority_done") this.forum.refusal(agent, tool, rule, reason);
		this.log(`stopping: ${rule}: ${reason}`);
		this.abort.abort();
		for (const a of this.agents.values()) {
			if (a.waiting) {
				const r = a.waiting;
				a.waiting = null;
				r([]);
			}
			// Abort only ends the active run; pi starts another for anything still queued, so empty the queue first.
			a.session.clearQueue();
			a.steered = [];
			if (a.running) a.session.abort().catch(() => undefined);
		}
		this.authorityWake?.();
	}

	private async stopAll(reason: string): Promise<void> {
		// Mark the trial stopped before aborting, so no loop takes an abort as a cue for another prompt.
		if (!this.stopped) this.stop("authority_done", reason);
		for (const a of this.agents.values()) {
			if (a.running) await a.session.abort().catch(() => undefined);
		}
		await this.assignLock;
		const loops = [...this.agents.values()].map((a) => a.loop).filter((l): l is Promise<void> => l !== null);
		await Promise.allSettled(loops);
		for (const a of this.agents.values()) {
			if (a.role === "worker" && !a.finished) {
				a.finished = true;
				this.forum.finish(a.name, "stopped", `(stopped: ${reason}) ${a.lastText}`.trim());
			}
		}
	}

	private summary(x: { startedIso: string; baseSha: string | null; endReason: string; autoCommitted: boolean; commitsUndone: number }): Summary {
		const agents = [...this.agents.values()];
		const sum = (f: (u: Usage) => number) => agents.reduce((s, a) => s + f(a.usage), 0);
		const refusals = this.forum.events.flatMap((e) => (e.kind === "refusal" ? [{ agent: e.agent, tool: e.tool, rule: e.rule, reason: e.reason, at: e.at }] : []));
		const endMs = this.o.now();
		return {
			decorum_version: VERSION,
			mode: this.o.mode,
			rulebook: this.rulebook,
			models: {
				authority: modelId(this.o.authorityModel),
				worker: this.o.mode === "forum" ? modelId(this.o.workerModel) : null,
				authority_thinking: this.o.authorityThinking,
				worker_thinking: this.o.mode === "forum" ? this.o.workerThinking : null,
			},
			repo: this.o.repo,
			started_at: x.startedIso,
			ended_at: new Date(endMs).toISOString(),
			duration_sec: Math.round((endMs - this.startedAtMs) / 100) / 10,
			end_reason: x.endReason,
			base_sha: x.baseSha,
			final_sha: headSha(this.o.repo),
			auto_committed: x.autoCommitted,
			commit_policy: this.o.commitPolicy,
			commits_undone: x.commitsUndone,
			cost_usd: sum((u) => u.costUsd),
			tokens: { input: sum((u) => u.input), output: sum((u) => u.output), cache_read: sum((u) => u.cacheRead), cache_write: sum((u) => u.cacheWrite) },
			llm_calls: sum((u) => u.llmCalls),
			authority_wakes: this.authorityWakes,
			agents: agents.map((a) => {
				const asg = a.role === "worker" ? this.forum.assignmentOf(a.name) : undefined;
				return {
					name: a.name,
					role: a.role,
					model: a.model,
					thinking: a.thinking,
					cwd: a.cwd,
					branch: a.branch ?? null,
					session_file: a.session.sessionFile ? relative(this.o.outDir, a.session.sessionFile) : null,
					usage: a.usage,
					assignment: asg ? { thread: asg.thread, persona: asg.persona, instructions: asg.instructions, status: asg.status, summary: asg.summary, evidence: asg.evidence } : null,
					errors: a.errors,
				};
			}),
			forum: {
				threads: this.forum.threads().length,
				posts: this.forum.events.filter((e) => e.kind === "post").length,
				assignments: this.forum.assignments().length,
				refusals: refusals.length,
				events: this.forum.events.length,
			},
			refusals,
			errors: this.errors,
		};
	}

	private log(line: string): void {
		this.o.log(`[${new Date(this.o.now()).toISOString()}] ${line}`);
	}
}

export function modelId(m: Model<any>): string {
	return `${m.provider}/${m.id}`;
}

/** Dollars from the model's price table, for a provider that reports tokens but no cost. */
function costFromTable(m: Model<any>, u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): number {
	const c = m.cost;
	if (!c) return 0;
	return ((u.input ?? 0) * c.input + (u.output ?? 0) * c.output + (u.cacheRead ?? 0) * c.cacheRead + (u.cacheWrite ?? 0) * c.cacheWrite) / 1e6;
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
