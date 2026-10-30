#!/usr/bin/env node
// decorum-forum: run one trial of the base forum (or a single agent, or one of EvoMAS's systems) on a repository.
//
//   node src/main.ts run --instruction-file task.md --repo /app --out /logs/agent/decorum \
//     --mode forum --authority-model moonshotai/kimi-k3 --worker-model moonshotai/kimi-k2.7-code \
//     [--rulebook rulebooks/base-0.yaml] [--authority-thinking high] [--worker-thinking high]
//
// In vote and peer-review mode (EvoMAS's systems, evomas.ts) --workers N is the agents in each layer, on --worker-model,
// and the aggregator, on --authority-model
// at --authority-thinking, writes the final patch from theirs.
//
// Exit 0: the trial ran (whatever its end reason; see summary.json). Exit 2: a configuration error, named.
// Exit 1: the runtime crashed; summary.json may be missing.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerFaux } from "./faux.ts";
import { ModelSpecError, resolveModel } from "./models.ts";
import { BASE_RULEBOOK, loadRulebook, RulebookError, withBudget } from "./rulebook.ts";
import type { CommitPolicy, Mode, ThinkingLevel } from "./runtime.ts";
import { ForumRuntime } from "./runtime.ts";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const USAGE = `usage: decorum-forum run --instruction-file F --repo DIR --out DIR [--mode forum|single|vote|peer-review]
  --authority-model provider/id [--worker-model provider/id] [--rulebook FILE]
  [--workers N] [--instance-id ID] [--aggregator-reserve F]   (vote, peer-review: N agents per layer, the task's id,
                                                               the read-only layers' share 0-0.9)
  [--authority-thinking LEVEL] [--worker-thinking LEVEL] [--work-dir DIR] [--faux smoke]
  [--commit-policy commit|leave] [--wall-clock-sec N] [--max-authority-wakes N]
  [--min-workers N] [--max-workers N] [--max-live-workers N] [--budget-usd X]   (override the rulebook's budget)`;

class ConfigError extends Error {}

