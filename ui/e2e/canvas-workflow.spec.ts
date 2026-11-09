import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import type { HostServices } from "@ryu/app-host/rpc";
import type { RyuAgent, RyuAssets, RyuMedia, RyuModel } from "../src/ryu.d.ts";

interface CanvasProofState {
	agentCalls: Parameters<RyuAgent["run"]>[0][];
	assetImageCalls: Parameters<RyuAssets["searchImages"]>[0][];
	generatedAudio: string;
	generatedImage: string;
	generatedVideo: string;
	gifCalls: Parameters<RyuAssets["searchGifs"]>[0][];
	imageCalls: Parameters<RyuMedia["image"]>[0][];
	modelCalls: Parameters<RyuModel["complete"]>[0][];
	transcriptionCalls: Parameters<RyuMedia["transcribe"]>[0][];
	ttsCalls: Parameters<RyuMedia["tts"]>[0][];
	videoCalls: Parameters<RyuMedia["video"]>[0][];
	writes: { doc_id: string; source: string; title?: string }[];
}

interface CanvasFixtureOptions {
	agents?: {
		engine: string | null;
		id: string;
		model: string | null;
		name: string;
		recommended: boolean;
	}[];
	catalog?: RyuCatalogSnapshot | null;
	engineModels?: Record<string, { id: string; name: string }[]>;
	modelFailures?: number;
	ttsEngines?: {
		default_voice: string;
		display_name: string;
		id: string;
		voices: string[];
	}[];
}

declare global {
	interface Window {
		__assetScriptRan?: boolean;
		__canvasHostFixture: {
			calls: {
				input:
					| Parameters<NonNullable<HostServices["spacesGetDoc"]>>[0]
					| Parameters<NonNullable<HostServices["spacesUpdateDoc"]>>[0]
					| Parameters<NonNullable<HostServices["generateImage"]>>[0];
				method: string;
			}[];
			doc: { id: string; kind: string; source: string; title: string };
			generatedImage: string;
		};
		__canvasProof: CanvasProofState;
	}
}

const EMPTY_CATALOG: RyuCatalogSnapshot = {
	agents: [],
	apiTypes: [],
	current: { provider: "gateway", providerRouting: {}, routing: "gateway" },
	hookEvents: [],
	hooks: [],
	plugins: [],
	providers: [],
	thinkingLevels: [],
	version: 1,
};

const RUNTIME_CATALOG: RyuCatalogSnapshot = {
	...EMPTY_CATALOG,
	agents: [
		{
			engine: "fixture-engine",
			id: "fixture-agent",
			model: "fixture-agent-model",
			name: "Fixture review agent",
			title: "Fixture review agent",
			recommended: true,
			installed: true,
			enabled: true,
		},
	],
	providers: [
		{
			api: "openai",
			authKind: "api-key",
			configured: true,
			id: "fixture-provider",
			label: "Fixture provider",
			managed: false,
			suggestedModels: ["fixture-model"],
		},
	],
};

