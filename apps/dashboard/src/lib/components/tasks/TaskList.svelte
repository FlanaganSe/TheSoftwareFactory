<script lang="ts">
  import type { TaskState } from "@software-factory/core";
  import type { TaskSummary } from "$lib/api/client";
  import TaskCard from "./TaskCard.svelte";

  interface Props {
    tasks: TaskSummary[];
  }

  let { tasks }: Props = $props();

  type FilterKey = "all" | "review" | "active" | "completed" | "failed";

  let activeFilter: FilterKey = $state("all");

  const FILTER_STATES: Record<FilterKey, TaskState[] | null> = {
    all: null,
    review: ["evidence_ready", "changes_requested"],
    active: ["created", "assigned", "in_progress", "paused", "needs_clarification"],
    completed: ["approved", "pr_created", "external_checks_pending", "merge_ready", "merged"],
    failed: ["failed", "cancelled", "external_blocked"],
  };

  const filteredTasks = $derived(
    activeFilter === "all"
      ? tasks
      : tasks.filter((t) => FILTER_STATES[activeFilter]?.includes(t.status as TaskState)),
  );

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "review", label: "Awaiting Review" },
    { key: "active", label: "In Progress" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed" },
  ];
</script>

<div class="space-y-4">
  <div class="flex gap-1 border-b border-border pb-2">
    {#each filters as filter}
      <button
        onclick={() => { activeFilter = filter.key; }}
        class="px-3 py-1.5 text-xs rounded-md transition-colors
          {activeFilter === filter.key
            ? 'bg-accent/10 text-accent font-medium'
            : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'}"
      >
        {filter.label}
      </button>
    {/each}
  </div>

  {#if filteredTasks.length === 0}
    <div class="py-12 text-center">
      <p class="text-text-muted text-sm">No tasks found.</p>
      <p class="text-text-muted text-xs mt-1">Submit one via CLI: <code class="font-mono text-accent">factory submit</code></p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each filteredTasks as task (task.taskId)}
        <TaskCard
          taskId={task.taskId}
          objective={task.objective ?? task.workflowId}
          state={(task.status as TaskState) ?? "created"}
          repoOwner={task.repoOwner}
          repoName={task.repoName}
          createdAt={task.startTime}
        />
      {/each}
    </div>
  {/if}
</div>
