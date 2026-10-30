import { describe, expect, test } from "bun:test";
import type { Node } from "@xyflow/react";
import { canvasEdgeSchema, canvasNodeSchema, logosSchema } from "./schemas.ts";
import type { CanvasNodeData } from "./types.ts";

describe("persisted React Flow contracts", () => {
	test("preserves native measured geometry and additive node data", () => {
		const node = {
			id: "note-1",
			position: { x: 10, y: 20 },
			type: "note",
			data: { kind: "note", text: "Review", futureField: { enabled: true } },
			measured: { width: 288, height: 160 },
		} satisfies Node<CanvasNodeData>;
		expect(canvasNodeSchema.parse(node)).toEqual(node);
	});
	test("rejects invalid geometry and runnable data at hydration", () => {
		const node = { id: "n1", position: { x: 0, y: 0 }, data: { kind: "text" } };
		expect(canvasNodeSchema.safeParse({ ...node, width: "bad" }).success).toBe(
			false
		);
		expect(
			canvasNodeSchema.safeParse({ ...node, selected: "bad" }).success
		).toBe(false);
		expect(
			canvasNodeSchema.safeParse({ ...node, measured: { width: "bad" } })
				.success
		).toBe(false);

		expect(
			canvasNodeSchema.safeParse({ ...node, position: { x: null, y: 0 } })
				.success
		).toBe(false);
		expect(
			canvasNodeSchema.safeParse({ ...node, data: { kind: "unknown" } }).success
		).toBe(false);
		expect(
			canvasNodeSchema.safeParse({
				...node,
				data: { kind: "text", prompt: [] },
			}).success
		).toBe(false);
		expect(
			canvasEdgeSchema.safeParse({ id: "e1", source: "n1", target: 2 }).success
		).toBe(false);
	});
});

test("SVGL parses both native route representations", () => {
	expect(
		logosSchema.parse([
			{ title: "Single", route: "https://example.com/single.svg" },
			{ title: "Theme", route: { light: "light.svg", dark: "dark.svg" } },
		])
	).toEqual([
		{ title: "Single", route: "https://example.com/single.svg" },
		{ title: "Theme", route: "light.svg" },
	]);
});