async function installCanvasBridge(
	page: import("@playwright/test").Page,
	options: CanvasFixtureOptions = {}
): Promise<void> {
	const settings = {
		agents: options.agents ?? [],
		catalog: options.catalog ?? null,
		engineModels: options.engineModels ?? {},
		modelFailures: options.modelFailures ?? 0,
		ttsEngines: options.ttsEngines ?? [],
	};
	await page.addInitScript((fixture) => {
		const sceneKey = "__ryu_canvas_test_scene";
		const imageCanvas = document.createElement("canvas");
		imageCanvas.width = 64;
		imageCanvas.height = 40;
		const imageContext = imageCanvas.getContext("2d");
		if (!imageContext) {
			throw new Error("Canvas fixture could not create its PNG context.");
		}
		imageContext.fillStyle = "#f59e0b";
		imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
		const proof: CanvasProofState = {
			agentCalls: [],
			assetImageCalls: [],
			generatedImage: imageCanvas.toDataURL("image/png"),
			generatedAudio:
				"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA=",
			generatedVideo: "data:video/mp4;base64,AAAA",
			gifCalls: [],
			imageCalls: [],
			modelCalls: [],
			transcriptionCalls: [],
			ttsCalls: [],
			videoCalls: [],
			writes: [],
		};
		Object.defineProperty(window, "__canvasProof", {
			configurable: true,
			value: proof,
		});
		Object.defineProperty(window, "ryu", {
			configurable: true,
			value: {
				context: { docId: "canvas-e2e-local-fixture" },
				spaces: {
					getDoc: async ({ doc_id }: { doc_id: string }) => ({
						id: doc_id,
						kind: "canvas",
						source: window.localStorage.getItem(sceneKey) ?? "",
						title: "Fixture board",
					}),
					updateDoc: async (input: {
						doc_id: string;
						source: string;
						title?: string;
					}) => {
						proof.writes.push(input);
						window.localStorage.setItem(sceneKey, input.source);
					},
				},
				registry: {
					agents: async () => fixture.agents,
					engineModels: async () => fixture.engineModels,
					ttsEngines: async () => fixture.ttsEngines,
				},
				catalog: {
					snapshot: async () => fixture.catalog,
					models: async ({ providerId }: { providerId: string }) => ({
						models: [],
						providerId,
						source: "fixture",
					}),
				},
				model: {
					complete: async (input: Parameters<RyuModel["complete"]>[0]) => {
						proof.modelCalls.push(input);
						if (fixture.modelFailures > 0) {
							fixture.modelFailures -= 1;
							throw new Error("Fixture model temporarily unavailable");
						}
						return "Fixture model response";
					},
				},
				agent: {
					run: async (input: Parameters<RyuAgent["run"]>[0]) => {
						proof.agentCalls.push(input);
						return "Fixture agent response";
					},
				},
				media: {
					image: async (input: Parameters<RyuMedia["image"]>[0]) => {
						proof.imageCalls.push(input);
						return [proof.generatedImage];
					},
					video: async (input: Parameters<RyuMedia["video"]>[0]) => {
						proof.videoCalls.push(input);
						return [{ mediaType: "video", url: proof.generatedVideo }];
					},
					tts: async (input: Parameters<RyuMedia["tts"]>[0]) => {
						proof.ttsCalls.push(input);
						return proof.generatedAudio;
					},
					transcribe: async (input: Parameters<RyuMedia["transcribe"]>[0]) => {
						proof.transcriptionCalls.push(input);
						return "Fixture transcript from uploaded audio";
					},
				},
				assets: {
					searchImages: async ({
						provider,
						query,
					}: Parameters<RyuAssets["searchImages"]>[0]) => {
						proof.assetImageCalls.push({ provider, query });
						return {
							configured: true,
							provider,
							results: [
								{
									attribution: "Local fixture artist",
									height: 32,
									id: `${provider}-fixture`,
									preview: proof.generatedImage,
									rights: "CC0 fixture",
									sourceUrl: "https://fixture.invalid/source",
									title: `${provider} fixture image`,
									url: proof.generatedImage,
									width: 32,
								},
							],
						};
					},
					searchGifs: async ({ query }: { query: string }) => {
						proof.gifCalls.push({ query });
						return {
							configured: true,
							results: [
								{
									height: 32,
									id: "fixture-gif",
									preview: proof.generatedImage,
									title: "Fixture celebration GIF",
									url: proof.generatedImage,
									width: 48,
								},
							],
						};
					},
				},
			},
		});
	}, settings);
}

async function screenshotPath(
	testInfo: { outputPath(name: string): string },
	name: string
) {
	const configured = process.env.RYU_APPS_STORE_PROOF_DIR;
	const destination = configured
		? path.join(configured, name)
		: testInfo.outputPath(name);
	await mkdir(path.dirname(destination), { recursive: true });
	return destination;
}

async function latestSavedScene(page: import("@playwright/test").Page) {
	return page.evaluate(() => {
		const last = window.__canvasProof.writes.at(-1);
		return last ? JSON.parse(last.source) : null;
	});
}

test("Canvas edits and runs an image node through local Space and media fixtures", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await installCanvasBridge(page);

	await page.goto("/");
	await expect(page.getByText("Add a node to start creating")).toBeVisible();
	await page.getByRole("button", { name: "Image", exact: true }).click();
	await page
		.getByPlaceholder("Describe the image to generate…")
		.fill("Wind-shaped sandstone arches at sunrise");
	await page.locator(".cv-card select").nth(0).selectOption("FLUX schnell");
	await page.locator(".cv-card select").nth(1).selectOption("1024x576");
	await page.locator(".cv-card").getByRole("button", { name: /Run/ }).click();
	const generatedImage = await page.evaluate(
		() => window.__canvasProof.generatedImage
	);
	const renderedImage = page.locator(".cv-card img.cv-media");
	await expect(renderedImage).toBeVisible();
	await expect(renderedImage).toHaveAttribute(
		"alt",
		"Wind-shaped sandstone arches at sunrise"
	);
	await expect(renderedImage).toHaveAttribute("src", generatedImage);
	await expect
		.poll(() =>
			renderedImage.evaluate((image: HTMLImageElement) => image.naturalWidth)
		)
		.toBe(64);
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.imageCalls))
		.toEqual([
			{
				prompt: "Wind-shaped sandstone arches at sunrise",
				provider: "replicate",
				model: "black-forest-labs/flux-schnell",
				size: "1024x576",
			},
		]);

	await page.locator(".cv-name").fill("Release map");
	await page.locator(".cv-name").press("Enter");
	await page.getByRole("button", { name: "Note", exact: true }).click();
	await page
		.getByPlaceholder("Write a note…")
		.fill("Review the local fixture before launch.");
	const imageHeader = page.locator(".cv-card .cv-head");
	const imageBox = await imageHeader.boundingBox();
	if (!imageBox) {
		throw new Error(
			"Canvas image header is not available to position the fixture."
		);
	}
	await page.mouse.move(imageBox.x + 90, imageBox.y + 16);
	await page.mouse.down();
	await page.mouse.move(imageBox.x + 480, imageBox.y + 16, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const last = window.__canvasProof.writes.at(-1);
				return last ? JSON.parse(last.source) : null;
			})
		)
		.toMatchObject({
			name: "Release map",
			nodes: [
				expect.objectContaining({
					data: expect.objectContaining({
						kind: "image",
						status: "done",
						prompt: "Wind-shaped sandstone arches at sunrise",
					}),
				}),
				expect.objectContaining({
					data: expect.objectContaining({
						kind: "note",
						text: "Review the local fixture before launch.",
					}),
				}),
			],
		});
	await expect(page.getByPlaceholder("Write a note…")).toBeVisible();
	expect(browserErrors).toEqual([]);
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: await screenshotPath(testInfo, "canvas-image-note-space-flow.png"),
	});
});

