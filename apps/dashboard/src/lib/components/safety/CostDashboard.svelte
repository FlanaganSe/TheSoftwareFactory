<script lang="ts">
  import type { DailyCostResponse } from "$lib/api/client";
  import { formatCost } from "$lib/utils/format";

  interface Props {
    cost: DailyCostResponse;
  }

  let { cost }: Props = $props();

  const usagePercent = $derived(
    cost.budgetCents > 0 ? Math.min((cost.totalCents / cost.budgetCents) * 100, 100) : 0,
  );

  const isOverBudget = $derived(cost.totalCents > cost.budgetCents && cost.budgetCents > 0);
  const taskEntries = $derived(Object.entries(cost.tasks ?? {}));
</script>

<div class="space-y-3">
  <h3 class="text-sm font-medium text-text-primary">Daily Cost</h3>

  <div class="flex items-baseline gap-2">
    <span class="text-2xl font-semibold {isOverBudget ? 'text-red-400' : 'text-text-primary'}">
      {formatCost(cost.totalCents)}
    </span>
    <span class="text-xs text-text-muted">/ {formatCost(cost.budgetCents)} budget</span>
  </div>

  <!-- Progress bar -->
  <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
    <div
      class="h-full rounded-full transition-all {isOverBudget ? 'bg-red-500' : usagePercent > 80 ? 'bg-yellow-500' : 'bg-accent'}"
      style="width: {usagePercent}%"
    ></div>
  </div>

  {#if taskEntries.length > 0}
    <div class="text-xs space-y-1">
      <p class="text-text-muted font-medium">Per-task breakdown:</p>
      {#each taskEntries as [taskId, cents]}
        <div class="flex justify-between font-mono">
          <span class="text-text-secondary truncate">{taskId.slice(0, 8)}</span>
          <span class="text-text-muted">{formatCost(cents)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
