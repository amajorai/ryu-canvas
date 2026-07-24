import { describe, expect, it } from "bun:test";
import { modelsForAgent } from "./models.ts";
import type { CanvasAgent, ModelOption } from "./types.ts";

function agent(overrides: Partial<CanvasAgent> = {}): CanvasAgent {
	return {
		id: "a1",
		name: "Agent One",
		engine: null,
		model: null,
		recommended: false,
		...overrides,
	};
}

const EMPTY_CATALOG: Record<string, ModelOption[]> = {};

describe("modelsForAgent", () => {
	it("returns the Auto fallback for a null agent id", () => {
		expect(modelsForAgent(null, [], EMPTY_CATALOG)).toEqual([
			{ id: "auto", name: "Auto" },
		]);
	});

	it("resolves an acp:-prefixed agent id to its engine and uses the offline table", () => {
		const models = modelsForAgent("acp:claude", [], EMPTY_CATALOG);
		expect(models.map((m) => m.id)).toContain("opus");
		expect(models.map((m) => m.id)).toContain("haiku");
	});

	it("prefers Core's live catalog over the offline fallback", () => {
		const catalog = {
			claude: [{ id: "opus-live", name: "Opus (live)" }],
		};
		expect(modelsForAgent("acp:claude", [], catalog)).toEqual([
			{ id: "opus-live", name: "Opus (live)" },
		]);
	});

	it("ignores an empty catalog entry and falls back to the offline table", () => {
		const catalog = { claude: [] as ModelOption[] };
		const models = modelsForAgent("acp:claude", [], catalog);
		expect(models.length).toBeGreaterThan(0);
		expect(models.map((m) => m.id)).toContain("sonnet");
	});

	it("resolves an agent's bound engine from the agents list", () => {
		const agents = [agent({ id: "a1", engine: "gemini" })];
		const models = modelsForAgent("a1", agents, EMPTY_CATALOG);
		expect(models.map((m) => m.id)).toContain("gemini-2.5-pro");
	});

	it("uses a recommended agent's own id as its engine when engine is unset", () => {
		// A recommended agent whose id IS an engine key (e.g. the built-in codex).
		const agents = [agent({ id: "codex", engine: null, recommended: true })];
		const models = modelsForAgent("codex", agents, EMPTY_CATALOG);
		expect(models.map((m) => m.id)).toContain("gpt-5.1-codex");
	});

	it("strips an acp: prefix off a resolved engine binding", () => {
		const agents = [agent({ id: "a1", engine: "acp:gemini" })];
		const models = modelsForAgent("a1", agents, EMPTY_CATALOG);
		expect(models.map((m) => m.id)).toContain("gemini-2.5-flash");
	});

	it("falls back to the agent's own model when the engine has no known models", () => {
		const agents = [agent({ id: "a1", engine: "unknown-engine", model: "my-model" })];
		expect(modelsForAgent("a1", agents, EMPTY_CATALOG)).toEqual([
			{ id: "my-model", name: "my-model" },
		]);
	});

	it("returns Auto when the agent id is unknown and resolves to a bare engine with no models", () => {
		// resolveEngine returns the id itself when the agent isn't in the list; with
		// no catalog/fallback entry and no agent record, it lands on Auto.
		expect(modelsForAgent("ghost-engine", [], EMPTY_CATALOG)).toEqual([
			{ id: "auto", name: "Auto" },
		]);
	});

	it("returns Auto for an unknown agent with a non-recommended, engine-less record", () => {
		const agents = [agent({ id: "a1", engine: null, recommended: false })];
		// resolveEngine → engine null → no engine branch; agent.model null → Auto.
		expect(modelsForAgent("a1", agents, EMPTY_CATALOG)).toEqual([
			{ id: "auto", name: "Auto" },
		]);
	});
});