test("Canvas connects nodes, removes incident edges, and restores the saved scene", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await installCanvasBridge(page);
	await page.goto("/");

	await page.locator(".cv-name").fill("Connected pipeline");
	await page.locator(".cv-name").press("Enter");
	await page.getByRole("button", { name: "Image", exact: true }).click();
	await page.getByRole("button", { name: "Video", exact: true }).click();
	const nodes = page.locator(".react-flow__node");
	await expect(nodes).toHaveCount(2);
	const firstNode = nodes.nth(0);
	const secondNode = nodes.nth(1);
	await firstNode
		.getByPlaceholder("Describe the image to generate…")
		.fill("A still image feeding a video concept");
	await secondNode
		.getByPlaceholder("Describe the video to generate…")
		.fill("A paper lantern crosses the lake");
	const secondBox = await secondNode.boundingBox();
	if (!secondBox) {
		throw new Error("Second Canvas node did not render for connection proof.");
	}
	await page.mouse.move(secondBox.x + 100, secondBox.y + 20);
	await page.mouse.down();
	await page.mouse.move(secondBox.x + 390, secondBox.y + 210, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => secondNode.boundingBox()).not.toEqual(secondBox);

	const sourceHandle = firstNode.getByTestId("canvas-source-handle");
	const targetHandle = secondNode.getByTestId("canvas-target-handle");
	const sourceBox = await sourceHandle.boundingBox();
	const targetBox = await targetHandle.boundingBox();
	if (!(sourceBox && targetBox)) {
		throw new Error("Canvas node connection handles did not render.");
	}
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		sourceBox.y + sourceBox.height / 2
	);
	await page.mouse.down();
	await page.mouse.move(
		targetBox.x + targetBox.width / 2,
		targetBox.y + targetBox.height / 2,
		{ steps: 12 }
	);
	await page.mouse.up();
	await expect(page.locator(".react-flow__edge")).toHaveCount(1);
	await expect
		.poll(async () => (await latestSavedScene(page))?.edges?.length)
		.toBe(1);

	const controls = page.locator(".react-flow__controls");
	await controls.getByRole("button", { name: /zoom in/i }).click();
	await expect
		.poll(async () => (await latestSavedScene(page))?.viewport?.zoom)
		.toBeGreaterThan(1);
	await controls.getByRole("button", { name: /fit view/i }).click();
	await expect
		.poll(async () => (await latestSavedScene(page))?.viewport)
		.toMatchObject({ zoom: expect.any(Number) });
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: await screenshotPath(testInfo, "canvas-connected-pipeline.png"),
	});

	await firstNode.getByRole("button", { name: "Delete node" }).click();
	await expect(nodes).toHaveCount(1);
	await expect(page.locator(".react-flow__edge")).toHaveCount(0);
	await expect
		.poll(async () => latestSavedScene(page))
		.toMatchObject({ nodes: [expect.any(Object)], edges: [] });
	await expect
		.poll(async () => (await latestSavedScene(page))?.viewport)
		.toEqual(
			expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
		);
	await expect
		.poll(async () =>
			page.evaluate(() => window.__canvasProof.writes.at(-1)?.source)
		)
		.not.toBe("");
	await page.reload();
	await expect(page.locator(".cv-name")).toHaveValue("Connected pipeline");
	await expect(page.locator(".react-flow__node")).toHaveCount(1);
	await expect(page.locator(".react-flow__edge")).toHaveCount(0);
	const restored = await page.evaluate(() => {
		const source = window.localStorage.getItem("__ryu_canvas_test_scene");
		return source ? JSON.parse(source) : null;
	});
	expect(restored).toMatchObject({ nodes: [expect.any(Object)], edges: [] });
	expect(browserErrors).toEqual([]);
});

