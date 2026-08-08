// The Canvas board: a ComfyUI / ElevenLabs-Flows-style React Flow surface where
// each node generates image/video/text/speech (or holds an upload/note) and nodes
// wire into pipelines. Ported from the built-in desktop CanvasPage: the board now
// loads/saves the whole graph into ONE Space document via the window.ryu bridge
// (spaces:docs), and every node's Run goes through the governed media/agent bridge
// (media:generate / media:transcribe / hook:run-agent) instead of direct Core
// calls. The frame is CSP-locked (connect-src 'none'), so all egress is the host
// port; media results arrive as data: URLs the frame can render inline.

import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type Edge,
	type EdgeChange,
	getIncomers,
	MarkerType,
	type Node,
	type NodeChange,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetPicker } from "./AssetPicker";
import {
	type AssetSelection,
	generateImage,
	generateText,
	generateVideo,
	loadRegistry,
	loadScene,
	saveScene,
	speak,
	svgDataUrl,
	transcribe,
} from "./bridge";
import { CANVAS_NODE_TYPES } from "./nodes";
import {
	type CanvasNodeData,
	type CanvasNodeKind,
	type CanvasRegistry,
	CanvasRegistryContext,
	CanvasRuntimeContext,
	IMAGE_MODELS,
	IMAGE_SIZES,
	VIDEO_MODELS,
} from "./types";

// Stable references for React Flow props (avoid the "getSnapshot should be cached"
// re-render loop).
const PRO_OPTIONS = { hideAttribution: true } as const;
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1 } as const;
const DEFAULT_EDGE_OPTIONS = {
	type: "default",
	markerEnd: { type: MarkerType.ArrowClosed },
} as const;
const EMPTY_REGISTRY: CanvasRegistry = {
	agents: [],
	engineModels: {},
	ttsEngines: [],
};

type CanvasNode = Node<CanvasNodeData>;

const TOOLS: { kind: CanvasNodeKind; label: string }[] = [
	{ kind: "text", label: "Chat" },
	{ kind: "image", label: "Image" },
	{ kind: "video", label: "Video" },
	{ kind: "tts", label: "Speech" },
	{ kind: "stt", label: "Transcribe" },
	{ kind: "upload", label: "Upload" },
	{ kind: "note", label: "Note" },
];

/** Seed data for a freshly added node of each kind. */
function seedData(kind: CanvasNodeKind): CanvasNodeData {
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
function upstreamText(own: string, incomers: CanvasNode[]): string {
	const refs = incomers
		.map(
			(u) =>
				(u.data as CanvasNodeData).text ?? (u.data as CanvasNodeData).prompt
		)
		.filter((s): s is string => Boolean(s?.trim()));
	return [...refs, own].filter((s) => s.trim()).join("\n");
}

function fileToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Failed to read file"));
		reader.readAsDataURL(blob);
	});
}

function mediaTypeFromMime(mime: string): "image" | "video" | "audio" {
	if (mime.startsWith("video/")) {
		return "video";
	}
	if (mime.startsWith("audio/")) {
		return "audio";
	}
	return "image";
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	);
}

