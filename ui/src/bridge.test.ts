import { afterEach, describe, expect, it } from "bun:test";
import {
	fetchIconSvg,
	generateText,
	iconSvgUrl,
	loadRegistry,
	loadScene,
	saveScene,
	searchIcons,
	searchLogos,
	svgDataUrl,
} from "./bridge.ts";

import type { RyuAgent, RyuModel, RyuSpaces } from "./ryu.d.ts";

// ── Fakes: window.ryu + global fetch. Set/torn-down per test (no mock.module). ─

type BridgeInput =
	| Parameters<RyuSpaces["getDoc"]>[0]
	| Parameters<RyuSpaces["updateDoc"]>[0]
	| Parameters<RyuModel["complete"]>[0]
	| Parameters<RyuAgent["run"]>[0];
type Calls<T = BridgeInput> = { method: string; args: T[] }[];

function setWindow<T>(ryu: T): void {
	Object.assign(globalThis, { window: { ryu } });
}

function stubFetch<T>(
	impl: (url: string) => {
		ok: boolean;
		status?: number;
		json?: () => Promise<T>;
		text?: () => Promise<string>;
	}
): void {
	globalThis.fetch = Object.assign(
		async (input: Parameters<typeof fetch>[0]) => {
			const fixture = impl(String(input));
			const body = fixture.json
				? JSON.stringify(await fixture.json())
				: fixture.text
					? await fixture.text()
					: null;
			return new Response(body, {
				status: fixture.status ?? (fixture.ok ? 200 : 500),
			});
		},
		{ preconnect: realFetch.preconnect }
	);
}

const realFetch = globalThis.fetch;

afterEach(() => {
	Object.assign(globalThis, { window: undefined });
	globalThis.fetch = realFetch;
});

// ── svgDataUrl (pure) ────────────────────────────────────────────────────────

describe("svgDataUrl", () => {
	it("base64-encodes markup as an svg+xml data URL", () => {
		const url = svgDataUrl("<svg/>");
		expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
		const b64 = url.split(",")[1] ?? "";
		expect(atob(b64)).toBe("<svg/>");
	});

	it("survives non-ASCII markup", () => {
		const svg = "<text>café ☕</text>";
		const url = svgDataUrl(svg);
		// Round-trip through the same decode the browser would apply.
		const decoded = decodeURIComponent(escape(atob(url.split(",")[1] ?? "")));
		expect(decoded).toBe(svg);
	});
});

// ── iconSvgUrl (pure) ────────────────────────────────────────────────────────

describe("iconSvgUrl", () => {
	it("converts the icon id colon to a path slash with no query when no opts", () => {
		expect(iconSvgUrl("lucide:home")).toBe(
			"https://api.iconify.design/lucide/home.svg"
		);
	});

	it("adds a color query param", () => {
		expect(iconSvgUrl("lucide:home", { color: "#888888" })).toBe(
			"https://api.iconify.design/lucide/home.svg?color=%23888888"
		);
	});

	it("adds width and height for a size", () => {
		const url = iconSvgUrl("lucide:home", { size: 24 });
		expect(url).toContain("width=24");
		expect(url).toContain("height=24");
	});

	it("combines color and size params", () => {
		const url = iconSvgUrl("lucide:home", { color: "#000", size: 16 });
		expect(url).toContain("color=");
		expect(url).toContain("width=16");
	});
});

// ── loadScene (bridge fake) ──────────────────────────────────────────────────

