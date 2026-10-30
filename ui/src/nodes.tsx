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
import { useLiteralMessages } from "@ryu/i18n/react";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { safeMediaUrl } from "@ryu/ui/lib/safe-media-url.ts";
import type { NodeTypes } from "@xyflow/react";
import {
	CardShell,
	MediaPreview,
	ModelSelect,
	PromptArea,
	RunButton,
	readFileToNode,
	TextResult,
} from "./nodes-card.tsx";
import { ChatNode } from "./nodes-chat.tsx";
import {
	type CanvasNodeData,
	IMAGE_MODELS,
	IMAGE_SIZES,
	NOTE_COLORS,
	useCanvasRegistry,
	useCanvasRuntime,
	VIDEO_MODELS,
} from "./types.ts";

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
	const tl = useLiteralMessages();
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
							aria-label={tl("{label} note", { label: c.label })}
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
