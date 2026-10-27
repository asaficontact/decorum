// Every rule's enforcement point, as pure decisions. The runtime calls these from the tool-call hook and
// from the forum tools; a refusal is returned to the agent as the tool's result and logged in the forum.

import type { Rulebook } from "./rulebook.ts";

export type Decision = { ok: true } | { ok: false; rule: string; reason: string; terminate: boolean };

export const OK: Decision = { ok: true };

export interface TrialState {
	costUsd: number;
	startedAtMs: number;
	nowMs: number;
	liveWorkers: number;
	totalWorkers: number;
}

/** Budget: dollars and wall clock. Checked before every tool call and after every model response. */
export function checkBudget(rb: Rulebook, s: TrialState): Decision {
	const { usd_per_trial, wall_clock_sec } = rb.budget;
	if (usd_per_trial !== null && s.costUsd >= usd_per_trial) {
		return { ok: false, rule: "budget.usd_per_trial", reason: `The trial has spent $${s.costUsd.toFixed(2)} of its $${usd_per_trial} budget; every agent is being stopped.`, terminate: true };
	}
	if (wall_clock_sec !== null && s.nowMs - s.startedAtMs >= wall_clock_sec * 1000) {
		return { ok: false, rule: "budget.wall_clock_sec", reason: `The trial has run ${Math.round((s.nowMs - s.startedAtMs) / 1000)} s of its ${wall_clock_sec} s limit; every agent is being stopped.`, terminate: true };
	}
	return OK;
}

/** Budget: how many workers may start now. */
export function checkSpawn(rb: Rulebook, s: TrialState, requested: number): Decision {
	const { max_live_workers, max_workers_total } = rb.budget;
	if (s.liveWorkers + requested > max_live_workers) {
		return { ok: false, rule: "budget.max_live_workers", reason: `At most ${max_live_workers} workers may work at once; ${s.liveWorkers} are working and you asked for ${requested} more. Wait for one to finish, or assign fewer.`, terminate: false };
	}
	if (max_workers_total !== null && s.totalWorkers + requested > max_workers_total) {
		return { ok: false, rule: "budget.max_workers_total", reason: `At most ${max_workers_total} workers may be started in this trial; ${s.totalWorkers} have been. Reuse a worker by posting to its thread.`, terminate: false };
	}
	return OK;
}

/** Visibility: may this agent read this thread? The authority owns every thread, so it always may. */
export function checkRead(rb: Rulebook, agent: string, participants: readonly string[]): Decision {
	if (rb.visibility === "all" || participants.includes(agent)) return OK;
	return { ok: false, rule: "visibility", reason: "Under this rulebook you may read only threads you participate in.", terminate: false };
}

/** Posting: may this agent post in this thread? */
export function checkPost(rb: Rulebook, agent: string, participants: readonly string[]): Decision {
	if (rb.posting === "all" || participants.includes(agent)) return OK;
	return { ok: false, rule: "posting", reason: "Under this rulebook you may post only in threads you participate in.", terminate: false };
}

/** Closing: what a worker must give to finish. */
export function checkFinish(rb: Rulebook, evidence: string | undefined): Decision {
	if (rb.closing === "self") return OK;
	if (evidence && evidence.trim().length >= 20) return OK;
	return { ok: false, rule: "closing", reason: "Under this rulebook you may finish only with evidence: give the commands you ran to check the work and what they printed (at least a line).", terminate: false };
}
