<script lang="ts">
  import type { DiffAnnotationResponse } from "$lib/api/client";
  import { RISK_COLORS } from "$lib/utils/colors";

  interface Props {
    annotations: DiffAnnotationResponse[];
  }

  let { annotations }: Props = $props();

  const counts = $derived({
    low: annotations.filter((a) => a.riskLevel === "low").length,
    medium: annotations.filter((a) => a.riskLevel === "medium").length,
    high: annotations.filter((a) => a.riskLevel === "high").length,
  });
</script>

<div class="space-y-2">
  <h3 class="text-sm font-medium text-text-primary">Risk Summary</h3>
  <div class="flex gap-4">
    {#each Object.entries(counts) as [level, count]}
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full
          {level === 'low' ? 'bg-green-400' : ''}
          {level === 'medium' ? 'bg-yellow-400' : ''}
          {level === 'high' ? 'bg-red-400' : ''}"></span>
        <span class="text-xs {RISK_COLORS[level]}">{count} {level}</span>
      </div>
    {/each}
  </div>
</div>
