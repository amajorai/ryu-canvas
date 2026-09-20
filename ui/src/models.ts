// Per-agent chat-model resolution for the canvas chat node — a faithful port of the
// desktop `lib/models.ts` `modelsForAgent`, so the chat node shows each agent's OWN
// models (Core's live `engineModels` catalog, falling back to the offline table),
// exactly like the composer. The bridge `registry.agents()` supplies each agent's
// engine/model binding.

import type { CanvasAgent, ModelOption } from "./types";

/** Offline fallback used until Core's `engineModels` catalog resolves (or when an
 *  engine isn't in it). Keep in sync with Core's `engine_model_catalog()`. */
const ENGINE_MODELS_FALLBACK: Record<string, ModelOption[]> = {
	claude: [
		{ id: "opus", name: "Opus" },
		{ id: "sonnet", name: "Sonnet" },
		{ id: "fable", name: "Fable" },
		{ id: "haiku", name: "Haiku" },
	],
	codex: [
		{ id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
		{ id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
		{ id: "gpt-5.1", name: "GPT-5.1" },
	],
	gemini: [
		{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
		{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
	],
	pi: [{ id: "default", name: "Default" }],
	hermes: [{ id: "hermes3", name: "Hermes 3" }],
	local: [{ id: "gemma-4-e2b-it", name: "Gemma 4 E2B" }],
	ryu: [{ id: "gemma-4-e2b-it", name: "Gemma 4 E2B" }],
};

/** Resolve the engine id an agent is bound to ("acp:claude" → "claude"). */
function resolveEngine(
	agentId: string | null,
	agents: CanvasAgent[]
): string | null {
	if (!agentId) {
		return null;
	}
	if (agentId.startsWith("acp:")) {
		return agentId.slice("acp:".length);
	}
	const agent = agents.find((a) => a.id === agentId);
	if (!agent) {
		return agentId;
	}
	const engine = agent.engine ?? (agent.recommended ? agent.id : null);
	if (!engine) {
		return null;
	}
	return engine.startsWith("acp:") ? engine.slice("acp:".length) : engine;
}

/** Model options for the active agent's engine. Prefers Core's `engineModels`
 *  catalog, falling back to the offline table, then the agent's own bound model,
 *  then a generic "Auto" entry. Mirrors the desktop composer's `modelsForAgent`. */
export function modelsForAgent(
	agentId: string | null,
	agents: CanvasAgent[],
	catalog: Record<string, ModelOption[]>
): ModelOption[] {
	const engine = resolveEngine(agentId, agents);
	if (engine) {
		const fromCore = catalog[engine];
		if (fromCore && fromCore.length > 0) {
			return fromCore;
		}
		if (ENGINE_MODELS_FALLBACK[engine]) {
			return ENGINE_MODELS_FALLBACK[engine];
		}
	}
	const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
	if (agent?.model) {
		return [{ id: agent.model, name: agent.model }];
	}
	return [{ id: "auto", name: "Auto" }];
}
