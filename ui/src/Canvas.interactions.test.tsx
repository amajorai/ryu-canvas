import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CanvasScene } from "./bridge.ts";
import type { RyuMedia } from "./ryu.d.ts";
import { savedCanvasSceneSchema } from "./schemas.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Canvas } = await import("./Canvas.tsx");

interface CanvasUpdate {
	doc_id: string;
	source: string;
	title?: string;
}

interface MountedApp {
	container: HTMLDivElement;
	root: Root;
}

const mountedApps: MountedApp[] = [];
const updates: CanvasUpdate[] = [];
const imageCalls: Parameters<RyuMedia["image"]>[0][] = [];
const GENERATED_IMAGE = "data:image/png;base64,ZXhhbXBsZQ==";

function installBridge(scene: CanvasScene | null = null): void {
	updates.length = 0;
	imageCalls.length = 0;
	Reflect.set(window, "ryu", {
		context: { docId: "fixture-canvas-1" },
		spaces: {
			getDoc: async ({ doc_id }: { doc_id: string }) => ({
				id: doc_id,
				kind: "canvas",
				source: scene ? JSON.stringify(scene) : "",
				title: scene?.name ?? "Fixture board",
			}),
			updateDoc: async (input: CanvasUpdate) => {
				updates.push(structuredClone(input));
			},
		},
		registry: {
			agents: async () => [],
			engineModels: async () => ({}),
			ttsEngines: async () => [],
		},
		catalog: {
			snapshot: async () => null,
		},
		media: {
			image: async (input: Parameters<RyuMedia["image"]>[0]) => {
				imageCalls.push(structuredClone(input));
				return [GENERATED_IMAGE];
			},
		},
	});
}

async function tick(delay = 0): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, delay));
}

async function mountApp(): Promise<HTMLDivElement> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedApps.push({ container, root });
	await act(async () => {
		root.render(<Canvas />);
		await tick(20);
	});
	return container;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
	const button = [...container.querySelectorAll("button")].find(
		(candidate) =>
			candidate.getAttribute("aria-label") === label ||
			candidate.textContent?.trim().includes(label)
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Could not find Canvas button: ${label}`);
	}
	return button;
}

async function clickButton(
	container: HTMLElement,
	label: string,
	delay = 0
): Promise<void> {
	await act(async () => {
		findButton(container, label).click();
		await tick(delay);
	});
}

async function setField(
	container: HTMLElement,
	selector: string,
	value: string
): Promise<void> {
	const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
		selector
	);
	if (!field) {
		throw new Error(`Could not find Canvas field: ${selector}`);
	}
	await act(async () => {
		field.focus();
		const setter = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(field),
			"value"
		)?.set;
		if (setter) {
			setter.call(field, value);
		} else {
			field.value = value;
		}
		field.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
	});
}

async function selectValue(
	container: HTMLElement,
	selector: string,
	value: string,
	index = 0
): Promise<void> {
	const select = container
		.querySelectorAll<HTMLSelectElement>(selector)
		.item(index);
	if (!select) {
		throw new Error(`Could not find Canvas select: ${selector}`);
	}
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(select),
			"value"
		)?.set;
		if (setter) {
			setter.call(select, value);
		} else {
			select.value = value;
		}
		select.dispatchEvent(new Event("change", { bubbles: true }));
		await tick();
	});
}

afterEach(async () => {
	for (const { container, root } of mountedApps.splice(0)) {
		await act(async () => root.unmount());
		container.remove();
	}
	Reflect.set(window, "ryu", undefined);
});

describe("Canvas rendered board workflow", () => {
	test("renames the Space board, edits a note node, deletes it, and persists each scene", async () => {
		installBridge();
		const container = await mountApp();
		expect(container.querySelector(".cv-brand")?.textContent).toBe("Canvas");
		expect(container.querySelector<HTMLInputElement>(".cv-name")?.value).toBe(
			"Untitled canvas"
		);

		await setField(container, ".cv-name", "  Release plan  ");
		await act(async () => {
			container.querySelector<HTMLInputElement>(".cv-name")?.blur();
			await tick();
		});
		await clickButton(container, "Note");

		const note = container.querySelector<HTMLTextAreaElement>(
			'textarea[placeholder="Write a note…"]'
		);
		expect(note).not.toBeNull();
		await setField(
			container,
			'textarea[placeholder="Write a note…"]',
			"Ship the new media review flow."
		);
		await act(async () => tick(900));

		const saved = updates.at(-1);
		expect(saved?.doc_id).toBe("fixture-canvas-1");
		expect(saved?.title).toBe("Release plan");
		const scene = savedCanvasSceneSchema.parse(JSON.parse(saved?.source ?? ""));
		expect(scene.name).toBe("Release plan");
		expect(scene.nodes).toHaveLength(1);
		expect(scene.nodes[0]).toMatchObject({
			data: {
				kind: "note",
				text: "Ship the new media review flow.",
			},
			type: "note",
		});

		await clickButton(container, "Delete note");
		await act(async () => tick(900));
		const afterDelete = savedCanvasSceneSchema.parse(
			JSON.parse(updates.at(-1)?.source ?? "")
		);
		expect(afterDelete.nodes).toEqual([]);
		expect(container.querySelector(".cv-note")).toBeNull();
	});

	test("runs an image node with the selected model, size, and prompt through a local fixture", async () => {
		installBridge();
		const container = await mountApp();
		await clickButton(container, "Image");
		await setField(
			container,
			'textarea[placeholder="Describe the image to generate…"]',
			"Wind-shaped sandstone arches at sunrise"
		);
		await selectValue(container, ".cv-card select", "FLUX schnell");
		await selectValue(container, ".cv-card select", "1024x576", 1);
		await clickButton(container, "Run");

		expect(imageCalls).toEqual([
			{
				prompt: "Wind-shaped sandstone arches at sunrise",
				provider: "replicate",
				model: "black-forest-labs/flux-schnell",
				size: "1024x576",
			},
		]);
		expect(
			container.querySelector<HTMLImageElement>(
				'img[alt="Wind-shaped sandstone arches at sunrise"]'
			)?.src
		).toBe(GENERATED_IMAGE);
		await act(async () => tick(900));

		const saved = savedCanvasSceneSchema.parse(
			JSON.parse(updates.at(-1)?.source ?? "")
		);
		expect(saved.nodes).toHaveLength(1);
		expect(saved.nodes[0]).toMatchObject({
			data: {
				kind: "image",
				status: "done",
				prompt: "Wind-shaped sandstone arches at sunrise",
				provider: "replicate",
				model: "black-forest-labs/flux-schnell",
				size: "1024x576",
				result: GENERATED_IMAGE,
			},
			type: "image",
		});
	});

	test("assigns unique ids when users add nodes in the same millisecond", async () => {
		installBridge();
		const container = await mountApp();
		const originalNow = Date.now;
		Reflect.set(Date, "now", () => 1_780_000_000_000);
		try {
			await clickButton(container, "Note");
			await clickButton(container, "Image");
		} finally {
			Reflect.set(Date, "now", originalNow);
		}
		await act(async () => tick(900));

		const saved = savedCanvasSceneSchema.parse(
			JSON.parse(updates.at(-1)?.source ?? "")
		);
		expect(saved.nodes).toHaveLength(2);
		const ids = saved.nodes.map((node) => node.id);
		expect(new Set(ids).size).toBe(2);
		expect(saved.nodes.map((node) => node.type)).toEqual(["note", "image"]);
	});
});
