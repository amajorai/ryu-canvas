// Shared types + model presets for the Canvas app (node-based image/video/text
// playground). The board owns this schema; the whole graph is JSON-serialized into
// one Space document `source`. Self-contained: no desktop/@ryu deps (this ships in
// a sandboxed frame) — the agent/model/tts catalogs come from the window.ryu
// bridge at runtime.

import { createContext, useContext } from "react";
import type { RyuTtsEngine } from "./ryu";

/**
 * The kinds of node the canvas supports:
 * - `image` / `video` — media generation (local sd / cloud providers).
 * - `text` — the agent-driven CHAT node: picks an agent (+ optional model) and runs
 *   a turn, producing text that feeds downstream nodes.
 * - `tts` — text-to-speech (upstream/own text → audio).
 * - `stt` — speech-to-text (uploaded/upstream audio → transcript text).
 * - `upload` — a user-provided image/audio/video asset.
 * - `note` — a sticky note: free-text annotation, never runs, not wired.
 */
export type CanvasNodeKind =
	| "image"
	| "video"
	| "text"
	| "tts"
	| "stt"
	| "upload"
	| "note";

export type RunStatus = "idle" | "running" | "done" | "error";

/** Per-node data carried in the React Flow node's `data` bag. */
export interface CanvasNodeData extends Record<string, unknown> {
	/** Chat node: the agent driving this turn (id from the bridge registry). */
	agentId?: string;
	/** Chat node: the active agent's display name (for the picker trigger). */
	agentLabel?: string;
	/** TTS node: the selected engine id (from registry.ttsEngines). */
	engine?: string;
	error?: string;
	kind: CanvasNodeKind;
	/** MIME family of `result`: "image" | "video" | "audio". */
	mediaType?: "image" | "video" | "audio";
	/** Model id — image/video cloud model, or the chat node's LLM model. */
	model?: string;
	/** Model preset/label the footer select shows. */
	modelLabel?: string;
	/** Sticky-note tint (see NOTE_COLORS). */
	noteColor?: string;
	/** User prompt (image/video/tts nodes) or the chat node's message. */
	prompt?: string;
	/** Cloud provider ("replicate" | "fal" | "openrouter") or undefined = local. */
	provider?: string;
	/** Output URL — a `data:` image, video, or audio URL, or an upload. */
	result?: string;
	/** Image size/aspect hint, e.g. "1024x1024". */
	size?: string;
	status?: RunStatus;
	/** For text/chat/stt nodes: the produced/transcribed text. Also an upstream ref. */
	text?: string;
	/** TTS node: the selected voice id (engine-specific). */
	voice?: string;
}

/** A model preset offered in a node's footer select. Provider undefined = local. */
export interface ModelPreset {
	label: string;
	model?: string;
	provider?: string;
}

export const IMAGE_MODELS: ModelPreset[] = [
	{ label: "Local (sd)" },
	{
		label: "FLUX schnell",
		provider: "replicate",
		model: "black-forest-labs/flux-schnell",
	},
	{ label: "FLUX dev (Fal)", provider: "fal", model: "fal-ai/flux/dev" },
];

export const VIDEO_MODELS: ModelPreset[] = [
	{ label: "Local (sd)" },
	{
		label: "Kling v1.6",
		provider: "replicate",
		model: "kwaivgi/kling-v1.6-standard",
	},
	{ label: "Wan T2V (Fal)", provider: "fal", model: "fal-ai/wan-t2v" },
];

export const IMAGE_SIZES = [
	{ label: "1:1", value: "1024x1024" },
	{ label: "16:9", value: "1024x576" },
	{ label: "9:16", value: "576x1024" },
	{ label: "4:3", value: "1024x768" },
] as const;

/** Sticky-note tints. `value` keys the card background/border classes in nodes.tsx. */
export const NOTE_COLORS = [
	{ label: "Yellow", value: "yellow" },
	{ label: "Green", value: "green" },
	{ label: "Blue", value: "blue" },
	{ label: "Pink", value: "pink" },
] as const;

/** A chat-model option (mirrors the desktop `ModelOption`). */
export interface ModelOption {
	id: string;
	name: string;
}

/** The agent projection the composer needs (bridge `registry.agents()`). */
export interface CanvasAgent {
	engine: string | null;
	id: string;
	model: string | null;
	name: string;
	recommended: boolean;
}

/**
 * Board-level registry the chat / TTS nodes read to build their pickers — fetched
 * ONCE at the board (never per node) and shared via context. Keeps the "nothing
 * hardcoded" rule: agents, models, and TTS engines all come from the live bridge
 * catalogs. `engineModels` is the per-engine catalog (keyed by engine id) so the
 * chat node can show each agent's OWN models via `modelsForAgent`.
 */
export interface CanvasRegistry {
	agents: CanvasAgent[];
	/** Per-engine chat-model catalog, keyed by engine id. */
	engineModels: Record<string, ModelOption[]>;
	/** Text-to-speech engines available on this node. */
	ttsEngines: RyuTtsEngine[];
}

export const CanvasRegistryContext = createContext<CanvasRegistry>({
	agents: [],
	engineModels: {},
	ttsEngines: [],
});

export function useCanvasRegistry(): CanvasRegistry {
	return useContext(CanvasRegistryContext);
}

/** Runtime the board injects so node components can run + edit themselves. */
export interface CanvasRuntime {
	deleteNode: (id: string) => void;
	runNode: (id: string) => void;
	updateNodeData: (id: string, partial: Partial<CanvasNodeData>) => void;
}

export const CanvasRuntimeContext = createContext<CanvasRuntime | null>(null);

export function useCanvasRuntime(): CanvasRuntime {
	const ctx = useContext(CanvasRuntimeContext);
	if (!ctx) {
		throw new Error("useCanvasRuntime must be used within a canvas board");
	}
	return ctx;
}
