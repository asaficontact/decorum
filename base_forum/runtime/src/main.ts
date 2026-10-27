#!/usr/bin/env node
// decorum-forum: run one trial of the base forum (or a single agent) on a repository.
//
//   node src/main.ts run --instruction-file task.md --repo /app --out /logs/agent/decorum \
//     --mode forum --authority-model moonshotai/kimi-k3 --worker-model moonshotai/kimi-k2.7-code \
//     [--rulebook rulebooks/base-0.yaml] [--authority-thinking high] [--worker-thinking high]
//
// Exit 0: the trial ran (whatever its end reason; see summary.json). Exit 2: a configuration error, named.
// Exit 1: the runtime crashed; summary.json may be missing.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerFaux } from "./faux.ts";
import { ModelSpecError, resolveModel } from "./models.ts";
import { BASE_RULEBOOK, loadRulebook, RulebookError } from "./rulebook.ts";
import type { Mode, ThinkingLevel } from "./runtime.ts";
import { ForumRuntime } from "./runtime.ts";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const USAGE = `usage: decorum-forum run --instruction-file F --repo DIR --out DIR [--mode forum|single]
  --authority-model provider/id [--worker-model provider/id] [--rulebook FILE]
  [--authority-thinking LEVEL] [--worker-thinking LEVEL] [--work-dir DIR] [--faux smoke]
  [--no-final-commit] [--max-authority-wakes N]`;

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
			"no-final-commit": { type: "boolean", default: false },
			"max-authority-wakes": { type: "string" },
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
	if (mode !== "forum" && mode !== "single") throw new ConfigError(`--mode must be forum or single, got "${mode}".`);
	for (const k of ["authority-thinking", "worker-thinking"] as const) {
		if (!THINKING.includes(v[k]!)) throw new ConfigError(`--${k} must be one of ${THINKING.join(", ")}.`);
	}
	const rulebook = v.rulebook ? loadRulebook(v.rulebook) : BASE_RULEBOOK;
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
	if (mode === "forum" && !workerSpec) throw new ConfigError("--worker-model is required in forum mode.");
	const authorityModel = await resolveModel(modelRuntime, authoritySpec);
	const workerModel = mode === "forum" ? await resolveModel(modelRuntime, workerSpec!) : authorityModel;

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
		finalCommit: !v["no-final-commit"],
		maxAuthorityWakes: v["max-authority-wakes"] ? Number(v["max-authority-wakes"]) : undefined,
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
