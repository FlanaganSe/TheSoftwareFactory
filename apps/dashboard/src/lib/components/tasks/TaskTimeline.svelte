<script lang="ts">
  import { WORKFLOW_PHASES } from "@software-factory/core";
  import type { WorkflowPhase } from "@software-factory/core";

  interface Props {
    currentPhase?: WorkflowPhase;
    completedPhases?: WorkflowPhase[];
  }

  let { currentPhase, completedPhases = [] }: Props = $props();

  const PHASE_LABELS: Record<WorkflowPhase, string> = {
    intake: "Intake",
    understand: "Understand",
    plan: "Plan",
    setup: "Setup",
    implement: "Implement",
    validate: "Validate",
    evidence: "Evidence",
    review: "Review",
    pr_creation: "PR",
    pr_tracking: "Track",
    learn: "Learn",
  };

  function phaseStatus(phase: WorkflowPhase): "completed" | "current" | "pending" {
    if (completedPhases.includes(phase)) return "completed";
    if (phase === currentPhase) return "current";
    return "pending";
  }
</script>

<div class="flex items-center gap-1 overflow-x-auto py-2">
  {#each WORKFLOW_PHASES as phase, i}
    {@const status = phaseStatus(phase)}
    <div class="flex items-center gap-1">
      <div class="flex flex-col items-center gap-1">
        <div
          class="w-3 h-3 rounded-full border-2 shrink-0
            {status === 'completed' ? 'bg-green-400 border-green-400' : ''}
            {status === 'current' ? 'bg-accent border-accent animate-pulse' : ''}
            {status === 'pending' ? 'bg-transparent border-text-muted' : ''}"
        ></div>
        <span class="text-[10px] whitespace-nowrap
          {status === 'completed' ? 'text-green-400' : ''}
          {status === 'current' ? 'text-accent font-medium' : ''}
          {status === 'pending' ? 'text-text-muted' : ''}">
          {PHASE_LABELS[phase]}
        </span>
      </div>
      {#if i < WORKFLOW_PHASES.length - 1}
        <div class="w-4 h-px mt-[-14px]
          {status === 'completed' ? 'bg-green-400' : 'bg-border'}"></div>
      {/if}
    </div>
  {/each}
</div>
