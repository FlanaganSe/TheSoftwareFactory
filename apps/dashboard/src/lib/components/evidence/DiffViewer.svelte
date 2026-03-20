<script lang="ts">
  import type { DiffAnnotationResponse } from "$lib/api/client";
  import { RISK_COLORS } from "$lib/utils/colors";

  interface Props {
    annotations: DiffAnnotationResponse[];
  }

  let { annotations }: Props = $props();
</script>

<div class="space-y-3">
  <h3 class="text-sm font-medium text-text-primary">Annotated Diff</h3>
  {#if annotations.length === 0}
    <p class="text-xs text-text-muted">No diff annotations.</p>
  {:else}
    {#each annotations as ann}
      <div class="border border-border rounded-md overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1.5 bg-surface-2 text-xs">
          <span class="font-mono text-text-secondary">{ann.file}</span>
          <span class="px-1.5 py-0.5 rounded {RISK_COLORS[ann.riskLevel]}">
            {ann.riskLevel}
          </span>
        </div>
        <div class="px-3 py-2 text-xs font-mono bg-surface-1">
          <p class="text-text-secondary">{ann.annotation}</p>
          {#if ann.affectedConsumers.length > 0}
            <p class="text-text-muted mt-1">Affects: {ann.affectedConsumers.join(", ")}</p>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
