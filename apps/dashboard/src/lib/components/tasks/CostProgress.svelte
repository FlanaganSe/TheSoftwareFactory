<script lang="ts">
  import { formatCost } from "$lib/utils/format";

  interface Props {
    costCents: number;
    budgetCents: number;
  }

  let { costCents, budgetCents }: Props = $props();

  const pct = $derived(Math.min(100, (costCents / budgetCents) * 100));
  const color = $derived(pct < 50 ? "bg-green-400" : pct < 80 ? "bg-yellow-400" : "bg-red-400");
</script>

<div class="flex items-center gap-3">
  <div class="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
    <div
      class="h-full rounded-full transition-all duration-500 {color}"
      style="width: {pct}%"
    ></div>
  </div>
  <span class="text-xs text-text-muted whitespace-nowrap">
    {formatCost(costCents)} / {formatCost(budgetCents)}
  </span>
</div>
