// Thin typed wrappers over the injected `window.ryu` bridge. The Path B host
// installs `window.ryu` synchronously (with an outbox) BEFORE this module runs, so
// these can be called from the first effect. Every method is capability-gated
// host-side; a denied/absent method rejects, which the callers surface as a node
// error rather than crashing the board.

import type { CanvasRegistry } from "./types";

function bridge() {
	const b = window.ryu;
	if (!b) {
		throw new Error("Ryu bridge unavailable");
	}
	return b;
}

// ── Persistence (one Space document holds the whole graph) ───────────────────

/** The serialized canvas graph stored as the doc `source`. */
export interface CanvasScene {
	edges: unknown[];
	name: string;
	nodes: unknown[];
	viewport?: { x: number; y: number; zoom: number };
}

/** Load the canvas scene from its mount document. Returns null when empty/new. */
export async function loadScene(docId: string): Promise<CanvasScene | null> {
	const doc = await bridge().spaces.getDoc({ doc_id: docId });
	if (!(doc && doc.source.trim())) {
		return null;
	}
	try {
		const parsed = JSON.parse(doc.source) as Partial<CanvasScene>;
		return {
			name: typeof parsed.name === "string" ? parsed.name : doc.title,
			nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
			edges: Array.isArray(parsed.edges) ? parsed.edges : [],
			viewport: parsed.viewport,
		};
	} catch {
		return { name: doc.title, nodes: [], edges: [] };
	}
}

/** Persist the canvas scene into its mount document. */
export async function saveScene(
	docId: string,
	scene: CanvasScene
): Promise<void> {
	await bridge().spaces.updateDoc({
		doc_id: docId,
		title: scene.name,
		source: JSON.stringify(scene),
	});
}

// ── Registry (fetched once at the board) ─────────────────────────────────────

/** Build the board registry from the live bridge catalogs. Each read is
 *  best-effort — a missing catalog just yields an empty list. Uses the RICHER
 *  `registry.agents()` (engine/model per agent) so the chat node shows each agent's
 *  own models via `modelsForAgent`. */
export async function loadRegistry(): Promise<CanvasRegistry> {
	const b = bridge();
	const [agents, engineModels, ttsEngines] = await Promise.all([
		b.registry.agents().catch(() => []),
		b.registry
			.engineModels()
			.catch(() => ({}) as CanvasRegistry["engineModels"]),
		b.registry.ttsEngines().catch(() => []),
	]);
	return { agents, engineModels, ttsEngines };
}

// ── Node run helpers ─────────────────────────────────────────────────────────

export function generateImage(input: {
	prompt: string;
	size?: string;
	provider?: string;
	model?: string;
}): Promise<string[]> {
	return bridge().media.image(input);
}

export function generateVideo(input: {
	prompt: string;
	provider?: string;
	model?: string;
}): Promise<{ url: string; mediaType: string }[]> {
	return bridge().media.video(input);
}

export function speak(input: {
	text: string;
	engine?: string;
	voice?: string;
}): Promise<string> {
	return bridge().media.tts(input);
}

export function transcribe(audio: string): Promise<string> {
	return bridge().media.transcribe({ audio });
}

/** Run one text turn. Prefers an explicit model (one-shot completion, model has
 *  effect); else runs the chosen agent; else the default side-model. */
export async function generateText(input: {
	prompt: string;
	agentId?: string;
	model?: string;
}): Promise<string> {
	const b = bridge();
	if (input.model) {
		return await b.model.complete({ prompt: input.prompt, model: input.model });
	}
	if (input.agentId) {
		return await b.agent.run({ task: input.prompt, agent_id: input.agentId });
	}
	return await b.model.complete({ prompt: input.prompt });
}

// ── Asset picker ─────────────────────────────────────────────────────────────
// Icons (Iconify) + logos (SVGL) are fetched DIRECTLY from the frame — the app's
// per-app CSP allowlist (csp.connectDomains/resourceDomains in plugin.json) permits
// those two hosts, the ChatGPT-Apps-SDK model. GIFs go through the host bridge (the
// Core `/api/gifs/search` proxy holds the provider key + needs the node token).

const ICONIFY_BASE = "https://api.iconify.design";
const SVGL_BASE = "https://api.svgl.app";

export interface IconHit {
	id: string;
	previewUrl: string;
}

export interface LogoHit {
	svgUrl: string;
	title: string;
}

export type AssetSelection =
	| { kind: "svg"; svg: string; name: string }
	| {
			kind: "gif";
			url: string;
			name: string;
			width?: number;
			height?: number;
	  };

/** Encode SVG markup as a base64 data URL. */
export function svgDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/** Build the Iconify SVG URL for an id, optionally forcing color/size. */
export function iconSvgUrl(
	id: string,
	opts: { color?: string; size?: number } = {}
): string {
	const path = id.replace(":", "/");
	const params = new URLSearchParams();
	if (opts.color) {
		params.set("color", opts.color);
	}
	if (opts.size) {
		params.set("width", String(opts.size));
		params.set("height", String(opts.size));
	}
	const qs = params.toString();
	return `${ICONIFY_BASE}/${path}.svg${qs ? `?${qs}` : ""}`;
}

/** Search Iconify for icons matching `query` (empty ⇒ a curated Lucide starter). */
export async function searchIcons(
	query: string,
	limit = 48
): Promise<IconHit[]> {
	const q = query.trim();
	const url = q
		? `${ICONIFY_BASE}/search?query=${encodeURIComponent(q)}&limit=${limit}`
		: `${ICONIFY_BASE}/collection?prefix=lucide`;
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`icon search failed: ${resp.status}`);
	}
	const data = (await resp.json()) as {
		icons?: string[];
		uncategorized?: string[];
		categories?: Record<string, string[]>;
	};
	let ids: string[];
	if (q) {
		ids = data.icons ?? [];
	} else {
		const names = [
			...(data.uncategorized ?? []),
			...Object.values(data.categories ?? {}).flat(),
		].slice(0, limit);
		ids = names.map((n) => `lucide:${n}`);
	}
	return ids.map((id) => ({
		id,
		previewUrl: iconSvgUrl(id, { color: "#888888" }),
	}));
}

/** Fetch raw SVG markup for an icon, colored so it renders when embedded. */
export async function fetchIconSvg(
	id: string,
	color = "#111827"
): Promise<string> {
	const resp = await fetch(iconSvgUrl(id, { color }));
	if (!resp.ok) {
		throw new Error(`icon fetch failed: ${resp.status}`);
	}
	return await resp.text();
}

/** Search SVGL for brand logos (empty ⇒ default catalog). */
export async function searchLogos(query: string): Promise<LogoHit[]> {
	const q = query.trim();
	const url = q ? `${SVGL_BASE}?search=${encodeURIComponent(q)}` : SVGL_BASE;
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`logo search failed: ${resp.status}`);
	}
	const data = (await resp.json().catch(() => [])) as Array<{
		title: string;
		route: string | { light: string; dark: string };
	}>;
	if (!Array.isArray(data)) {
		return [];
	}
	return data.map((item) => ({
		title: item.title,
		svgUrl: typeof item.route === "string" ? item.route : item.route.light,
	}));
}

/** Fetch raw SVG markup from a URL (brand logos, kept full-color). */
export async function fetchSvgText(url: string): Promise<string> {
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`svg fetch failed: ${resp.status}`);
	}
	return await resp.text();
}

/** Search GIFs via the host (Core proxy). Results are host-inlined data URLs. */
export function searchGifs(query: string) {
	return bridge().assets.searchGifs({ query });
}
