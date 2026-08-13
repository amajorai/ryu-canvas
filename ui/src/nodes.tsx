// Custom React Flow node cards for the Canvas app. Self-contained (plain markup +
// canvas.css classes, no desktop design system) so the whole app builds to one
// sandboxed HTML. Each card mirrors the ElevenLabs-Flows layout — header (type dot
// + label + delete), body (media preview / prompt), footer (controls + Run) — and
// drives itself through the CanvasRuntime the board provides.
//
// xyflow gotchas honored: every interactive control carries `nodrag` (else a
// pointer-drag moves the node); scrollable regions carry `nowheel` (else the wheel
// zooms the board). xyflow does NOT auto-exclude form elements.

import { Handle, type NodeTypes, Position } from "@xyflow/react";
import { modelsForAgent } from "./models";
import {
	type CanvasNodeData,
	type CanvasNodeKind,
	IMAGE_MODELS,
	IMAGE_SIZES,
	type ModelPreset,
	NOTE_COLORS,
	useCanvasRegistry,
	useCanvasRuntime,
	VIDEO_MODELS,
} from "./types";

const NODE_META: Record<CanvasNodeKind, { label: string; dot: string }> = {
	image: { label: "Image", dot: "#8b5cf6" },
	video: { label: "Video", dot: "#0ea5e9" },
	text: { label: "Chat", dot: "#f59e0b" },
	tts: { label: "Speech", dot: "#f43f5e" },
	stt: { label: "Transcribe", dot: "#14b8a6" },
	upload: { label: "Upload", dot: "#10b981" },
	note: { label: "Note", dot: "#eab308" },
};

function CardShell({
	id,
	data,
	children,
	selected,
	showTargetHandle = true,
}: {
	id: string;
	data: CanvasNodeData;
	children: React.ReactNode;
	selected: boolean;
	showTargetHandle?: boolean;
}) {
	const runtime = useCanvasRuntime();
	const meta = NODE_META[data.kind];
	const state = data.status === "error" ? "err" : selected ? "sel" : "idle";
	return (
		<div className="cv-card" data-state={state}>
			{showTargetHandle ? (
				<Handle className="cv-handle" position={Position.Left} type="target" />
			) : null}
			<div className="cv-head">
				<span className="cv-dot" style={{ background: meta.dot }} />
				<span className="cv-title">{meta.label}</span>
				<button
					aria-label="Delete node"
					className="cv-del nodrag"
					onClick={() => runtime.deleteNode(id)}
					type="button"
				>
					✕
				</button>
			</div>
			{children}
			<Handle className="cv-handle" position={Position.Right} type="source" />
		</div>
	);
}

/** Model-preset select shared by image + video nodes. */
function ModelSelect({
	presets,
	value,
	onChange,
}: {
	presets: ModelPreset[];
	value: string | undefined;
	onChange: (preset: ModelPreset) => void;
}) {
	return (
		<select
			className="cv-select nodrag"
			onChange={(e) => {
				const preset = presets.find((p) => p.label === e.target.value);
				if (preset) {
					onChange(preset);
				}
			}}
			value={value ?? presets[0]?.label}
		>
			{presets.map((p) => (
				<option key={p.label} value={p.label}>
					{p.label}
				</option>
			))}
		</select>
	);
}

function MediaPreview({ data }: { data: CanvasNodeData }) {
	if (data.status === "running") {
		return (
			<div className="cv-preview cv-preview-loading">
				<span className="cv-spinner" />
			</div>
		);
	}
	if (data.status === "error") {
		return (
			<div className="cv-preview cv-preview-error">
				{data.error ?? "Generation failed"}
			</div>
		);
	}
	if (data.result && data.mediaType === "video") {
		// biome-ignore lint/a11y/useMediaCaption: user-generated preview clip
		return <video className="cv-media nodrag" controls src={data.result} />;
	}
	if (data.result && data.mediaType === "audio") {
		// biome-ignore lint/a11y/useMediaCaption: user-generated speech clip
		return <audio className="cv-audio nodrag" controls src={data.result} />;
	}
	if (data.result) {
		return (
			<img
				alt={data.prompt ?? "Generated"}
				className="cv-media"
				src={data.result}
			/>
		);
	}
	return null;
}

function RunButton({ id, data }: { id: string; data: CanvasNodeData }) {
	const runtime = useCanvasRuntime();
	return (
		<button
			className="cv-run nodrag"
			disabled={data.status === "running"}
			onClick={() => runtime.runNode(id)}
			type="button"
		>
			{data.status === "running" ? <span className="cv-spinner-sm" /> : "▶"} Run
		</button>
	);
}

