// Turning "provider/model-id" into a pi model with credentials, and failing early, by name, when a key is missing.

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Environment variables pi reads for the providers a baseline is likely to use. */
export const PROVIDER_KEYS: Record<string, string> = {
	moonshotai: "MOONSHOT_API_KEY",
	"moonshotai-cn": "MOONSHOT_API_KEY",
	"kimi-coding": "KIMI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	together: "TOGETHER_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
};

export class ModelSpecError extends Error {}

/** "moonshotai/kimi-k3" or "openrouter/moonshotai/kimi-k3": the provider is the first segment. */
export function parseModelSpec(spec: string): { provider: string; id: string } {
	const i = spec.indexOf("/");
	if (i <= 0 || i === spec.length - 1) throw new ModelSpecError(`A model is written provider/model-id, e.g. moonshotai/kimi-k3; got "${spec}".`);
	return { provider: spec.slice(0, i), id: spec.slice(i + 1) };
}

export async function resolveModel(rt: ModelRuntime, spec: string): Promise<Model<any>> {
	const { provider, id } = parseModelSpec(spec);
	const model = rt.getModel(provider, id);
	if (!model) {
		const known = rt.getModels(provider).map((m) => m.id);
		throw new ModelSpecError(
			known.length
				? `pi knows no model "${id}" for provider "${provider}". Known: ${known.filter((k) => k.includes("kimi") || known.length < 30).slice(0, 30).join(", ")}`
				: `pi knows no provider "${provider}".`,
		);
	}
	const auth = await rt.getAuth(model);
	if (!auth) {
		const env = PROVIDER_KEYS[provider];
		throw new ModelSpecError(`No credentials for provider "${provider}"${env ? `: set ${env}` : ""}.`);
	}
	return model;
}