test("Canvas routes video and chat runs through their selected runtime and keeps useful errors retryable", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await installCanvasBridge(page, {
		agents: [
			{
				engine: "fixture-engine",
				id: "fixture-agent",
				model: "fixture-agent-model",
				name: "Fixture review agent",
				recommended: false,
			},
		],
		engineModels: {
			"fixture-engine": [
				{ id: "fixture-model", name: "Fixture model" },
				{ id: "fixture-model-fast", name: "Fixture fast model" },
			],
		},
		modelFailures: 1,
	});
	await page.goto("/");

	await page.getByRole("button", { name: "Video", exact: true }).click();
	const videoPrompt = page.getByPlaceholder("Describe the video to generate…");
	await videoPrompt.fill("A paper lantern rises over a quiet lake");
	const videoCard = page
		.locator(".react-flow__node")
		.filter({ has: videoPrompt });
	await videoCard.locator("select").selectOption("Kling v1.6");
	await videoCard.getByRole("button", { name: /Run/ }).click();
	await expect(videoCard.locator("video.cv-media")).toHaveAttribute(
		"src",
		"data:video/mp4;base64,AAAA"
	);
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.videoCalls))
		.toEqual([
			{
				prompt: "A paper lantern rises over a quiet lake",
				provider: "replicate",
				model: "kwaivgi/kling-v1.6-standard",
			},
		]);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data?.status)
		.toBe("done");

	await page.getByRole("button", { name: "Chat", exact: true }).click();
	const chatPrompt = page.getByPlaceholder("Message the agent…");
	const chatCard = page
		.locator(".react-flow__node")
		.filter({ has: chatPrompt });
	await chatCard.locator("select").nth(0).selectOption("fixture-agent");
	await chatPrompt.fill("Use the fixture agent for a first pass.");
	await chatCard.getByRole("button", { name: /Run/ }).click();
	await expect(chatCard.getByText("Fixture agent response")).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.agentCalls))
		.toEqual([
			{
				task: "Use the fixture agent for a first pass.",
				agent_id: "fixture-agent",
			},
		]);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data)
		.toMatchObject({
			kind: "text",
			status: "done",
			text: "Fixture agent response",
			agentId: "fixture-agent",
		});

	await chatCard.locator("select").nth(1).selectOption("fixture-model-fast");
	await chatPrompt.fill("Summarize the board context.");
	await chatCard.getByRole("button", { name: /Run/ }).click();
	await expect(
		chatCard.getByText("Fixture model temporarily unavailable")
	).toBeVisible();
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data?.status)
		.toBe("error");
	await chatCard.getByRole("button", { name: /Run/ }).click();
	await expect(chatCard.getByText("Fixture model response")).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.modelCalls))
		.toEqual([
			{
				prompt: "Summarize the board context.",
				model: "fixture-model-fast",
			},
			{
				prompt: "Summarize the board context.",
				model: "fixture-model-fast",
			},
		]);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data)
		.toMatchObject({
			kind: "text",
			status: "done",
			text: "Fixture model response",
			agentId: "fixture-agent",
			model: "fixture-model-fast",
		});
	await expect(page.locator(".cv-inline-error,.cv-preview-error")).toHaveCount(
		0
	);
	expect(browserErrors).toEqual([]);
});

test("Canvas uses the shared model-agent picker to select and persist a host runtime", async ({
	page,
}) => {
	await installCanvasBridge(page, { catalog: RUNTIME_CATALOG });
	await page.goto("/");
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	const runtimePicker = page.getByRole("combobox", {
		name: "Choose the Ryu chat runtime",
	});
	await runtimePicker.click();
	await page.getByRole("option", { name: /Fixture review agent/ }).click();
	await expect(runtimePicker).toContainText("Fixture review agent");
	const prompt = page.getByPlaceholder("Message the agent…");
	await prompt.fill("Check the selected Ryu runtime.");
	const chatCard = page.locator(".react-flow__node").filter({ has: prompt });
	await chatCard.getByRole("button", { name: /Run/ }).click();
	await expect(chatCard.getByText("Fixture agent response")).toBeVisible();
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data)
		.toMatchObject({
			kind: "text",
			status: "done",
			agentId: "fixture-agent",
			text: "Fixture agent response",
		});
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.agentCalls))
		.toEqual([
			{ task: "Check the selected Ryu runtime.", agent_id: "fixture-agent" },
		]);
});