describe("loadScene", () => {
	function withDoc(
		doc: { source: string; title: string } | null
	): Calls<Parameters<RyuSpaces["getDoc"]>[0]> {
		const calls: Calls<Parameters<RyuSpaces["getDoc"]>[0]> = [];
		setWindow({
			spaces: {
				getDoc: (...args: Parameters<RyuSpaces["getDoc"]>) => {
					calls.push({ method: "getDoc", args });
					return Promise.resolve(doc);
				},
			},
		});
		return calls;
	}

	it("returns null for an empty or whitespace-only source", async () => {
		withDoc({ source: "   ", title: "Board" });
		expect(await loadScene("d1")).toBeNull();
	});

	it("returns null when the document is missing", async () => {
		withDoc(null);
		expect(await loadScene("d1")).toBeNull();
	});

	it("parses a valid scene and preserves nodes, edges, viewport", async () => {
		withDoc({
			source: JSON.stringify({
				name: "My Graph",
				nodes: [{ id: "n1" }],
				edges: [{ from: "n1", to: "n2" }],
				viewport: { x: 1, y: 2, zoom: 1.5 },
			}),
			title: "ignored",
		});
		const scene = await loadScene("d1");
		expect(scene).toEqual({
			name: "My Graph",
			nodes: [{ id: "n1" }],
			edges: [{ from: "n1", to: "n2" }],
			viewport: { x: 1, y: 2, zoom: 1.5 },
		});
	});

	it("falls back to the doc title and coerces non-array fields", async () => {
		withDoc({
			source: JSON.stringify({ nodes: "not-array", edges: null }),
			title: "Doc Title",
		});
		const scene = await loadScene("d1");
		expect(scene).toMatchObject({ name: "Doc Title", nodes: [], edges: [] });
	});

	it("discards a malformed persisted viewport instead of forwarding it to React Flow", async () => {
		withDoc({
			source: JSON.stringify({
				name: "Recovered",
				nodes: [],
				edges: [],
				viewport: { x: 12, y: Number.NaN, zoom: -1 },
			}),
			title: "Board",
		});
		const scene = await loadScene("d1");
		expect(scene).toEqual({ name: "Recovered", nodes: [], edges: [] });
	});

	it("returns an empty titled scene when the source is invalid JSON", async () => {
		withDoc({ source: "{ not json", title: "Broken" });
		expect(await loadScene("d1")).toEqual({
			name: "Broken",
			nodes: [],
			edges: [],
		});
	});
});

// ── saveScene (bridge fake) ──────────────────────────────────────────────────

describe("saveScene", () => {
	it("serializes the scene into the updateDoc call", async () => {
		const calls: Calls<Parameters<RyuSpaces["updateDoc"]>[0]> = [];
		setWindow({
			spaces: {
				updateDoc: (...args: Parameters<RyuSpaces["updateDoc"]>) => {
					calls.push({ method: "updateDoc", args });
					return Promise.resolve();
				},
			},
		});
		await saveScene("d1", { name: "S", nodes: [], edges: [] });
		const args = calls[0]?.args[0];
		expect(args?.doc_id).toBe("d1");
		expect(args?.title).toBe("S");
		expect(JSON.parse(args?.source ?? "")).toMatchObject({ name: "S" });
	});
});

// ── generateText routing (bridge fake) ───────────────────────────────────────

describe("generateText", () => {
	function trackedBridge(): Calls {
		const calls: Calls = [];
		setWindow({
			model: {
				complete: (...args: Parameters<RyuModel["complete"]>) => {
					calls.push({ method: "model.complete", args });
					return Promise.resolve("model-out");
				},
			},
			agent: {
				run: (...args: Parameters<RyuAgent["run"]>) => {
					calls.push({ method: "agent.run", args });
					return Promise.resolve("agent-out");
				},
			},
		});
		return calls;
	}

	it("prefers a one-shot model completion when a model is given", async () => {
		const calls = trackedBridge();
		const out = await generateText({ prompt: "hi", model: "opus" });
		expect(out).toBe("model-out");
		expect(calls[0]).toMatchObject({
			method: "model.complete",
			args: [{ prompt: "hi", model: "opus" }],
		});
	});

	it("keeps the selected provider lane with the model", async () => {
		const calls = trackedBridge();
		await generateText({ prompt: "hi", model: "opus", provider: "anthropic" });
		expect(calls[0]).toMatchObject({
			method: "model.complete",
			args: [{ model: "opus", prompt: "hi", provider: "anthropic" }],
		});
	});

	it("runs the chosen agent when an agentId (but no model) is given", async () => {
		const calls = trackedBridge();
		const out = await generateText({ prompt: "hi", agentId: "a1" });
		expect(out).toBe("agent-out");
		expect(calls[0]).toMatchObject({
			method: "agent.run",
			args: [{ task: "hi", agent_id: "a1" }],
		});
	});

	it("falls back to the default side-model when neither is given", async () => {
		const calls = trackedBridge();
		await generateText({ prompt: "hi" });
		expect(calls[0]).toMatchObject({
			method: "model.complete",
			args: [{ prompt: "hi" }],
		});
	});
});

