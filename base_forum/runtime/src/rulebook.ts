// The typed rulebook. Every rule has a fixed set of values, a description an agent reads, and an
// enforcement point in enforce.ts. Unknown keys and unknown values are refused, naming the line's key,
// so a rulebook an optimizer writes can never silently mean something the runtime does not do.

import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type Visibility = "all" | "participants";
export type Posting = "all" | "participants";
export type Workspace = "shared" | "isolated";
export type Closing = "self" | "evidence";
export type AuthorityRole = "manager" | "player";

export interface Budget {
	/** Dollars for the whole trial, all agents together. null = no cap. */
	usd_per_trial: number | null;
	/** Workers working at the same time. */
	max_live_workers: number;
	/** Workers started over the whole trial. null = no cap. */
	max_workers_total: number | null;
	/** Workers the authority must have started before it may end the trial (forum mode). 0 = none required. */
	min_workers_total: number;
	/** Seconds from start to forced finish. null = no cap. */
	wall_clock_sec: number | null;
}

export interface Rulebook {
	name: string;
	description: string;
	/** Which threads an agent may read. */
	visibility: Visibility;
	/** Which threads an agent may post in. */
	posting: Posting;
	/** Whether workers share the authority's checkout or each get a git worktree on its own branch. */
	workspace: Workspace;
	/** What a worker must give to finish its assignment. */
	closing: Closing;
	/** manager: the authority may not write or edit files, workers make every change; player: it may. */
	authority: AuthorityRole;
	budget: Budget;
	/** Prompt-only norms: text every agent reads, enforced by nothing. */
	norms: string;
}

const CHOICES = {
	visibility: ["all", "participants"],
	posting: ["all", "participants"],
	workspace: ["shared", "isolated"],
	closing: ["self", "evidence"],
	authority: ["manager", "player"],
} as const;

export const BASE_RULEBOOK: Rulebook = {
	name: "base-0",
	description: "The open forum with a manager: the authority runs the work through workers and does not edit files itself; anyone reads and posts anywhere, workers share the checkout, a worker closes its own assignment; beyond that only the trial's limits are enforced.",
	visibility: "all",
	posting: "all",
	workspace: "shared",
	closing: "self",
	authority: "manager",
	budget: { usd_per_trial: 10, max_live_workers: 4, max_workers_total: 6, min_workers_total: 3, wall_clock_sec: 9000 },
	norms: "",
};

export class RulebookError extends Error {}

function choice<K extends keyof typeof CHOICES>(key: K, value: unknown, source: string): (typeof CHOICES)[K][number] {
	const allowed = CHOICES[key] as readonly string[];
	if (typeof value !== "string" || !allowed.includes(value)) {
		throw new RulebookError(`${source}: ${key} must be one of ${allowed.join(" | ")}, got ${JSON.stringify(value)}`);
	}
	return value as (typeof CHOICES)[K][number];
}

function numberOrNull(key: string, value: unknown, source: string, { min, integer }: { min: number; integer: boolean }): number | null {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
		throw new RulebookError(`${source}: budget.${key} must be ${integer ? "an integer" : "a number"} >= ${min} or null, got ${JSON.stringify(value)}`);
	}
	return value;
}