test("Canvas persists speech and transcription settings and previews the real fixture media", async ({
	page,
}) => {
	await installCanvasBridge(page, {
		ttsEngines: [
			{
				default_voice: "Mica",
				display_name: "Fixture voice",
				id: "fixture-tts",
				voices: ["Mica", "Sage"],
			},
		],
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Speech", exact: true }).click();
	const speechPrompt = page.getByPlaceholder(
		"Text to speak (or wire a Chat node in)…"
	);
	const speechCard = page
		.locator(".react-flow__node")
		.filter({ has: speechPrompt });
	await speechCard.locator("select").nth(0).selectOption("fixture-tts");
	await speechCard.locator("select").nth(1).selectOption("Sage");
	await speechPrompt.fill("A short local voice fixture.");
	await speechCard.getByRole("button", { name: /Run/ }).click();
	await expect(speechCard.locator("audio.cv-audio")).toHaveAttribute(
		"src",
		"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA="
	);
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.ttsCalls))
		.toEqual([
			{
				text: "A short local voice fixture.",
				engine: "fixture-tts",
				voice: "Sage",
			},
		]);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data)
		.toMatchObject({
			kind: "tts",
			status: "done",
			engine: "fixture-tts",
			voice: "Sage",
			mediaType: "audio",
		});

	await page.getByRole("button", { name: "Transcribe", exact: true }).click();
	const transcriptionCard = page.locator(".react-flow__node").nth(1);
	await transcriptionCard.locator('input[type="file"]').setInputFiles({
		name: "fixture.wav",
		mimeType: "audio/wav",
		buffer: Buffer.from("local-audio-fixture"),
	});
	await expect(transcriptionCard.locator("audio.cv-audio")).toBeVisible();
	await transcriptionCard.getByRole("button", { name: /Run/ }).click();
	await expect(
		transcriptionCard.getByText("Fixture transcript from uploaded audio")
	).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.transcriptionCalls))
		.toHaveLength(1);
	const audioSource = await page.evaluate(
		() => window.__canvasProof.transcriptionCalls[0]?.audio
	);
	expect(audioSource).toMatch(/^data:audio\/wav;base64,/);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data)
		.toMatchObject({
			kind: "stt",
			status: "done",
			text: "Fixture transcript from uploaded audio",
			mediaType: "audio",
		});
});

test("Canvas asset search recovers, selects local icon, logo, image, and GIF fixtures", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await installCanvasBridge(page);
	await page.route("https://api.iconify.design/**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/collection") {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({ uncategorized: ["home"], categories: {} }),
			});
			return;
		}
		if (url.pathname === "/search") {
			const query = url.searchParams.get("query");
			if (query === "broken") {
				await route.fulfill({ status: 503, body: "fixture search failure" });
				return;
			}
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({ icons: [`lucide:${query || "star"}`] }),
			});
			return;
		}
		await route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
		});
	});
	await page.route("https://api.svgl.app/**", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify([
				{ title: "Ryu fixture logo", route: "https://cdn.svgl.app/ryu.svg" },
			]),
		});
	});
	await page.route("https://cdn.svgl.app/**", async (route) => {
		await route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 2h12v12H2z"/></svg>',
		});
	});
	await page.goto("/");
	const openAssets = async () => {
		await page.getByRole("button", { name: "Assets", exact: true }).click();
		return page.getByRole("dialog", { name: "Insert asset" });
	};
	const dialog = await openAssets();
	await dialog.getByLabel("Search assets").fill("broken");
	await expect(
		dialog.getByText(
			"Couldn't load results. Check your connection and try again."
		)
	).toBeVisible();
	await dialog.getByLabel("Search assets").fill("heart");
	await expect(
		dialog.getByRole("button", { name: "lucide:heart" })
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	const reopenedDialog = await openAssets();
	await expect(
		reopenedDialog.getByRole("button", { name: "lucide:home" })
	).toBeVisible();
	await reopenedDialog.getByLabel("Search assets").fill("heart");
	await expect(
		reopenedDialog.getByRole("button", { name: "lucide:heart" })
	).toBeVisible();
	await reopenedDialog.getByRole("button", { name: "lucide:heart" }).click();
	await expect(page.getByRole("dialog", { name: "Insert asset" })).toBeHidden();
	await expect(page.locator(".react-flow__node")).toHaveCount(1);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data)
		.toMatchObject({ kind: "upload", status: "done", mediaType: "image" });
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data?.result)
		.toMatch(/^data:image\/png;base64,/);

	await expect(page.locator(".react-flow__node img.cv-media")).toHaveCount(1);
	await expect
		.poll(() =>
			page
				.locator(".react-flow__node img.cv-media")
				.first()
				.evaluate((image: HTMLImageElement) => image.naturalWidth)
		)
		.toBe(512);
	const logoDialog = await openAssets();
	await logoDialog.getByRole("button", { name: "Logos", exact: true }).click();
	await logoDialog.getByLabel("Search assets").fill("ryu");
	await expect(
		logoDialog.getByRole("button", { name: "Ryu fixture logo" })
	).toBeVisible();
	await logoDialog.getByRole("button", { name: "Icons", exact: true }).click();
	await expect(
		logoDialog.getByRole("button", { name: "lucide:ryu" })
	).toBeVisible();
	await logoDialog.getByRole("button", { name: "Logos", exact: true }).click();
	await expect(
		logoDialog.getByRole("button", { name: "Ryu fixture logo" })
	).toBeVisible();
	await logoDialog.getByRole("button", { name: "Ryu fixture logo" }).click();
	await expect(page.locator(".react-flow__node")).toHaveCount(2);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data?.result)
		.toMatch(/^data:image\/png;base64,/);

	await expect(page.locator(".react-flow__node img.cv-media")).toHaveCount(2);
	await expect
		.poll(() =>
			page
				.locator(".react-flow__node img.cv-media")
				.nth(1)
				.evaluate((image: HTMLImageElement) => image.naturalWidth)
		)
		.toBe(512);
	const openverseDialog = await openAssets();
	await openverseDialog
		.getByRole("button", { name: "Openverse", exact: true })
		.click();
	await openverseDialog.getByLabel("Search assets").fill("arches");
	await expect(
		openverseDialog.getByRole("button", { name: /openverse fixture image/ })
	).toBeVisible();
	await openverseDialog
		.getByRole("button", { name: /openverse fixture image/ })
		.click();
	await expect(page.locator(".react-flow__node")).toHaveCount(3);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[2]?.data?.result)
		.toBe(await page.evaluate(() => window.__canvasProof.generatedImage));

	const unsplashDialog = await openAssets();
	await unsplashDialog
		.getByRole("button", { name: "Unsplash", exact: true })
		.click();
	await unsplashDialog.getByLabel("Search assets").fill("shore");
	await expect(
		unsplashDialog.getByRole("button", { name: /unsplash fixture image/ })
	).toBeVisible();
	await unsplashDialog
		.getByRole("button", { name: /unsplash fixture image/ })
		.click();
	await expect(page.locator(".react-flow__node")).toHaveCount(4);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[3]?.data?.result)
		.toBe(await page.evaluate(() => window.__canvasProof.generatedImage));

	const gifDialog = await openAssets();
	await gifDialog.getByRole("button", { name: "GIFs", exact: true }).click();
	await gifDialog.getByLabel("Search assets").fill("celebrate");
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.gifCalls))
		.toEqual(expect.arrayContaining([{ query: "celebrate" }]));
	await expect(
		gifDialog.getByRole("button", { name: "Fixture celebration GIF" })
	).toBeVisible();
	await gifDialog
		.getByRole("button", { name: "Fixture celebration GIF" })
		.click();
	await expect(page.locator(".react-flow__node")).toHaveCount(5);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[4]?.data)
		.toMatchObject({
			kind: "upload",
			status: "done",
			mediaType: "image",
			result: await page.evaluate(() => window.__canvasProof.generatedImage),
		});
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.assetImageCalls))
		.toEqual(
			expect.arrayContaining([
				{ provider: "openverse", query: "arches" },
				{ provider: "unsplash", query: "shore" },
			])
		);
	await expect
		.poll(() => page.evaluate(() => window.__canvasProof.gifCalls))
		.toEqual(expect.arrayContaining([{ query: "celebrate" }]));
	await page.getByRole("button", { name: "Fit View" }).click();
	const zoomOut = page.getByRole("button", { name: "Zoom Out" });
	await zoomOut.click();
	await zoomOut.click();
	await expect
		.poll(async () => (await latestSavedScene(page))?.viewport?.zoom)
		.toBeLessThan(0.9);
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: await screenshotPath(testInfo, "canvas-local-assets-inserted.png"),
	});
	await expect(page.locator(".cv-inline-error,.cv-preview-error")).toHaveCount(
		0
	);
	expect(browserErrors).toEqual([]);
});