async function main(argv: string[]): Promise<number> {
	const [cmd, ...rest] = argv;
	if (cmd !== "run") {
		process.stderr.write(USAGE + "\n");
		return cmd === "--help" || cmd === "-h" ? 0 : 2;
	}
	const { values: v } = parseArgs({
		args: rest,
		options: {
			"instruction-file": { type: "string" },
			instruction: { type: "string" },
			repo: { type: "string" },
			out: { type: "string" },
			mode: { type: "string", default: "forum" },
			"authority-model": { type: "string" },
			"worker-model": { type: "string" },
			rulebook: { type: "string" },
			"authority-thinking": { type: "string", default: "high" },
			"worker-thinking": { type: "string", default: "high" },
			"work-dir": { type: "string" },
			faux: { type: "string" },
			"commit-policy": { type: "string", default: "commit" },
			"wall-clock-sec": { type: "string" },
			"max-authority-wakes": { type: "string" },
			"min-workers": { type: "string" },
			"max-workers": { type: "string" },
			"max-live-workers": { type: "string" },
			"budget-usd": { type: "string" },
			workers: { type: "string" },
			"instance-id": { type: "string", default: "" },
			"aggregator-reserve": { type: "string" },
		},
		strict: true,
	});
	const need = (k: string): string => {
		const x = (v as Record<string, unknown>)[k];
		if (typeof x !== "string" || !x) throw new ConfigError(`--${k} is required.\n${USAGE}`);
		return x;
	};
	const instruction = v.instruction ?? readFileSync(need("instruction-file"), "utf8");
	const repo = resolve(need("repo"));
	const outDir = resolve(need("out"));
	const mode = v.mode as Mode;
	if (!["forum", "single", "vote", "peer-review"].includes(mode)) throw new ConfigError(`--mode must be forum, single, vote or peer-review, got "${mode}".`);
	const agentsPerLayer = v.workers === undefined ? undefined : Number(v.workers);
	if (agentsPerLayer !== undefined && (!Number.isInteger(agentsPerLayer) || agentsPerLayer < 1 || agentsPerLayer > 20)) {
		throw new ConfigError(`--workers must be a whole number from 1 to 20, got "${v.workers}".`);
	}
	const reserveText = v["aggregator-reserve"];
	const aggregatorReserve = reserveText === undefined ? undefined : Number(reserveText);
	if (aggregatorReserve !== undefined && (reserveText!.trim() === "" || !(aggregatorReserve >= 0 && aggregatorReserve <= 0.9))) {
		throw new ConfigError(`--aggregator-reserve must be a share from 0 to 0.9, got "${reserveText}".`);
	}
	for (const k of ["authority-thinking", "worker-thinking"] as const) {
		if (!THINKING.includes(v[k]!)) throw new ConfigError(`--${k} must be one of ${THINKING.join(", ")}.`);
	}
	const num = (k: "min-workers" | "max-workers" | "max-live-workers" | "budget-usd"): number | undefined => {
		const x = v[k];
		if (x === undefined) return undefined;
		const n = Number(x);
		if (x.trim() === "" || !Number.isFinite(n)) throw new ConfigError(`--${k} must be a number, got "${x}".`);
		return n;
	};
	const rulebook = withBudget(v.rulebook ? loadRulebook(v.rulebook) : BASE_RULEBOOK, {
		min_workers_total: num("min-workers"),
		max_workers_total: num("max-workers"),
		max_live_workers: num("max-live-workers"),
		usd_per_trial: num("budget-usd"),
	});
	const commitPolicy = v["commit-policy"] as CommitPolicy;
	if (commitPolicy !== "commit" && commitPolicy !== "leave") throw new ConfigError(`--commit-policy must be commit or leave, got "${commitPolicy}".`);
	const wallClockSec = v["wall-clock-sec"] === undefined ? undefined : Number(v["wall-clock-sec"]);
	if (wallClockSec !== undefined && !(wallClockSec > 0)) throw new ConfigError(`--wall-clock-sec must be a positive number of seconds.`);
	mkdirSync(outDir, { recursive: true });
	const logFile = join(outDir, "runtime.log");
	const log = (line: string) => {
		process.stdout.write(line + "\n");
		appendFileSync(logFile, line + "\n");
	};

	process.env.PI_TELEMETRY ??= "0";
	const workDir = resolve(v["work-dir"] ?? "/tmp/decorum-work");
	const modelRuntime = await ModelRuntime.create({ authPath: join(workDir, "pi-auth.json"), modelsPath: join(workDir, "pi-models.json") });
	let authoritySpec = v["authority-model"];
	let workerSpec = v["worker-model"];
	if (v.faux) {
		if (v.faux !== "smoke") throw new ConfigError(`--faux knows only "smoke".`);
		registerFaux(modelRuntime);
		authoritySpec = "faux/authority";
		workerSpec = "faux/worker";
	}
	if (!authoritySpec) throw new ConfigError(`--authority-model is required.\n${USAGE}`);
	if (mode !== "single" && !workerSpec) throw new ConfigError(`--worker-model is required in ${mode} mode.`);
	const authorityModel = await resolveModel(modelRuntime, authoritySpec);
	const workerModel = mode === "single" ? authorityModel : await resolveModel(modelRuntime, workerSpec!);

	const rt = new ForumRuntime({
		instruction,
		repo,
		outDir,
		mode,
		rulebook,
		modelRuntime,
		authorityModel,
		workerModel,
		authorityThinking: v["authority-thinking"] as ThinkingLevel,
		workerThinking: v["worker-thinking"] as ThinkingLevel,
		workDir,
		commitPolicy,
		wallClockSec,
		maxAuthorityWakes: v["max-authority-wakes"] ? Number(v["max-authority-wakes"]) : undefined,
		agentsPerLayer,
		instanceId: v["instance-id"],
		aggregatorReserve,
		log,
	});
	const onSignal = (sig: string) => rt.stop("signal", `Received ${sig}.`);
	process.once("SIGTERM", () => onSignal("SIGTERM"));
	process.once("SIGINT", () => onSignal("SIGINT"));
	await rt.run();
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(e: unknown) => {
		const configError = e instanceof ConfigError || e instanceof RulebookError || e instanceof ModelSpecError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
		process.stderr.write(`decorum-forum: ${e instanceof Error ? e.message : String(e)}\n`);
		process.exit(configError ? 2 : 1);
	},
);
