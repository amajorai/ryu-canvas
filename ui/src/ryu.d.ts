// The `window.ryu` companion host-bridge surface, injected inline by the Path B
// host (`htmlCompanionSrcdoc` in `@ryu/app-host/third-party-plugin`) BEFORE this
// app's module scripts run. Every method is an RPC over a capability-gated
// MessagePort the desktop host grant-gates against this app's Gateway-approved
// grants; nothing here holds a token or reaches the network directly. Calls made
// before the port arrives are queued in an outbox and flush on connect, so a
// `spaces.getDoc` in the first effect never races the handshake.
//
// Media/registry results are ALWAYS `data:` URLs (the host inlines any remote
// provider URL) so the CSP-locked frame (img/media-src data: blob: only) renders
// them.

export interface RyuAppDoc {
	id: string;
	kind: string;
	source: string;
	title: string;
}

export interface RyuAppDocSummary {
	id: string;
	title: string;
	updated_at: number;
}

export interface RyuSpaces {
	createDoc(input: { space_id: string; title: string }): Promise<string>;
	deleteDoc(input: { doc_id: string }): Promise<void>;
	getDoc(input: { doc_id: string }): Promise<RyuAppDoc | null>;
	listDocs(input: { space_id: string }): Promise<RyuAppDocSummary[]>;
	updateDoc(input: {
		doc_id: string;
		title?: string;
		source: string;
	}): Promise<void>;
}

export interface RyuModel {
	complete(input: {
		prompt: string;
		system?: string;
		model?: string;
		effort?: string;
	}): Promise<string>;
}

export interface RyuAgent {
	run(input: {
		task: string;
		agent_id?: string;
		preset?: string;
		wall_time_secs?: number;
		max_tokens?: number;
	}): Promise<string>;
}

export interface RyuMedia {
	/** Generate image(s); returns renderable `data:` URLs. */
	image(input: {
		prompt: string;
		count?: number;
		size?: string;
		provider?: string;
		model?: string;
	}): Promise<string[]>;
	/** Transcribe an audio `data:` URL; returns the text. */
	transcribe(input: { audio: string; filename?: string }): Promise<string>;
	/** Synthesize speech; returns a `data:` audio URL. */
	tts(input: {
		text: string;
		engine?: string;
		voice?: string;
		speed?: number;
		language?: string;
	}): Promise<string>;
	/** Generate video clip(s); `url` is a `data:` URL. */
	video(input: {
		prompt: string;
		provider?: string;
		model?: string;
	}): Promise<{ url: string; mediaType: string }[]>;
}

export interface RyuTtsEngine {
	default_voice: string;
	display_name: string;
	id: string;
	voices: string[];
	[key: string]: unknown;
}

export interface RyuAgentInfo {
	engine: string | null;
	id: string;
	model: string | null;
	name: string;
	recommended: boolean;
}

export interface RyuRegistry {
	/** Richer agent projection (id/name/engine/model/recommended) — for a per-agent
	 *  model picker. Still no secrets. */
	agents(): Promise<RyuAgentInfo[]>;
	/** Per-engine chat-model catalog keyed by engine id. */
	engineModels(): Promise<Record<string, { id: string; name: string }[]>>;
	/** TTS engines + their voices. */
	ttsEngines(): Promise<RyuTtsEngine[]>;
}

/** One GIF result (host-inlined preview + full clip to data: URLs). */
export interface RyuGif {
	height: number;
	id: string;
	preview: string;
	title: string;
	url: string;
	width: number;
}

export interface RyuAssets {
	/** Search GIFs via the host (Core proxy). Icons/logos are fetched DIRECTLY by the
	 *  app under its per-app CSP allowlist, so they are not on this bridge. */
	searchGifs(input: {
		query: string;
	}): Promise<{ configured: boolean; results: RyuGif[] }>;
}

/** Baked in by the host when the app is opened as a Space document. */
export interface RyuMountContext {
	docId: string;
	spaceId: string;
}

export interface RyuBridge {
	agent: RyuAgent;
	assets: RyuAssets;
	context: RyuMountContext | null;
	listAgents(): Promise<{ id: string; name: string }[]>;
	media: RyuMedia;
	model: RyuModel;
	registry: RyuRegistry;
	spaces: RyuSpaces;
}

declare global {
	interface Window {
		ryu?: RyuBridge;
	}
}
