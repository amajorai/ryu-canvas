// The Chat (text) node card for the Canvas app; registered in nodes.tsx.

import {
	ModelAgentPicker,
	type RyuPickerSelection,
} from "@ryu/blocks/composer/runtime-picker";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { modelsForAgent } from "./models.ts";
import { CardShell, PromptArea, RunButton, TextResult } from "./nodes-card.tsx";
import {
	type CanvasNodeData,
	useCanvasRegistry,
	useCanvasRuntime,
} from "./types.ts";

export function ChatNode({
	id,
	data,
	selected,
}: {
	id: string;
	data: CanvasNodeData;
	selected: boolean;
}) {
	const runtime = useCanvasRuntime();
	const { agents, discoverModels, engineModels, runtimeCatalog } =
		useCanvasRegistry();
	// Each agent's OWN models (Core catalog → offline fallback → bound model → Auto),
	// exactly like the desktop composer's modelsForAgent.
	const activeAgentId = data.agentId ?? agents[0]?.id ?? null;
	const modelOptions = modelsForAgent(activeAgentId, agents, engineModels);
	const runtimeSelection: RyuPickerSelection | undefined = data.agentId
		? { agentId: data.agentId, kind: "agent" }
		: data.model && data.provider
			? { kind: "model", modelId: data.model, providerId: data.provider }
			: undefined;
	return (
		<div>
			<CardShell data={data} id={id} selected={selected}>
				{data.status === "running" ? (
					<div className="cv-preview cv-preview-sm">
						<span className="cv-spinner" />
					</div>
				) : null}
				{data.status === "error" ? (
					<div className="cv-inline-error">
						{data.error ?? "Generation failed"}
					</div>
				) : null}
				{data.status === "done" && data.text ? (
					<TextResult text={data.text} />
				) : null}
				<PromptArea data={data} id={id} placeholder="Message the agent…" />
				<div className="cv-footer nodrag">
					{runtimeCatalog ? (
						<div className="cv-runtime-picker">
							<ModelAgentPicker
								ariaLabel="Choose the Ryu chat runtime"
								catalog={runtimeCatalog}
								onDiscoverModels={discoverModels}
								onSelectionChange={(selection) => {
									if (selection.kind === "agent") {
										runtime.updateNodeData(id, {
											agentId: selection.agentId,
											agentLabel:
												runtimeCatalog.agents.find(
													(agent) => agent.id === selection.agentId
												)?.name ?? selection.agentId,
											model: undefined,
											modelLabel: undefined,
											provider: undefined,
										});
										return;
									}
									runtime.updateNodeData(id, {
										agentId: undefined,
										agentLabel: undefined,
										model: selection.modelId,
										modelLabel: selection.modelId,
										provider: selection.providerId,
									});
								}}
								placeholder="Choose model or agent"
								value={runtimeSelection}
							/>
						</div>
					) : (
						<>
							<NativeSelect
								className="min-w-0 flex-1"
								onChange={(e) => {
									const a = agents.find((x) => x.id === e.target.value);
									runtime.updateNodeData(id, {
										agentId: e.target.value,
										agentLabel: a?.name ?? e.target.value,
										model: undefined,
										modelLabel: undefined,
									});
								}}
								value={activeAgentId ?? ""}
							>
								{agents.length === 0 ? (
									<NativeSelectOption value="">Default</NativeSelectOption>
								) : null}
								{agents.map((a) => (
									<NativeSelectOption key={a.id} value={a.id}>
										{a.name}
									</NativeSelectOption>
								))}
							</NativeSelect>
							{modelOptions.length > 0 ? (
								<NativeSelect
									className="min-w-0 flex-1"
									onChange={(e) => {
										const m = modelOptions.find((x) => x.id === e.target.value);
										runtime.updateNodeData(id, {
											model: e.target.value || undefined,
											modelLabel: m?.name,
										});
									}}
									value={data.model ?? modelOptions[0]?.id ?? ""}
								>
									{modelOptions.map((m) => (
										<NativeSelectOption key={m.id} value={m.id}>
											{m.name}
										</NativeSelectOption>
									))}
								</NativeSelect>
							) : null}
						</>
					)}
					<RunButton data={data} id={id} />
				</div>
			</CardShell>
		</div>
	);
}
