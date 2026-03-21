<script lang="ts">
  import type { AgentStep } from "$lib/stores/task-events.svelte";
  import { formatCost } from "$lib/utils/format";

  interface Props {
    steps: readonly AgentStep[];
  }

  let { steps }: Props = $props();

  const TOOL_COLORS: Record<string, string> = {
    file_write: "bg-blue-500/20 text-blue-400",
    file_edit: "bg-blue-500/20 text-blue-400",
    file_read: "bg-gray-500/20 text-gray-400",
    run_command: "bg-amber-500/20 text-amber-400",
    search_text: "bg-purple-500/20 text-purple-400",
    search_codebase: "bg-purple-500/20 text-purple-400",
    list_files: "bg-gray-500/20 text-gray-400",
  };

  function toolColor(name: string): string {
    return TOOL_COLORS[name] ?? "bg-gray-500/20 text-gray-400";
  }

  function relativeTime(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  // Show most recent steps first
  const reversed = $derived([...steps].reverse());
</script>

<div class="space-y-2 max-h-80 overflow-y-auto">
  {#each reversed as step (step.stepNumber)}
    <div class="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0">
      <span class="text-[10px] text-text-muted w-6 shrink-0 text-right pt-0.5">
        #{step.stepNumber + 1}
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap gap-1">
          {#each step.toolCalls as tc}
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono {toolColor(tc.toolName)}">
              {tc.toolName}
              {#if tc.summary && tc.summary !== tc.toolName}
                <span class="opacity-70 truncate max-w-[150px]" title={tc.summary}>
                  {tc.summary}
                </span>
              {/if}
            </span>
          {/each}
        </div>
        {#if step.filesModified.length > 0}
          <div class="mt-0.5 text-[10px] text-text-muted truncate">
            {step.filesModified.join(", ")}
          </div>
        {/if}
      </div>
      <div class="shrink-0 text-right">
        <div class="text-[10px] text-text-muted">{relativeTime(step.timestamp)}</div>
        <div class="text-[10px] text-text-muted">{formatCost(step.costCents)}</div>
      </div>
    </div>
  {/each}
</div>
