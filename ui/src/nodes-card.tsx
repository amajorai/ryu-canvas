// Shared building blocks for the Canvas node cards in nodes.tsx: the card shell,
// model select, media preview, Run button, prompt area, text result, and file reader.

import { Button, Textarea } from "@ryu/blocks/companion/controls";
import { useRichLiteralMessages } from "@ryu/i18n/react";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { safeMediaUrl } from "@ryu/ui/lib/safe-media-url.ts";
import { Handle, Position } from "@xyflow/react";
import { useEffect, useState } from "react";
import { rasterizeSvg, storedSvg } from "./svg-preview.ts";
import {
	type CanvasNodeData,
	type CanvasNodeKind,
	type ModelPreset,
	useCanvasRuntime,
} from "./types.ts";

export const NODE_META = {
	image: { label: "Image" },
	video: { label: "Video" },
	text: { label: "Chat" },
	tts: { label: "Speech" },
	stt: { label: "Transcribe" },
	upload: { label: "Upload" },
	note: { label: "Note" },
} satisfies Record<CanvasNodeKind, { label: string }>;

export function CardShell({
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
export function ModelSelect({
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

export function MediaPreview({ data }: { data: CanvasNodeData }) {
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

export function RunButton({ id, data }: { id: string; data: CanvasNodeData }) {
	const runtime = useCanvasRuntime();
	const tlRich = useRichLiteralMessages();
	return (
		<Button
			className="nodrag"
			disabled={data.status === "running"}
			onClick={() => runtime.runNode(id)}
			type="button"
		>
			{tlRich(
				"<icon></icon> Run",
				{},
				{
					icon: () =>
						data.status === "running" ? (
							<span className="cv-spinner-sm" />
						) : (
							"▶"
						),
				}
			)}
		</Button>
	);
}

export function PromptArea({
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
export function TextResult({ text }: { text: string }) {
	return <div className="cv-text-result nodrag nowheel">{text}</div>;
}

export function readFileToNode(
	file: File,
	mediaType: "audio" | "image" | "video",
	onDone: (result: string, mediaType: "audio" | "image" | "video") => void
) {
	const reader = new FileReader();
	reader.onload = () => onDone(String(reader.result), mediaType);
	reader.readAsDataURL(file);
}
