// Custom React Flow node cards for the Canvas app. Self-contained (plain markup +
// canvas.css classes, no desktop design system) so the whole app builds to one
// sandboxed HTML. Each card mirrors the ElevenLabs-Flows layout — header (type dot
// + label + delete), body (media preview / prompt), footer (controls + Run) — and
// drives itself through the CanvasRuntime the board provides.
//
// xyflow gotchas honored: every interactive control carries `nodrag` (else a
// pointer-drag moves the node); scrollable regions carry `nowheel` (else the wheel
// zooms the board). xyflow does NOT auto-exclude form elements.

import { Button, Input, Textarea } from "@ryu/blocks/companion/controls";
import {
	ModelAgentPicker,
	type RyuPickerSelection,
} from "@ryu/blocks/composer/runtime-picker";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { safeMediaUrl } from "@ryu/ui/lib/safe-media-url.ts";
import { Handle, type NodeTypes, Position } from "@xyflow/react";
import { useEffect, useState } from "react";
import { modelsForAgent } from "./models.ts";
import { rasterizeSvg, storedSvg } from "./svg-preview.ts";
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
} from "./types.ts";

const NODE_META = {
	image: { label: "Image" },
	video: { label: "Video" },
	text: { label: "Chat" },
	tts: { label: "Speech" },
	stt: { label: "Transcribe" },
	upload: { label: "Upload" },
	note: { label: "Note" },
} satisfies Record<CanvasNodeKind, { label: string }>;

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
		<div className="cv-card" data-kind={data.kind} data-state={state}>
			{showTargetHandle ? (
				<Handle
					className="cv-handle"
					data-testid="canvas-target-handle"
					position={Position.Left}
					type="target"
				/>
			) : null}
			<div className="cv-head">
				<span className="cv-dot" data-kind={data.kind} />
				<span className="cv-title">{meta.label}</span>
				<Button
					aria-label="Delete node"
					className="cv-del nodrag"
					onClick={() => runtime.deleteNode(id)}
					type="button"
				>
					✕
				</Button>
			</div>
			{children}
			<Handle
				className="cv-handle"
				data-testid="canvas-source-handle"
				position={Position.Right}
				type="source"
			/>
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
		<NativeSelect
			className="min-w-0 flex-1"
			onChange={(e) => {
				const preset = presets.find((p) => p.label === e.target.value);
				if (preset) {
					onChange(preset);
				}
			}}
			value={value ?? presets[0]?.label}
		>
			{presets.map((p) => (
				<NativeSelectOption key={p.label} value={p.label}>
					{p.label}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

function MediaPreview({ data }: { data: CanvasNodeData }) {
	const [raster, setRaster] = useState<{ source: string; url: string } | null>(
		null
	);
	const [conversionError, setConversionError] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		setConversionError(null);
		const svg = storedSvg(data.result);
		if (svg && data.result) {
			const source = data.result;
			void rasterizeSvg(svg)
				.then((url) => {
					if (!cancelled) {
						setRaster({ source, url });
					}
				})
				.catch(() => {
					if (!cancelled) {
						setConversionError("Couldn't display this SVG asset.");
					}
				});
		}
		return () => {
			cancelled = true;
		};
	}, [data.result]);
	const safeResult =
		safeMediaUrl(data.result) ??
		(raster && raster.source === data.result ? raster.url : null);
	if (conversionError) {
		return <div className="cv-preview cv-preview-error">{conversionError}</div>;
	}
	if (data.status === "running") {
		return (
			<div className="cv-preview">
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
	if (safeResult && data.mediaType === "video") {
		return <video className="cv-media nodrag" controls src={safeResult} />;
	}
	if (safeResult && data.mediaType === "audio") {
		return <audio className="cv-audio nodrag" controls src={safeResult} />;
	}
	if (safeResult) {
		return (
			<img
				alt={data.prompt ?? "Generated"}
				className={
					data.kind === "upload" ? "cv-media cv-asset-media" : "cv-media"
				}
				src={safeResult}
			/>
		);
	}
	return null;
}

function RunButton({ id, data }: { id: string; data: CanvasNodeData }) {
	const runtime = useCanvasRuntime();
	return (
		<Button
			className="nodrag"
			disabled={data.status === "running"}
			onClick={() => runtime.runNode(id)}
			type="button"
		>
			{data.status === "running" ? <span className="cv-spinner-sm" /> : "▶"} Run
		</Button>
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
		<Textarea
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
		<div>
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
					<NativeSelect
						className="w-18 shrink-0"
						onChange={(e) =>
							runtime.updateNodeData(id, { size: e.target.value })
						}
						value={data.size ?? IMAGE_SIZES[0].value}
					>
						{IMAGE_SIZES.map((s) => (
							<NativeSelectOption key={s.value} value={s.value}>
								{s.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
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
		<div>
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
	const { agents, discoverModels, engineModels, runtimeCatalog } =
		useCanvasRegistry();
	// Each agent's OWN models (Core catalog → offline fallback → bound model → Auto),
	// exactly like the desktop composer's modelsForAgent.
	const activeAgentId = data.agentId ?? agents[0]?.id ?? null;
	const modelOptions = modelsForAgent(activeAgentId, agents, engineModels);
	const runtimeSelection: RyuPickerSelection | undefined = data.agentId
		? { agentId: data.agentId, kind: "agent" }
		: data.model && data.provider
			? { kind: "model", modelId: data.model, providerId: data.provider }
			: undefined;
	return (
		<div>
			<CardShell data={data} id={id} selected={selected}>
				{data.status === "running" ? (
					<div className="cv-preview cv-preview-sm">
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
					{runtimeCatalog ? (
						<div className="cv-runtime-picker">
							<ModelAgentPicker
								ariaLabel="Choose the Ryu chat runtime"
								catalog={runtimeCatalog}
								onDiscoverModels={discoverModels}
								onSelectionChange={(selection) => {
									if (selection.kind === "agent") {
										runtime.updateNodeData(id, {
											agentId: selection.agentId,
											agentLabel:
												runtimeCatalog.agents.find(
													(agent) => agent.id === selection.agentId
												)?.name ?? selection.agentId,
											model: undefined,
											modelLabel: undefined,
											provider: undefined,
										});
										return;
									}
									runtime.updateNodeData(id, {
										agentId: undefined,
										agentLabel: undefined,
										model: selection.modelId,
										modelLabel: selection.modelId,
										provider: selection.providerId,
									});
								}}
								placeholder="Choose model or agent"
								value={runtimeSelection}
							/>
						</div>
					) : (
						<>
							<NativeSelect
								className="min-w-0 flex-1"
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
								{agents.length === 0 ? (
									<NativeSelectOption value="">Default</NativeSelectOption>
								) : null}
								{agents.map((a) => (
									<NativeSelectOption key={a.id} value={a.id}>
										{a.name}
									</NativeSelectOption>
								))}
							</NativeSelect>
							{modelOptions.length > 0 ? (
								<NativeSelect
									className="min-w-0 flex-1"
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
										<NativeSelectOption key={m.id} value={m.id}>
											{m.name}
										</NativeSelectOption>
									))}
								</NativeSelect>
							) : null}
						</>
					)}
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
		<div>
			<CardShell data={data} id={id} selected={selected}>
				<MediaPreview data={data} />
				<PromptArea
					data={data}
					id={id}
					placeholder="Text to speak (or wire a Chat node in)…"
				/>
				<div className="cv-footer nodrag">
					<NativeSelect
						className="min-w-0 flex-1"
						onChange={(e) =>
							runtime.updateNodeData(id, {
								engine: e.target.value,
								voice: undefined,
							})
						}
						value={activeEngineId ?? ""}
					>
						{ttsEngines.length === 0 ? (
							<NativeSelectOption value="">No engines</NativeSelectOption>
						) : null}
						{ttsEngines.map((e) => (
							<NativeSelectOption key={e.id} value={e.id}>
								{e.display_name}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{voices.length > 0 ? (
						<NativeSelect
							className="w-16 shrink-0"
							onChange={(e) =>
								runtime.updateNodeData(id, { voice: e.target.value })
							}
							value={data.voice ?? activeEngine?.default_voice}
						>
							{voices.map((v) => (
								<NativeSelectOption key={v} value={v}>
									{v}
								</NativeSelectOption>
							))}
						</NativeSelect>
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
		<div>
			<CardShell data={data} id={id} selected={selected}>
				{data.status === "done" && data.text ? (
					<TextResult text={data.text} />
				) : null}
				{data.status === "error" ? (
					<div className="cv-inline-error">
						{data.error ?? "Transcription failed"}
					</div>
				) : null}
				{safeMediaUrl(data.result) ? (
					<audio
						className="cv-audio nodrag"
						controls
						src={safeMediaUrl(data.result) ?? undefined}
					/>
				) : (
					<label className="cv-dropzone nodrag">
						<Input
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
		<div>
			<div
				className="cv-note"
				data-color={color}
				data-selected={selected ? "1" : "0"}
			>
				<div className="cv-note-head nodrag">
					{NOTE_COLORS.map((c) => (
						<Button
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
					<Button
						aria-label="Delete note"
						className="cv-del"
						onClick={() => runtime.deleteNode(id)}
						type="button"
					>
						✕
					</Button>
				</div>
				<Textarea
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
		<div>
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
						<Input
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
