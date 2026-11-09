// Pasting and dropping media or text onto the Canvas board: files become done
// "upload" nodes, plain text a note. Split from `Canvas.tsx`.

import { useReactFlow } from "@xyflow/react";
import { type DragEvent, useCallback, useEffect, useState } from "react";
import {
	type CanvasNode,
	collectMediaFiles,
	fileToDataUrl,
	isEditableTarget,
	mediaTypeFromMime,
} from "./canvas-board-model.ts";

interface CanvasImportOptions {
	/** Append imported nodes to the board (and schedule a save). */
	addNodes: (nodes: CanvasNode[]) => void;
	/** The flow position at the middle of the visible board. */
	viewportCenter: () => { x: number; y: number };
}

/** Paste and drag-and-drop import for the board, plus its drop-overlay state. */
export function useCanvasImport({
	addNodes,
	viewportCenter,
}: CanvasImportOptions) {
	const rf = useReactFlow();
	const [isDragOver, setIsDragOver] = useState(false);

	const importAtPosition = useCallback(
		async (
			position: { x: number; y: number },
			payload: { files?: File[]; text?: string }
		) => {
			const newNodes: CanvasNode[] = [];
			const baseId = Date.now();
			if (payload.files?.length) {
				for (let i = 0; i < payload.files.length; i++) {
					const file = payload.files[i];
					if (!file) {
						continue;
					}
					const result = await fileToDataUrl(file);
					newNodes.push({
						id: `n-${baseId}-${i}`,
						type: "upload",
						position: {
							x: position.x - 144 + i * 32,
							y: position.y - 80 + i * 32,
						},
						data: {
							kind: "upload",
							status: "done",
							result,
							mediaType: mediaTypeFromMime(file.type),
						},
					});
				}
			} else if (payload.text?.trim()) {
				newNodes.push({
					id: `n-${baseId}`,
					type: "note",
					position: { x: position.x - 120, y: position.y - 60 },
					data: {
						kind: "note",
						status: "idle",
						noteColor: "yellow",
						text: payload.text.trim(),
					},
				});
			}
			if (newNodes.length === 0) {
				return;
			}
			addNodes(newNodes);
		},
		[addNodes]
	);

	const flowPositionFromClient = useCallback(
		(clientX: number, clientY: number) =>
			rf.screenToFlowPosition({ x: clientX, y: clientY }),
		[rf]
	);

	const handlePaste = useCallback(
		(e: ClipboardEvent) => {
			if (isEditableTarget(e.target) || !e.clipboardData) {
				return;
			}
			const files = collectMediaFiles(e.clipboardData);
			const text = e.clipboardData.getData("text/plain");
			if (files.length === 0 && !text.trim()) {
				return;
			}
			e.preventDefault();
			void importAtPosition(viewportCenter(), {
				files: files.length > 0 ? files : undefined,
				text: files.length === 0 ? text : undefined,
			});
		},
		[importAtPosition, viewportCenter]
	);

	const handleDragOver = useCallback((e: DragEvent) => {
		if (!e.dataTransfer.types.includes("Files")) {
			return;
		}
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
		setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		if (
			!(
				e.relatedTarget instanceof globalThis.Node &&
				e.currentTarget.contains(e.relatedTarget)
			)
		) {
			setIsDragOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			setIsDragOver(false);
			const files = collectMediaFiles(e.dataTransfer);
			if (files.length === 0) {
				return;
			}
			void importAtPosition(flowPositionFromClient(e.clientX, e.clientY), {
				files,
			});
		},
		[flowPositionFromClient, importAtPosition]
	);

	useEffect(() => {
		document.addEventListener("paste", handlePaste);
		return () => document.removeEventListener("paste", handlePaste);
	}, [handlePaste]);

	return { handleDragLeave, handleDragOver, handleDrop, isDragOver };
}
