// Running one Canvas node: generation, speech and transcription through the
// governed media/agent bridge, with upstream prompts joined in. Split from
// `Canvas.tsx`.

import { type Edge, getIncomers } from "@xyflow/react";
import {
	generateImage,
	generateText,
	generateVideo,
	speak,
	transcribe,
} from "./bridge.ts";
import { type CanvasNode, upstreamText } from "./canvas-board-model.ts";
import type { CanvasNodeData } from "./types.ts";

/** Run `node` against the current graph, reporting progress through `update`. */
export async function runCanvasNode(
	node: CanvasNode,
	nodes: CanvasNode[],
	edges: Edge[],
	update: (partial: Partial<CanvasNodeData>) => void
): Promise<void> {
	const { kind } = node.data;
	if (kind === "note" || kind === "upload") {
		return;
	}
	update({ status: "running", error: undefined });
	try {
		const incomers = getIncomers(node, nodes, edges);
		const own = node.data.prompt ?? "";
		const prompt = upstreamText(own, incomers);

		if (kind === "image") {
			if (!prompt.trim()) {
				throw new Error("Prompt is empty");
			}
			const urls = await generateImage({
				prompt,
				provider: node.data.provider,
				model: node.data.model,
				size: node.data.size,
			});
			if (urls.length === 0) {
				throw new Error("No image returned");
			}
			update({
				status: "done",
				result: urls[0],
				mediaType: "image",
			});
		} else if (kind === "video") {
			if (!prompt.trim()) {
				throw new Error("Prompt is empty");
			}
			const clips = await generateVideo({
				prompt,
				provider: node.data.provider,
				model: node.data.model,
			});
			const clip = clips[0];
			if (!clip) {
				throw new Error("No video returned");
			}
			update({
				status: "done",
				result: clip.url,
				mediaType: "video",
			});
		} else if (kind === "text") {
			if (!prompt.trim()) {
				throw new Error("Prompt is empty");
			}
			const reply = await generateText({
				prompt,
				agentId: node.data.agentId,
				model: node.data.model,
				provider: node.data.provider,
			});
			if (!reply) {
				throw new Error("No reply returned");
			}
			update({ status: "done", text: reply });
		} else if (kind === "tts") {
			if (!prompt.trim()) {
				throw new Error("Nothing to speak");
			}
			const url = await speak({
				text: prompt,
				engine: node.data.engine,
				voice: node.data.voice,
			});
			update({
				status: "done",
				result: url,
				mediaType: "audio",
			});
		} else if (kind === "stt") {
			const audioUrl =
				node.data.mediaType === "audio" && node.data.result
					? node.data.result
					: incomers.find((u) => u.data.mediaType === "audio" && u.data.result)
							?.data.result;
			if (!audioUrl) {
				throw new Error("No audio to transcribe");
			}
			const text = await transcribe(audioUrl);
			if (!text) {
				throw new Error("No speech detected");
			}
			update({ status: "done", text });
		}
	} catch (e) {
		update({
			status: "error",
			error: e instanceof Error ? e.message : "Generation failed",
		});
	}
}