/** Parse and validate a rulebook. Missing keys take the base-0 value; unknown keys are an error. */
export function parseRulebook(text: string, source = "rulebook"): Rulebook {
	const raw: unknown = parse(text) ?? {};
	if (typeof raw !== "object" || Array.isArray(raw)) throw new RulebookError(`${source}: the rulebook must be a YAML mapping`);
	const data = raw as Record<string, unknown>;
	const known = new Set(["name", "description", "visibility", "posting", "workspace", "closing", "authority", "budget", "norms"]);
	for (const key of Object.keys(data)) {
		if (!known.has(key)) throw new RulebookError(`${source}: unknown rule "${key}" (known: ${[...known].join(", ")})`);
	}
	const budgetRaw = data.budget ?? {};
	if (typeof budgetRaw !== "object" || budgetRaw === null || Array.isArray(budgetRaw)) {
		throw new RulebookError(`${source}: budget must be a mapping`);
	}
	const b = budgetRaw as Record<string, unknown>;
	const budgetKeys = new Set(["usd_per_trial", "max_live_workers", "max_workers_total", "min_workers_total", "wall_clock_sec"]);
	for (const key of Object.keys(b)) {
		if (!budgetKeys.has(key)) throw new RulebookError(`${source}: unknown budget key "${key}" (known: ${[...budgetKeys].join(", ")})`);
	}
	const base = BASE_RULEBOOK;
	const pick = (key: string, fallback: unknown) => (key in b ? b[key] : fallback);
	const maxLive = numberOrNull("max_live_workers", pick("max_live_workers", base.budget.max_live_workers), source, { min: 0, integer: true });
	if (maxLive === null) throw new RulebookError(`${source}: budget.max_live_workers cannot be null`);
	const maxTotal = numberOrNull("max_workers_total", pick("max_workers_total", base.budget.max_workers_total), source, { min: 0, integer: true });
	const minTotal = numberOrNull("min_workers_total", pick("min_workers_total", base.budget.min_workers_total), source, { min: 0, integer: true });
	if (minTotal === null) throw new RulebookError(`${source}: budget.min_workers_total cannot be null (use 0 for none)`);
	if (maxTotal !== null && minTotal > maxTotal) throw new RulebookError(`${source}: budget.min_workers_total (${minTotal}) is more than budget.max_workers_total (${maxTotal})`);
	const str = (key: string, fallback: string) => {
		const v = key in data ? data[key] : fallback;
		if (typeof v !== "string") throw new RulebookError(`${source}: ${key} must be a string`);
		return v;
	};
	return {
		name: str("name", base.name),
		description: str("description", ""),
		visibility: choice("visibility", data.visibility ?? base.visibility, source),
		posting: choice("posting", data.posting ?? base.posting, source),
		workspace: choice("workspace", data.workspace ?? base.workspace, source),
		closing: choice("closing", data.closing ?? base.closing, source),
		authority: choice("authority", data.authority ?? base.authority, source),
		budget: {
			usd_per_trial: numberOrNull("usd_per_trial", pick("usd_per_trial", base.budget.usd_per_trial), source, { min: 0, integer: false }),
			max_live_workers: maxLive,
			max_workers_total: maxTotal,
			min_workers_total: minTotal,
			wall_clock_sec: numberOrNull("wall_clock_sec", pick("wall_clock_sec", base.budget.wall_clock_sec), source, { min: 1, integer: false }),
		},
		norms: str("norms", base.norms),
	};
}

/** "between 3 and 6 workers in the trial", "at least 3 workers", "at most 6 workers", or "any number of workers". */
export function workerRange(rb: Rulebook): string {
	const { min_workers_total: min, max_workers_total: max } = rb.budget;
	if (min > 0 && max !== null) return min === max ? `exactly ${min} workers in the trial` : `between ${min} and ${max} workers in the trial`;
	if (min > 0) return `at least ${min} workers in the trial`;
	if (max !== null) return `at most ${max} workers in the trial`;
	return "any number of workers";
}

export function loadRulebook(path: string): Rulebook {
	return parseRulebook(readFileSync(path, "utf8"), path);
}

/** The rules as an agent reads them, one line per rule, in the words the enforcement uses. */
export function describeRules(rb: Rulebook): string {
	const lines = [
		`Rulebook "${rb.name}". The runtime enforces these; a tool call that breaks one is refused with the reason.`,
		rb.visibility === "all" ? "- Visibility: you may read every thread." : "- Visibility: you may read only threads you participate in.",
		rb.posting === "all" ? "- Posting: you may post in any thread." : "- Posting: you may post only in threads you participate in.",
		rb.workspace === "shared"
			? "- Workspace: all agents work in the same checkout; other agents may be editing files at the same time."
			: "- Workspace: each worker works in its own git worktree on its own branch; the authority merges finished work.",
		rb.authority === "manager"
			? "- Authority: the authority manages; it may not write or edit files, and workers make every change."
			: "- Authority: the authority may also write and edit files itself.",
		rb.closing === "self"
			? "- Closing: a worker finishes its own assignment with a summary."
			: "- Closing: a worker finishes only with evidence: the commands it ran to check the work and what they printed.",
		`- Budget: ${rb.budget.usd_per_trial === null ? "no dollar cap" : `$${rb.budget.usd_per_trial} for the whole trial, all agents together`}; ${workerRange(rb)}, at most ${rb.budget.max_live_workers} at a time; ${rb.budget.wall_clock_sec === null ? "no time limit" : `${Math.round(rb.budget.wall_clock_sec / 60)} minutes of wall clock`}. When the budget runs out every agent is stopped and whatever is committed is graded.`,
	];
	if (rb.norms.trim()) lines.push(`Norms (not enforced, but expected):\n${rb.norms.trim()}`);
	return lines.join("\n");
}