function PromptArea({
	id,
	data,
	placeholder,
}: {
	id: string;
	data: CanvasNodeData;
	placeholder: string;
}) {
	const runtime = useCanvasRuntime();
	return (
		<textarea
			className="cv-textarea nodrag nowheel"
			onChange={(e) => runtime.updateNodeData(id, { prompt: e.target.value })}
			placeholder={placeholder}
			value={data.prompt ?? ""}
		/>
	);
}

/** Read-only block showing a node's generated/transcribed text output. */
function TextResult({ text }: { text: string }) {
	return <div className="cv-text-result nodrag nowheel">{text}</div>;
}

// --- Node components ------------------------------------------------------

function ImageNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	return (
		<div className="cv-group">
			<CardShell data={data} id={id} selected={selected}>
				<MediaPreview data={data} />
				<PromptArea
					data={data}
					id={id}
					placeholder="Describe the image to generate…"
				/>
				<div className="cv-footer nodrag">
					<ModelSelect
						onChange={(preset) =>
							runtime.updateNodeData(id, {
								modelLabel: preset.label,
								provider: preset.provider,
								model: preset.model,
							})
						}
						presets={IMAGE_MODELS}
						value={data.modelLabel}
					/>
					<select
						className="cv-select cv-select-sm nodrag"
						onChange={(e) =>
							runtime.updateNodeData(id, { size: e.target.value })
						}
						value={data.size ?? IMAGE_SIZES[0].value}
					>
						{IMAGE_SIZES.map((s) => (
							<option key={s.value} value={s.value}>
								{s.label}
							</option>
						))}
					</select>
					<RunButton data={data} id={id} />
				</div>
			</CardShell>
		</div>
	);
}

function VideoNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	return (
		<div className="cv-group">
			<CardShell data={data} id={id} selected={selected}>
				<MediaPreview data={data} />
				<PromptArea
					data={data}
					id={id}
					placeholder="Describe the video to generate…"
				/>
				<div className="cv-footer nodrag">
					<ModelSelect
						onChange={(preset) =>
							runtime.updateNodeData(id, {
								modelLabel: preset.label,
								provider: preset.provider,
								model: preset.model,
							})
						}
						presets={VIDEO_MODELS}
						value={data.modelLabel}
					/>
					<RunButton data={data} id={id} />
				</div>
			</CardShell>
		</div>
	);
}

function ChatNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	const { agents, engineModels } = useCanvasRegistry();
	// Each agent's OWN models (Core catalog → offline fallback → bound model → Auto),
	// exactly like the desktop composer's modelsForAgent.
	const activeAgentId = data.agentId ?? agents[0]?.id ?? null;
	const modelOptions = modelsForAgent(activeAgentId, agents, engineModels);
	return (
		<div className="cv-group">
			<CardShell data={data} id={id} selected={selected}>
				{data.status === "running" ? (
					<div className="cv-preview cv-preview-loading cv-preview-sm">
						<span className="cv-spinner" />
					</div>
				) : null}
				{data.status === "error" ? (
					<div className="cv-inline-error">
						{data.error ?? "Generation failed"}
					</div>
				) : null}
				{data.status === "done" && data.text ? (
					<TextResult text={data.text} />
				) : null}
				<PromptArea data={data} id={id} placeholder="Message the agent…" />
				<div className="cv-footer nodrag">
					<select
						className="cv-select nodrag"
						onChange={(e) => {
							const a = agents.find((x) => x.id === e.target.value);
							runtime.updateNodeData(id, {
								agentId: e.target.value,
								agentLabel: a?.name ?? e.target.value,
								model: undefined,
								modelLabel: undefined,
							});
						}}
						value={activeAgentId ?? ""}
					>
						{agents.length === 0 ? <option value="">Default</option> : null}
						{agents.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
					{modelOptions.length > 0 ? (
						<select
							className="cv-select nodrag"
							onChange={(e) => {
								const m = modelOptions.find((x) => x.id === e.target.value);
								runtime.updateNodeData(id, {
									model: e.target.value || undefined,
									modelLabel: m?.name,
								});
							}}
							value={data.model ?? modelOptions[0]?.id ?? ""}
						>
							{modelOptions.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
								</option>
							))}
						</select>
					) : null}
					<RunButton data={data} id={id} />
				</div>
			</CardShell>
		</div>
	);
}

function TtsNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	const { ttsEngines } = useCanvasRegistry();
	const activeEngineId = data.engine ?? ttsEngines[0]?.id;
	const activeEngine = ttsEngines.find((e) => e.id === activeEngineId);
	const voices = activeEngine?.voices ?? [];
	return (
		<div className="cv-group">
			<CardShell data={data} id={id} selected={selected}>
				<MediaPreview data={data} />
				<PromptArea
					data={data}
					id={id}
					placeholder="Text to speak (or wire a Chat node in)…"
				/>
				<div className="cv-footer nodrag">
					<select
						className="cv-select nodrag"
						onChange={(e) =>
							runtime.updateNodeData(id, {
								engine: e.target.value,
								voice: undefined,
							})
						}
						value={activeEngineId ?? ""}
					>
						{ttsEngines.length === 0 ? (
							<option value="">No engines</option>
						) : null}
						{ttsEngines.map((e) => (
							<option key={e.id} value={e.id}>
								{e.display_name}
							</option>
						))}
					</select>
					{voices.length > 0 ? (
						<select
							className="cv-select cv-select-sm nodrag"
							onChange={(e) =>
								runtime.updateNodeData(id, { voice: e.target.value })
							}
							value={data.voice ?? activeEngine?.default_voice}
						>
							{voices.map((v) => (
								<option key={v} value={v}>
									{v}
								</option>
							))}
						</select>
					) : null}
					<RunButton data={data} id={id} />
				</div>
			</CardShell>
		</div>
	);
}

function readFileToNode(
	file: File,
	mediaType: "audio" | "image" | "video",
	onDone: (result: string, mediaType: "audio" | "image" | "video") => void
) {
	const reader = new FileReader();
	reader.onload = () => onDone(String(reader.result), mediaType);
	reader.readAsDataURL(file);
}

function SttNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	return (
		<div className="cv-group">
			<CardShell data={data} id={id} selected={selected}>
				{data.status === "done" && data.text ? (
					<TextResult text={data.text} />
				) : null}
				{data.status === "error" ? (
					<div className="cv-inline-error">
						{data.error ?? "Transcription failed"}
					</div>
				) : null}
				{data.result ? (
					// biome-ignore lint/a11y/useMediaCaption: user-provided audio source
					<audio className="cv-audio nodrag" controls src={data.result} />
				) : (
					<label className="cv-dropzone nodrag">
						<input
							accept="audio/*"
							className="cv-hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) {
									readFileToNode(file, "audio", (result, mediaType) =>
										runtime.updateNodeData(id, { result, mediaType })
									);
								}
							}}
							type="file"
						/>
						Upload audio, or wire in a Speech node
					</label>
				)}
				<div className="cv-footer cv-footer-end nodrag">
					<RunButton data={data} id={id} />
				</div>
			</CardShell>
		</div>
	);
}

function NoteNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	const color = data.noteColor ?? "yellow";
	return (
		<div className="cv-group">
			<div
				className="cv-note"
				data-color={color}
				data-selected={selected ? "1" : "0"}
			>
				<div className="cv-note-head nodrag">
					{NOTE_COLORS.map((c) => (
						<button
							aria-label={`${c.label} note`}
							className="cv-note-swatch"
							data-active={color === c.value ? "1" : "0"}
							data-color={c.value}
							key={c.value}
							onClick={() => runtime.updateNodeData(id, { noteColor: c.value })}
							type="button"
						/>
					))}
					<span className="cv-spacer" />
					<button
						aria-label="Delete note"
						className="cv-del"
						onClick={() => runtime.deleteNode(id)}
						type="button"
					>
						✕
					</button>
				</div>
				<textarea
					className="cv-note-text nodrag nowheel"
					onChange={(e) => runtime.updateNodeData(id, { text: e.target.value })}
					placeholder="Write a note…"
					value={data.text ?? ""}
				/>
			</div>
		</div>
	);
}

function UploadNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	return (
		<div className="cv-group">
			<CardShell
				data={data}
				id={id}
				selected={selected}
				showTargetHandle={false}
			>
				{data.result ? (
					<MediaPreview data={data} />
				) : (
					<label className="cv-dropzone cv-dropzone-lg nodrag">
						<input
							accept="image/*,audio/*,video/*"
							className="cv-hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (!file) {
									return;
								}
								const mediaType = file.type.startsWith("video/")
									? "video"
									: file.type.startsWith("audio/")
										? "audio"
										: "image";
								readFileToNode(file, mediaType, (result, mt) =>
									runtime.updateNodeData(id, { result, mediaType: mt })
								);
							}}
							type="file"
						/>
						Click to upload image, audio, or video
					</label>
				)}
			</CardShell>
		</div>
	);
}

export const CANVAS_NODE_TYPES: NodeTypes = {
	image: ImageNode,
	video: VideoNode,
	text: ChatNode,
	tts: TtsNode,
	stt: SttNode,
	upload: UploadNode,
	note: NoteNode,
};
