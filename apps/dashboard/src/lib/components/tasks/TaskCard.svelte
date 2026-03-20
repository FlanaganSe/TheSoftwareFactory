<script lang="ts">
  import type { TaskState } from "@software-factory/core";
  import { formatRelativeTime, truncate, formatCost } from "$lib/utils/format";
  import TaskBadge from "./TaskBadge.svelte";

  interface Props {
    taskId: string;
    objective: string;
    state: TaskState;
    repoOwner?: string;
    repoName?: string;
    createdAt?: string;
    costCents?: number;
    blastRadiusFiles?: number;
  }

  let {
    taskId,
    objective,
    state,
    repoOwner,
    repoName,
    createdAt,
    costCents,
    blastRadiusFiles,
  }: Props = $props();
</script>

<a
  href="/tasks/{taskId}"
  class="block p-4 bg-surface-1 border border-border rounded-lg hover:border-accent/40 hover:bg-surface-2 transition-all group"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <p class="text-sm text-text-primary font-medium group-hover:text-accent transition-colors">
        {truncate(objective, 100)}
      </p>
      {#if repoOwner && repoName}
        <p class="text-xs text-text-muted mt-1 font-mono">{repoOwner}/{repoName}</p>
      {/if}
    </div>
    <TaskBadge {state} />
  </div>

  <div class="flex items-center gap-4 mt-3 text-xs text-text-muted">
    {#if createdAt}
      <span>{formatRelativeTime(createdAt)}</span>
    {/if}
    {#if costCents !== undefined}
      <span>{formatCost(costCents)}</span>
    {/if}
    {#if blastRadiusFiles !== undefined}
      <span>{blastRadiusFiles} files</span>
    {/if}
  </div>
</a>