test("Canvas uploads a local file and imports pasted text without hijacking text editing", async ({
	page,
}) => {
	await installCanvasBridge(page);
	await page.goto("/");
	await page.getByRole("button", { name: "Upload", exact: true }).click();
	const uploadCard = page.locator(".react-flow__node").first();
	await uploadCard.locator('input[type="file"]').setInputFiles({
		name: "fixture.png",
		mimeType: "image/png",
		buffer: Buffer.from("canvas-file-fixture"),
	});
	const uploadPreview = uploadCard.locator("img.cv-media");
	await expect(uploadPreview).toBeVisible();
	await expect(uploadPreview).toHaveAttribute(
		"src",
		/^data:image\/png;base64,/
	);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data)
		.toMatchObject({ kind: "upload", status: "idle", mediaType: "image" });
	const imageSource = await uploadPreview.getAttribute("src");
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data?.result)
		.toBe(imageSource);

	const noteInput = page.locator(".cv-name");
	await noteInput.fill("Clipboard must stay inside fields");
	await page.evaluate(() => {
		const field = document.querySelector<HTMLInputElement>(".cv-name");
		if (!field) {
			throw new Error("Canvas name field was not mounted.");
		}
		const clipboard = {
			files: [],
			items: [],
			getData: (format: string) =>
				format === "text/plain" ? "Should stay in the field" : "",
		};
		const event = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: clipboard });
		field.dispatchEvent(event);
	});
	await expect(page.locator(".react-flow__node")).toHaveCount(1);
	await page.evaluate(() => {
		const clipboard = {
			files: [],
			items: [],
			getData: (format: string) =>
				format === "text/plain" ? "  Pasted acceptance criteria  " : "",
		};
		const event = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: clipboard });
		document.body.dispatchEvent(event);
	});
	await expect(page.locator(".react-flow__node")).toHaveCount(2);
	await expect(page.getByPlaceholder("Write a note…")).toHaveValue(
		"Pasted acceptance criteria"
	);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data)
		.toMatchObject({ kind: "note", text: "Pasted acceptance criteria" });
	await page.evaluate(() => {
		const file = new File(["clipboard-image-fixture"], "pasted.png", {
			type: "image/png",
		});
		const clipboard = new DataTransfer();
		clipboard.items.add(file);
		const event = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: clipboard });
		document.body.dispatchEvent(event);
	});
	await expect(page.locator(".react-flow__node")).toHaveCount(3);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[2]?.data)
		.toMatchObject({ kind: "upload", status: "done", mediaType: "image" });
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[2]?.data?.result)
		.toMatch(/^data:image\/png;base64,/);
});