// ── loadRegistry catch-fallbacks (bridge fake) ───────────────────────────────

describe("loadRegistry", () => {
	it("fills empty defaults when each catalog read rejects", async () => {
		setWindow({
			registry: {
				agents: () => Promise.reject(new Error("nope")),
				engineModels: () => Promise.reject(new Error("nope")),
				ttsEngines: () => Promise.reject(new Error("nope")),
			},
		});
		expect(await loadRegistry()).toEqual({
			agents: [],
			engineModels: {},
			runtimeCatalog: null,
			ttsEngines: [],
		});
	});

	it("passes through successful catalog reads", async () => {
		setWindow({
			registry: {
				agents: () => Promise.resolve([{ id: "a1", name: "A" }]),
				engineModels: () => Promise.resolve({ claude: [] }),
				ttsEngines: () => Promise.resolve([{ id: "kokoro" }]),
			},
		});
		const reg = await loadRegistry();
		expect(reg.agents).toHaveLength(1);
		expect(reg.engineModels).toEqual({ claude: [] });
		expect(reg.runtimeCatalog).toBeNull();
	});
});

// ── searchIcons / searchLogos / fetchIconSvg (fetch stub) ────────────────────

describe("searchIcons", () => {
	it("maps search-result ids from the icons array on a query", async () => {
		stubFetch(() => ({
			ok: true,
			json: () => Promise.resolve({ icons: ["mdi:home", "mdi:cog"] }),
		}));
		const hits = await searchIcons("home");
		expect(hits.map((h) => h.id)).toEqual(["mdi:home", "mdi:cog"]);
		expect(hits[0]?.previewUrl).toContain("mdi/home.svg");
	});

	it("builds a lucide-prefixed default set from collection categories", async () => {
		stubFetch(() => ({
			ok: true,
			json: () =>
				Promise.resolve({
					uncategorized: ["home"],
					categories: { nav: ["arrow"] },
				}),
		}));
		const hits = await searchIcons("");
		expect(hits.map((h) => h.id)).toEqual(["lucide:home", "lucide:arrow"]);
	});

	it("throws when the icon search response is not ok", async () => {
		stubFetch(() => ({ ok: false, status: 503 }));
		await expect(searchIcons("x")).rejects.toThrow(/icon search failed: 503/);
	});
});

describe("fetchIconSvg", () => {
	it("returns the raw svg text", async () => {
		stubFetch(() => ({
			ok: true,
			text: () => Promise.resolve("<svg>i</svg>"),
		}));
		expect(await fetchIconSvg("mdi:home")).toBe("<svg>i</svg>");
	});

	it("throws when the fetch is not ok", async () => {
		stubFetch(() => ({ ok: false, status: 404 }));
		await expect(fetchIconSvg("mdi:home")).rejects.toThrow(
			/icon fetch failed: 404/
		);
	});
});

describe("searchLogos", () => {
	it("uses a string route as the svg url", async () => {
		stubFetch(() => ({
			ok: true,
			json: () =>
				Promise.resolve([{ title: "React", route: "https://x/react.svg" }]),
		}));
		const hits = await searchLogos("react");
		expect(hits).toEqual([{ title: "React", svgUrl: "https://x/react.svg" }]);
	});

	it("uses the light variant of an object route", async () => {
		stubFetch(() => ({
			ok: true,
			json: () =>
				Promise.resolve([
					{ title: "Vue", route: { light: "l.svg", dark: "d.svg" } },
				]),
		}));
		expect((await searchLogos("vue"))[0]?.svgUrl).toBe("l.svg");
	});

	it("returns an empty list when the payload is not an array", async () => {
		stubFetch(() => ({
			ok: true,
			json: () => Promise.resolve({ oops: true }),
		}));
		expect(await searchLogos("x")).toEqual([]);
	});

	it("throws when the logo search response is not ok", async () => {
		stubFetch(() => ({ ok: false, status: 500 }));
		await expect(searchLogos("x")).rejects.toThrow(/logo search failed: 500/);
	});
});
