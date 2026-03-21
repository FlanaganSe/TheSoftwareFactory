import { WORKFLOW_PHASES } from "@software-factory/core";
import type { WorkflowPhase } from "@software-factory/core";

export interface AgentStep {
  readonly stepNumber: number;
  readonly toolCalls: readonly { readonly toolName: string; readonly summary?: string }[];
  readonly costCents: number;
  readonly totalCostCents: number;
  readonly filesModified: readonly string[];
  readonly finishReason: string;
  readonly timestamp: string;
}

export interface TaskProgress {
  readonly currentPhase: WorkflowPhase | null;
  readonly completedPhases: readonly WorkflowPhase[];
  readonly state: string;
  readonly costCents: number;
  readonly lastUpdated: string;
  readonly agentSteps: readonly AgentStep[];
}

const MAX_STEPS = 100;

let progressMap = $state(new Map<string, TaskProgress>());

function deriveCompleted(phase: WorkflowPhase): readonly WorkflowPhase[] {
  const idx = WORKFLOW_PHASES.indexOf(phase);
  if (idx <= 0) return [];
  return WORKFLOW_PHASES.slice(0, idx);
}

export function handleTaskEvent(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const event = raw as Record<string, unknown>;
  const taskId = event.taskId as string | undefined;
  if (!taskId) return;

  const type = event.type as string;
  const existing = progressMap.get(taskId);

  if (type === "phase_started" || type === "phase_completed" || type === "task_state_changed") {
    const phase = event.phase as WorkflowPhase | undefined;
    const completed =
      type === "phase_completed" && phase
        ? [...(existing?.completedPhases ?? []), phase]
        : phase
          ? deriveCompleted(phase)
          : (existing?.completedPhases ?? []);

    const next: TaskProgress = {
      currentPhase: (phase as WorkflowPhase) ?? existing?.currentPhase ?? null,
      completedPhases: completed as WorkflowPhase[],
      state: (event.state as string) ?? existing?.state ?? "",
      costCents: (event.costCents as number) ?? existing?.costCents ?? 0,
      lastUpdated: (event.timestamp as string) ?? new Date().toISOString(),
      agentSteps: existing?.agentSteps ?? [],
    };
    progressMap.set(taskId, next);
    progressMap = new Map(progressMap);
  } else if (type === "agent_step") {
    const step: AgentStep = {
      stepNumber: (event.stepNumber as number) ?? 0,
      toolCalls: (event.toolCalls as AgentStep["toolCalls"]) ?? [],
      costCents: (event.costCents as number) ?? 0,
      totalCostCents: (event.totalCostCents as number) ?? 0,
      filesModified: (event.filesModified as string[]) ?? [],
      finishReason: (event.finishReason as string) ?? "",
      timestamp: (event.timestamp as string) ?? new Date().toISOString(),
    };

    const steps = [...(existing?.agentSteps ?? []), step].slice(-MAX_STEPS);

    const next: TaskProgress = {
      currentPhase: existing?.currentPhase ?? null,
      completedPhases: existing?.completedPhases ?? [],
      state: existing?.state ?? "",
      costCents: step.totalCostCents,
      lastUpdated: step.timestamp,
      agentSteps: steps,
    };
    progressMap.set(taskId, next);
    progressMap = new Map(progressMap);
  }
}

export function getTaskProgress(taskId: string): TaskProgress | undefined {
  return progressMap.get(taskId);
}

export function clearTaskProgress(taskId: string): void {
  progressMap.delete(taskId);
  progressMap = new Map(progressMap);
}
