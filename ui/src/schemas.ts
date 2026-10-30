import {
	jsonResponseDocumentSchema,
	jsonResponseValueSchema,
} from "@ryu/app-host/json-values";
import { Position } from "@xyflow/react";
import { z } from "zod";

export const canvasViewportSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	zoom: z.number().finite().positive(),
});
export const canvasSceneSchema = z.object({
	name: z.string().optional().catch(undefined),
	nodes: z.array(z.unknown()).catch([]),
	edges: z.array(z.unknown()).catch([]),
	viewport: canvasViewportSchema.optional().catch(undefined),
});
export const canvasNodeSchema = z.object({
	id: z.string(),
	position: z.object({ x: z.number().finite(), y: z.number().finite() }),
	data: z
		.object({
			kind: z.enum(["image", "video", "text", "tts", "stt", "upload", "note"]),
			status: z.enum(["idle", "running", "done", "error"]).optional(),
			mediaType: z.enum(["image", "video", "audio"]).optional(),
			agentId: z.string().optional(),
			agentLabel: z.string().optional(),
			engine: z.string().optional(),
			error: z.string().optional(),
			model: z.string().optional(),
			modelLabel: z.string().optional(),
			noteColor: z.string().optional(),
			prompt: z.string().optional(),
			provider: z.string().optional(),
			result: z.string().optional(),
			size: z.string().optional(),
			text: z.string().optional(),
			voice: z.string().optional(),
		})
		.catchall(jsonResponseValueSchema),
	type: z.string().optional(),
	sourcePosition: z.enum(Position).optional(),
	targetPosition: z.enum(Position).optional(),
	hidden: z.boolean().optional(),
	selected: z.boolean().optional(),
	dragging: z.boolean().optional(),
	draggable: z.boolean().optional(),
	selectable: z.boolean().optional(),
	connectable: z.boolean().optional(),
	deletable: z.boolean().optional(),
	focusable: z.boolean().optional(),
	dragHandle: z.string().optional(),
	parentId: z.string().optional(),
	width: z.number().finite().optional(),
	height: z.number().finite().optional(),
	initialWidth: z.number().finite().optional(),
	initialHeight: z.number().finite().optional(),
	zIndex: z.number().finite().optional(),
	expandParent: z.boolean().optional(),
	ariaLabel: z.string().optional(),
	ariaRole: z.string().optional(),
	className: z.string().optional(),
	style: z
		.record(z.string(), z.union([z.string(), z.number().finite()]))
		.optional(),
	origin: z.tuple([z.number().finite(), z.number().finite()]).optional(),
	extent: z
		.union([
			z.literal("parent"),
			z.tuple([
				z.tuple([z.number().finite(), z.number().finite()]),
				z.tuple([z.number().finite(), z.number().finite()]),
			]),
		])
		.nullable()
		.optional(),
	measured: z
		.object({
			width: z.number().finite().optional(),
			height: z.number().finite().optional(),
		})
		.optional(),
	handles: z
		.array(
			z.object({
				id: z.string().nullable().optional(),
				type: z.enum(["source", "target"]),
				position: z.enum(Position),
				x: z.number().finite(),
				y: z.number().finite(),
				width: z.number().finite().optional(),
				height: z.number().finite().optional(),
			})
		)
		.optional(),
});
const markerSchema = z.union([
	z.string(),
	z.object({
		type: z.enum(["arrow", "arrowclosed"]),
		color: z.string().nullable().optional(),
		width: z.number().finite().optional(),
		height: z.number().finite().optional(),
		markerUnits: z.string().optional(),
		orient: z.string().optional(),
		strokeWidth: z.number().finite().optional(),
	}),
]);
export const canvasEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	target: z.string(),
	type: z.string().optional(),
	sourceHandle: z.string().nullable().optional(),
	targetHandle: z.string().nullable().optional(),
	animated: z.boolean().optional(),
	hidden: z.boolean().optional(),
	deletable: z.boolean().optional(),
	selectable: z.boolean().optional(),
	selected: z.boolean().optional(),
	focusable: z.boolean().optional(),
	data: jsonResponseDocumentSchema.optional(),
	markerStart: markerSchema.optional(),
	markerEnd: markerSchema.optional(),
	zIndex: z.number().finite().optional(),
	ariaLabel: z.string().optional(),
	ariaRole: z.string().optional(),
	interactionWidth: z.number().finite().optional(),
	className: z.string().optional(),
	style: z
		.record(z.string(), z.union([z.string(), z.number().finite()]))
		.optional(),
	label: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
	labelStyle: z
		.record(z.string(), z.union([z.string(), z.number().finite()]))
		.optional(),
	labelShowBg: z.boolean().optional(),
	labelBgStyle: z
		.record(z.string(), z.union([z.string(), z.number().finite()]))
		.optional(),
	labelBgPadding: z
		.tuple([z.number().finite(), z.number().finite()])
		.optional(),
	labelBgBorderRadius: z.number().finite().optional(),
});
export const savedCanvasSceneSchema = z.object({
	name: z.string(),
	nodes: z.array(canvasNodeSchema),
	edges: z.array(canvasEdgeSchema),
	viewport: canvasViewportSchema.optional(),
});
export const iconSearchSchema = z.object({
	icons: z.array(z.string()).optional(),
	uncategorized: z.array(z.string()).optional(),
	categories: z.record(z.string(), z.array(z.string())).optional(),
});
export const logosSchema = z.array(
	z.object({
		title: z.string(),
		route: z.union([
			z.string(),
			z
				.object({ light: z.string(), dark: z.string() })
				.transform((route) => route.light),
		]),
	})
);