test("Canvas maps note color and imported media drops to saved node data", async ({
	page,
}) => {
	await installCanvasBridge(page);
	await page.goto("/");
	await page.getByRole("button", { name: "Note", exact: true }).click();
	const note = page.locator(".cv-note");
	await note.getByRole("button", { name: "Green note" }).click();
	await expect(note).toHaveAttribute("data-color", "green");
	await note.getByPlaceholder("Write a note…").fill("Green card data persists");
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data)
		.toMatchObject({ noteColor: "green", text: "Green card data persists" });

	await page.evaluate(() => {
		const file = new File(["drop-image-fixture"], "dropped.png", {
			type: "image/png",
		});
		const transfer = new DataTransfer();
		transfer.items.add(file);
		const root = document.querySelector(".cv-root");
		if (!root) {
			throw new Error("Canvas drop target was not mounted.");
		}
		root.dispatchEvent(
			new DragEvent("dragover", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
			})
		);
	});
	await expect(page.getByText("Drop to add to canvas")).toBeVisible();
	await page.evaluate(() => {
		const file = new File(["drop-image-fixture"], "dropped.png", {
			type: "image/png",
		});
		const transfer = new DataTransfer();
		transfer.items.add(file);
		const root = document.querySelector(".cv-root");
		if (!root) {
			throw new Error("Canvas drop target was not mounted.");
		}
		root.dispatchEvent(
			new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				clientX: 700,
				clientY: 480,
				dataTransfer: transfer,
			})
		);
	});
	await expect(page.getByText("Drop to add to canvas")).toHaveCount(0);
	await expect(page.locator(".react-flow__node")).toHaveCount(2);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data)
		.toMatchObject({ kind: "upload", status: "done", mediaType: "image" });
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[1]?.data?.result)
		.toMatch(/^data:image\/png;base64,/);
});

test("the shipped Canvas bundle saves and generates through the real ExtensionHost bridge", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await page.goto("/e2e/extension-host.html");
	const app = page.frameLocator('iframe[title="Canvas"]');
	await expect(
		app.getByRole("button", { name: "Image", exact: true })
	).toBeVisible({ timeout: 15_000 });
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__canvasHostFixture.calls.some(
					(call) => call.method === "spaces.getDoc"
				)
			)
		)
		.toBe(true);

	await app.locator(".cv-name").fill("Host-backed board");
	await app.locator(".cv-name").press("Enter");
	await app.getByRole("button", { name: "Note", exact: true }).click();
	await app
		.getByPlaceholder("Write a note…")
		.fill("This state crossed the real sandbox bridge.");
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__canvasHostFixture.calls.some(
					(call) => call.method === "spaces.updateDoc"
				)
			)
		)
		.toBe(true);

	await app.getByRole("button", { name: "Image", exact: true }).click();
	const imagePrompt = app.getByPlaceholder("Describe the image to generate…");
	const imageCard = app
		.locator(".react-flow__node")
		.filter({ has: imagePrompt });
	await imagePrompt.fill("A local image through the host capability gate");
	await imageCard.locator("select").nth(0).selectOption("FLUX schnell");
	await imageCard.getByRole("button", { name: /Run/ }).click();
	const result = imageCard.locator("img.cv-media");
	await expect(result).toBeVisible();
	await expect(result).toHaveAttribute("src", /^data:image\/png;base64,/);
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__canvasHostFixture.calls.filter(
					(call) => call.method === "media.image"
				)
			)
		)
		.toEqual([
			{
				method: "media.image",
				input: {
					prompt: "A local image through the host capability gate",
					provider: "replicate",
					model: "black-forest-labs/flux-schnell",
					size: "1024x1024",
				},
			},
		]);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const { source, title } = window.__canvasHostFixture.doc;
				return { scene: source ? JSON.parse(source) : null, title };
			})
		)
		.toMatchObject({
			title: "Host-backed board",
			scene: {
				name: "Host-backed board",
				nodes: [
					expect.objectContaining({
						data: expect.objectContaining({
							kind: "note",
							text: "This state crossed the real sandbox bridge.",
						}),
					}),
					expect.objectContaining({
						data: expect.objectContaining({
							kind: "image",
							status: "done",
							prompt: "A local image through the host capability gate",
							model: "black-forest-labs/flux-schnell",
						}),
					}),
				],
			},
		});
	expect(browserErrors).toEqual([]);
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: await screenshotPath(
			testInfo,
			"canvas-extensionhost-shipped-bundle.png"
		),
	});
});