function collectMediaFiles(data: DataTransfer): File[] {
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

function CanvasBoard({ docId }: { docId: string }) {
	const rf = useReactFlow();
	const wrapperRef = useRef<HTMLDivElement>(null);

	const [registry, setRegistry] = useState<CanvasRegistry>(EMPTY_REGISTRY);
	useEffect(() => {
		let cancelled = false;
		loadRegistry()
			.then((r) => {
				if (!cancelled) {
					setRegistry(r);
				}
			})
			.catch(() => {
				// Registry is best-effort; pickers just show empty.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const [nodes, setNodes] = useState<CanvasNode[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	const [name, setName] = useState("Untitled canvas");
	const [isDragOver, setIsDragOver] = useState(false);
	const [assetOpen, setAssetOpen] = useState(false);

	const nodesRef = useRef<CanvasNode[]>([]);
	const edgesRef = useRef<Edge[]>([]);
	nodesRef.current = nodes;
	edgesRef.current = edges;

	const hydratedRef = useRef(false);
	const viewportRef = useRef<Viewport | undefined>(undefined);
	const nameRef = useRef(name);
	nameRef.current = name;
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Load ────────────────────────────────────────────────────────────────
	useEffect(() => {
		hydratedRef.current = false;
		let cancelled = false;
		loadScene(docId)
			.then((scene) => {
				if (cancelled) {
					return;
				}
				if (scene) {
					const loaded = (scene.nodes as CanvasNode[]).map((n) =>
						n.data?.status === "running"
							? { ...n, data: { ...n.data, status: "idle" as const } }
							: n
					);
					setNodes(loaded);
					setEdges(scene.edges as Edge[]);
					setName(scene.name);
					if (scene.viewport) {
						viewportRef.current = scene.viewport;
						rf.setViewport(scene.viewport);
					}
				}
				setTimeout(() => {
					hydratedRef.current = true;
				}, 0);
			})
			.catch(() => {
				hydratedRef.current = true;
			});
		return () => {
			cancelled = true;
		};
	}, [docId, rf]);

	// ── Autosave (debounced) ─────────────────────────────────────────────────
	const scheduleSave = useCallback(() => {
		if (!hydratedRef.current) {
			return;
		}
		if (saveTimer.current) {
			clearTimeout(saveTimer.current);
		}
		saveTimer.current = setTimeout(() => {
			void saveScene(docId, {
				name: nameRef.current,
				nodes: nodesRef.current,
				edges: edgesRef.current,
				viewport: viewportRef.current,
			}).catch(() => {
				// Transient save failure — the next edit reschedules.
			});
		}, 800);
	}, [docId]);

	// ── Runtime injected into node components ─────────────────────────────────
	const updateNodeData = useCallback(
		(id: string, partial: Partial<CanvasNodeData>) => {
			setNodes((prev) =>
				prev.map((n) =>
					n.id === id ? { ...n, data: { ...n.data, ...partial } } : n
				)
			);
			scheduleSave();
		},
		[scheduleSave]
	);

	const deleteNode = useCallback(
		(id: string) => {
			setNodes((prev) => prev.filter((n) => n.id !== id));
			setEdges((prev) =>
				prev.filter((e) => e.source !== id && e.target !== id)
			);
			scheduleSave();
		},
		[scheduleSave]
	);

	const runNode = useCallback(
		async (id: string) => {
			const node = nodesRef.current.find((n) => n.id === id);
			if (!node) {
				return;
			}
			const { kind } = node.data;
			if (kind === "note" || kind === "upload") {
				return;
			}
			updateNodeData(id, { status: "running", error: undefined });
			try {
				const incomers = getIncomers(node, nodesRef.current, edgesRef.current);
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
					updateNodeData(id, {
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
					updateNodeData(id, {
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
					});
					if (!reply) {
						throw new Error("No reply returned");
					}
					updateNodeData(id, { status: "done", text: reply });
				} else if (kind === "tts") {
					if (!prompt.trim()) {
						throw new Error("Nothing to speak");
					}
					const url = await speak({
						text: prompt,
						engine: node.data.engine,
						voice: node.data.voice,
					});
					updateNodeData(id, {
						status: "done",
						result: url,
						mediaType: "audio",
					});
				} else if (kind === "stt") {
					const audioUrl =
						node.data.mediaType === "audio" && node.data.result
							? node.data.result
							: incomers.find(
									(u) =>
										(u.data as CanvasNodeData).mediaType === "audio" &&
										(u.data as CanvasNodeData).result
								)?.data.result;
					if (!audioUrl) {
						throw new Error("No audio to transcribe");
					}
					const text = await transcribe(audioUrl);
					if (!text) {
						throw new Error("No speech detected");
					}
					updateNodeData(id, { status: "done", text });
				}
			} catch (e) {
				updateNodeData(id, {
					status: "error",
					error: e instanceof Error ? e.message : "Generation failed",
				});
			}
		},
		[updateNodeData]
	);

	const runtime = useMemo(
		() => ({ runNode, updateNodeData, deleteNode }),
		[runNode, updateNodeData, deleteNode]
	);

	// ── React Flow change handlers ────────────────────────────────────────────
	const onNodesChange = useCallback(
		(changes: NodeChange[]) => {
			setNodes((prev) => applyNodeChanges(changes, prev) as CanvasNode[]);
			scheduleSave();
		},
		[scheduleSave]
	);

	const onEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			setEdges((prev) => applyEdgeChanges(changes, prev));
			scheduleSave();
		},
		[scheduleSave]
	);

	const onConnect = useCallback(
		(conn: Connection) => {
			setEdges((prev) => addEdge({ ...conn, ...DEFAULT_EDGE_OPTIONS }, prev));
			scheduleSave();
		},
		[scheduleSave]
	);

	const onMoveEnd = useCallback(
		(_: unknown, viewport: Viewport) => {
			viewportRef.current = viewport;
			scheduleSave();
		},
		[scheduleSave]
	);

	const viewportCenter = useCallback(() => {
		const rect = wrapperRef.current?.getBoundingClientRect();
		return rect
			? rf.screenToFlowPosition({
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2,
				})
			: { x: 0, y: 0 };
	}, [rf]);

	const addNode = useCallback(
		(kind: CanvasNodeKind) => {
			const center = viewportCenter();
			const node: CanvasNode = {
				id: `n-${Date.now()}`,
				type: kind,
				position: {
					x: center.x - 144 + (Math.random() - 0.5) * 40,
					y: center.y - 80 + (Math.random() - 0.5) * 40,
				},
				data: seedData(kind),
			};
			setNodes((prev) => [...prev, node]);
			scheduleSave();
		},
		[viewportCenter, scheduleSave]
	);

	// Insert an AssetPicker selection (icon/logo SVG or GIF) as a done "upload" node
	// — the same slot user file-uploads land in.
	const addAssetNode = useCallback(
		(selection: AssetSelection) => {
			const center = viewportCenter();
			const result =
				selection.kind === "svg" ? svgDataUrl(selection.svg) : selection.url;
			const node: CanvasNode = {
				id: `n-${Date.now()}`,
				type: "upload",
				position: {
					x: center.x - 144 + (Math.random() - 0.5) * 40,
					y: center.y - 80 + (Math.random() - 0.5) * 40,
				},
				data: {
					kind: "upload",
					status: "done",
					result,
					mediaType: "image",
				},
			};
			setNodes((prev) => [...prev, node]);
			scheduleSave();
		},
		[viewportCenter, scheduleSave]
	);

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
			setNodes((prev) => [...prev, ...newNodes]);
			scheduleSave();
		},
		[scheduleSave]
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

	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes("Files")) {
			return;
		}
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
		setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) {
			setIsDragOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
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

	const commitName = useCallback(() => {
		const trimmed = name.trim() || "Untitled canvas";
		setName(trimmed);
		scheduleSave();
	}, [name, scheduleSave]);

	return (
		<CanvasRegistryContext.Provider value={registry}>
			<div
				className="cv-root"
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
				ref={wrapperRef}
			>
				<div className="cv-topbar">
					<span className="cv-brand">Canvas</span>
					<span className="cv-sep">/</span>
					<input
						className="cv-name"
						onBlur={commitName}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.currentTarget.blur();
							}
						}}
						value={name}
					/>
				</div>

				<CanvasRuntimeContext.Provider value={runtime}>
					<ReactFlow
						defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
						edges={edges}
						fitView={nodes.length > 0}
						fitViewOptions={FIT_VIEW_OPTIONS}
						nodes={nodes}
						nodeTypes={CANVAS_NODE_TYPES}
						onConnect={onConnect}
						onEdgesChange={onEdgesChange}
						onMoveEnd={onMoveEnd}
						onNodesChange={onNodesChange}
						proOptions={PRO_OPTIONS}
					>
						<Background gap={20} size={1} />
						<Controls />
					</ReactFlow>
				</CanvasRuntimeContext.Provider>

				{nodes.length === 0 ? (
					<div className="cv-empty">
						<p className="cv-empty-title">Add a node to start creating</p>
						<p className="cv-empty-sub">
							Chat · Image · Video · Speech · Transcribe · Upload · Note — wire
							them into a pipeline
						</p>
						<p className="cv-empty-hint">
							Paste with Ctrl+V or drag files onto the canvas
						</p>
					</div>
				) : null}

				{isDragOver ? (
					<div className="cv-dropoverlay">
						<p className="cv-dropoverlay-title">Drop to add to canvas</p>
						<p className="cv-dropoverlay-sub">Images, audio, and video files</p>
					</div>
				) : null}

				<div className="cv-toolbar nodrag">
					{TOOLS.map((tool) => (
						<button
							className="cv-tool"
							key={tool.kind}
							onClick={() => addNode(tool.kind)}
							title={tool.label}
							type="button"
						>
							{tool.label}
						</button>
					))}
					<span className="cv-toolbar-sep" />
					<button
						className="cv-tool"
						onClick={() => setAssetOpen(true)}
						title="Icons, logos & GIFs"
						type="button"
					>
						Assets
					</button>
				</div>

				<AssetPicker
					onClose={() => setAssetOpen(false)}
					onSelect={addAssetNode}
					open={assetOpen}
				/>
			</div>
		</CanvasRegistryContext.Provider>
	);
}

export function Canvas() {
	const ctx = window.ryu?.context;
	if (!ctx?.docId) {
		return (
			<div className="cv-fallback">
				<p>Open a canvas from the Canvas sidebar to start.</p>
			</div>
		);
	}
	return (
		<ReactFlowProvider>
			<CanvasBoard docId={ctx.docId} />
		</ReactFlowProvider>
	);
}
