// Pure helpers for the Canvas board: node ids, placement, seed data, upstream
// prompt joining, and clipboard/drop media collection. Split from `Canvas.tsx`.

import type { Node } from "@xyflow/react";
import {
	type CanvasNodeData,
	type CanvasNodeKind,
	IMAGE_MODELS,
	IMAGE_SIZES,
	VIDEO_MODELS,
} from "./types.ts";

export type CanvasNode = Node<CanvasNodeData>;

let nextCanvasNodeSequence = 0;

export function createCanvasNodeId(): string {
	return `n-${Date.now()}-${nextCanvasNodeSequence++}`;
}

interface PositionForNodeResult {
	x: number;
	y: number;
}

export function positionForNode(
	center: { x: number; y: number },
	index: number
): PositionForNodeResult {
	return {
		x: center.x - 144 + (index % 2) * 360,
		y: center.y - 80 + Math.floor(index / 2) * 260,
	};
}

/** Seed data for a freshly added node of each kind. */
export function seedData(kind: CanvasNodeKind): CanvasNodeData {
	if (kind === "image") {
		const preset = IMAGE_MODELS[0];
		return {
			kind,
			status: "idle",
			modelLabel: preset?.label,
			provider: preset?.provider,
			model: preset?.model,
			size: IMAGE_SIZES[0]?.value,
		};
	}
	if (kind === "video") {
		const preset = VIDEO_MODELS[0];
		return {
			kind,
			status: "idle",
			modelLabel: preset?.label,
			provider: preset?.provider,
			model: preset?.model,
		};
	}
	if (kind === "note") {
		return { kind, status: "idle", noteColor: "yellow", text: "" };
	}
	return { kind, status: "idle" };
}

/** Collect upstream text/prompt refs wired into a node, as one joined prompt. */
export function upstreamText(own: string, incomers: CanvasNode[]): string {
	const refs = incomers
		.map((u) => u.data.text ?? u.data.prompt)
		.filter((s): s is string => Boolean(s?.trim()));
	return [...refs, own].filter((s) => s.trim()).join("\n");
}

export function fileToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Failed to read file"));
		reader.readAsDataURL(blob);
	});
}

export function mediaTypeFromMime(mime: string): "image" | "video" | "audio" {
	if (mime.startsWith("video/")) {
		return "video";
	}
	if (mime.startsWith("audio/")) {
		return "audio";
	}
	return "image";
}

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	);
}

export function collectMediaFiles(data: DataTransfer): File[] {
	const fromList = Array.from(data.files).filter(
		(f) =>
			f.type.startsWith("image/") ||
			f.type.startsWith("audio/") ||
			f.type.startsWith("video/")
	);
	if (fromList.length > 0) {
		return fromList;
	}
	const fromItems: File[] = [];
	for (const item of Array.from(data.items)) {
		if (
			item.kind === "file" &&
			(item.type.startsWith("image/") ||
				item.type.startsWith("audio/") ||
				item.type.startsWith("video/"))
		) {
			const file = item.getAsFile();
			if (file) {
				fromItems.push(file);
			}
		}
	}
	return fromItems;
}