test("Canvas restores safe SVG pixels and rejects active SVG content", async ({
	page,
}, testInfo) => {
	await installCanvasBridge(page);
	const good =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#ff0000"/></svg>';
	const bad =
		'<svg xmlns="http://www.w3.org/2000/svg"><script>window.__assetScriptRan=true</script></svg>';
	await page.addInitScript(
		({ goodSvg, badSvg }) => {
			localStorage.setItem(
				"__ryu_canvas_test_scene",
				JSON.stringify({
					nodes: [goodSvg, badSvg].map((svg, index) => ({
						id: `old-${index}`,
						type: "upload",
						position: { x: index * 400, y: 0 },
						data: {
							kind: "upload",
							status: "done",
							mediaType: "image",
							result: `data:image/svg+xml;base64,${btoa(svg)}`,
						},
					})),
					edges: [],
					viewport: { x: 0, y: 0, zoom: 1 },
				})
			);
		},
		{ goodSvg: good, badSvg: bad }
	);
	await page.goto("/");
	const image = page.locator(".react-flow__node img.cv-media");
	await expect(image).toHaveCount(1);
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => element.naturalWidth)
		)
		.toBe(512);
	expect(
		await image.evaluate((element: HTMLImageElement) => {
			const canvas = document.createElement("canvas");
			canvas.width = 512;
			canvas.height = 512;
			const context = canvas.getContext("2d");
			if (!context) {
				throw new Error("No pixel context");
			}
			context.drawImage(element, 0, 0);
			return Array.from(context.getImageData(256, 256, 1, 1).data);
		})
	).toEqual([255, 0, 0, 255]);
	await expect(
		page.getByText("Couldn't display this SVG asset.")
	).toBeVisible();
	expect(await page.evaluate(() => window.__assetScriptRan)).toBeUndefined();
	await page.screenshot({
		path: await screenshotPath(testInfo, "canvas-restored-svg-safe-pixels.png"),
		fullPage: true,
	});
});

test("Canvas rejects unsafe and invalid asset selections, then retries without losing the board", async ({
	page,
}) => {
	await installCanvasBridge(page);
	const fixtures = [
		'<svg xmlns="http://www.w3.org/2000/svg"><script>window.__assetScriptRan=true</script></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://unsafe.example/track"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" onload="window.__assetScriptRan=true"/>',
		'<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://unsafe.example/track)"/></svg>',
		"<svg>broken",
	];
	let body = fixtures[0] ?? "";
	await page.route("https://api.iconify.design/**", async (route) => {
		if (new URL(route.request().url()).pathname === "/collection") {
			await route.fulfill({
				json: { uncategorized: ["heart"], categories: {} },
			});
		} else {
			await route.fulfill({ contentType: "image/svg+xml", body });
		}
	});
	await page.goto("/");
	for (const svg of fixtures) {
		body = svg;
		await page.getByRole("button", { name: "Assets", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Insert asset" });
		await dialog.getByRole("button", { name: "lucide:heart" }).click();
		await expect(
			dialog.getByText("Couldn't load that icon. Try another.")
		).toBeVisible();
		await expect(page.locator(".react-flow__node")).toHaveCount(0);
		await page.keyboard.press("Escape");
	}
	expect(await page.evaluate(() => window.__assetScriptRan)).toBeUndefined();
	body =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="blue"/></svg>';
	await page.getByRole("button", { name: "Assets", exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "lucide:heart" })
		.click();
	await expect(page.locator(".react-flow__node img.cv-media")).toHaveCount(1);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.[0]?.data?.result)
		.toMatch(/^data:image\/png;base64,/);
});

test("Canvas cancelling an in-flight asset fetch never inserts a late node", async ({
	page,
}) => {
	await installCanvasBridge(page);
	let release: (() => void) | undefined;
	let started: (() => void) | undefined;
	const fetched = new Promise<void>((resolve) => {
		started = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("https://api.iconify.design/**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/collection") {
			await route.fulfill({
				json: { uncategorized: ["heart"], categories: {} },
			});
			return;
		}
		if (url.searchParams.get("color") === "#111827") {
			started?.();
			await held;
		}
		await route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>',
		});
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Assets", exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "lucide:heart" })
		.click();
	await fetched;
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
	const response = page.waitForResponse((value) =>
		value.url().includes("color=%23111827")
	);
	release?.();
	await response;
	await page.getByRole("button", { name: "Assets", exact: true }).click();
	await expect(
		page.getByRole("dialog").getByRole("button", { name: "lucide:heart" })
	).toBeVisible();
	await expect(page.locator(".react-flow__node")).toHaveCount(0);
	expect(await latestSavedScene(page)).toBeNull();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "lucide:heart" })
		.click();
	await expect(page.locator(".react-flow__node img.cv-media")).toHaveCount(1);
	await expect
		.poll(async () => (await latestSavedScene(page))?.nodes?.length)
		.toBe(1);
});
