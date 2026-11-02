// The Canvas board: a ComfyUI / ElevenLabs-Flows-style React Flow surface where
// each node generates image/video/text/speech (or holds an upload/note) and nodes
// wire into pipelines. Ported from the built-in desktop CanvasPage: the board now
// loads/saves the whole graph into ONE Space document via the window.ryu bridge
// (spaces:docs), and every node's Run goes through the governed media/agent bridge
// (media:generate / media:transcribe / hook:run-agent) instead of direct Core
// calls. The frame is CSP-locked (connect-src 'none'), so all egress is the host
// port; media results arrive as data: URLs the frame can render inline.

import {
	openRealtimeResource,
	type RealtimeResourceChannel,
} from "@ryu/app-host/realtime";
import { Button, Input } from "@ryu/blocks/companion/controls";
import { useReactFlowAriaLabels } from "@ryu/blocks/desktop/react-flow-labels.ts";
import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type Edge,
	type EdgeChange,
	MarkerType,
	type NodeChange,
	type OnMoveEnd,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetPicker } from "./AssetPicker.tsx";
import {
	type AssetSelection,
	loadRegistry,
	loadScene,
	saveScene,
	svgDataUrl,
} from "./bridge.ts";
import {
	type CanvasNode,
	createCanvasNodeId,
	positionForNode,
	seedData,
} from "./canvas-board-model.ts";
import { useCanvasImport } from "./canvas-import.ts";
import { runCanvasNode } from "./canvas-run.ts";
import { CANVAS_NODE_TYPES } from "./nodes.tsx";
import { canvasEdgeSchema, canvasNodeSchema } from "./schemas.ts";
import {
	type CanvasNodeData,
	type CanvasNodeKind,
	type CanvasRegistry,
	CanvasRegistryContext,
	CanvasRuntimeContext,
} from "./types.ts";

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
	runtimeCatalog: null,
	ttsEngines: [],
};

const TOOLS: { kind: CanvasNodeKind; label: string }[] = [
	{ kind: "text", label: "Chat" },
	{ kind: "image", label: "Image" },
	{ kind: "video", label: "Video" },
	{ kind: "tts", label: "Speech" },
	{ kind: "stt", label: "Transcribe" },
	{ kind: "upload", label: "Upload" },
	{ kind: "note", label: "Note" },
];

function CanvasBoard({ docId }: { docId: string }) {
	const rf = useReactFlow();
	const ariaLabels = useReactFlowAriaLabels();
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
	const realtimeRef = useRef<RealtimeResourceChannel | null>(null);
	const applyScene = useCallback(
		(scene: Awaited<ReturnType<typeof loadScene>>) => {
			if (!scene) {
				return;
			}
			const loaded = scene.nodes
				.flatMap((value) => {
					const parsed = canvasNodeSchema.safeParse(value);
					return parsed.success ? [parsed.data] : [];
				})
				.map((node) =>
					node.data?.status === "running"
						? { ...node, data: { ...node.data, status: "idle" as const } }
						: node
				);
			setNodes(loaded);
			setEdges(
				scene.edges.flatMap((value) => {
					const parsed = canvasEdgeSchema.safeParse(value);
					return parsed.success ? [parsed.data] : [];
				})
			);
			setName(scene.name);
			if (scene.viewport) {
				viewportRef.current = scene.viewport;
				rf.setViewport(scene.viewport);
			}
		},
		[rf]
	);

	// ── Load ────────────────────────────────────────────────────────────────
	useEffect(() => {
		hydratedRef.current = false;
		let cancelled = false;
		loadScene(docId)
			.then((scene) => {
				if (cancelled) {
					return;
				}
				applyScene(scene);
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
	}, [applyScene, docId]);

	useEffect(() => {
		let cancelled = false;
		let channel: RealtimeResourceChannel | null = null;
		openRealtimeResource({
			onChanged: async () => {
				if (saveTimer.current) {
					// Keep the local pending edit. Its later save is the deliberate LWW
					// result; loading now would erase unsaved work in this frame.
					return;
				}
				const scene = await loadScene(docId);
				if (!cancelled) {
					applyScene(scene);
				}
			},
			roomId: docId,
		})
			.then((connected) => {
				if (cancelled) {
					void connected.close();
					return;
				}
				channel = connected;
				realtimeRef.current = connected;
				void connected.publishPresence({ surface: "canvas" });
			})
			.catch(() => {
				// Offline editing keeps using the governed Space document API.
			});
		return () => {
			cancelled = true;
			realtimeRef.current = null;
			if (channel) {
				void channel.close();
			}
		};
	}, [applyScene, docId]);

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
			})
				.then(() => realtimeRef.current?.publishChanged())
				.catch(() => {
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
			await runCanvasNode(node, nodesRef.current, edgesRef.current, (partial) =>
				updateNodeData(id, partial)
			);
		},
		[updateNodeData]
	);

	const runtime = useMemo(
		() => ({ runNode, updateNodeData, deleteNode }),
		[runNode, updateNodeData, deleteNode]
	);

	// ── React Flow change handlers ────────────────────────────────────────────
	const onNodesChange = useCallback(
		(changes: NodeChange<CanvasNode>[]) => {
			setNodes((prev) => applyNodeChanges(changes, prev));
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
		(_: Parameters<OnMoveEnd>[0], viewport: Viewport) => {
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
			const index = nodesRef.current.length;
			const node: CanvasNode = {
				id: createCanvasNodeId(),
				type: kind,
				position: positionForNode(center, index),
				data: seedData(kind),
			};
			setNodes((prev) => [...prev, node]);
			scheduleSave();
		},
		[viewportCenter, scheduleSave]
	);

	// Insert an AssetPicker selection (icon/logo SVG, catalog image, or GIF) as a
	// done "upload" node — the same slot user file-uploads land in.
	const addAssetNode = useCallback(
		(selection: AssetSelection) => {
			const center = viewportCenter();
			const index = nodesRef.current.length;
			const result =
				selection.kind === "svg"
					? svgDataUrl(selection.svg)
					: selection.kind === "image"
						? selection.dataUrl
						: selection.url;
			const node: CanvasNode = {
				id: createCanvasNodeId(),
				type: "upload",
				position: positionForNode(center, index),
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

	const addImportedNodes = useCallback(
		(imported: CanvasNode[]) => {
			setNodes((prev) => [...prev, ...imported]);
			scheduleSave();
		},
		[scheduleSave]
	);
	const { handleDragLeave, handleDragOver, handleDrop, isDragOver } =
		useCanvasImport({ addNodes: addImportedNodes, viewportCenter });

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
					<Input
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
						ariaLabelConfig={ariaLabels}
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
						<Button
							className="cv-tool"
							key={tool.kind}
							onClick={() => addNode(tool.kind)}
							title={tool.label}
							type="button"
						>
							{tool.label}
						</Button>
					))}
					<span className="cv-toolbar-sep" />
					<Button
						className="cv-tool"
						onClick={() => setAssetOpen(true)}
						title="Icons, logos & GIFs"
						type="button"
					>
						Assets
					</Button>
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
