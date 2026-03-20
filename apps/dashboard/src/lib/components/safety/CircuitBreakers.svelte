<script lang="ts">
  import type { CircuitStatus } from "$lib/api/client";
  import { CIRCUIT_COLORS } from "$lib/utils/colors";
  import { formatRelativeTime } from "$lib/utils/format";

  interface Props {
    circuits: CircuitStatus[];
    onTrip: (service: string) => void;
    onReset: (service: string) => void;
  }

  let { circuits, onTrip, onReset }: Props = $props();
</script>

<div class="space-y-3">
  <h3 class="text-sm font-medium text-text-primary">Circuit Breakers</h3>
  {#if circuits.length === 0}
    <p class="text-xs text-text-muted">No circuit breakers configured.</p>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each circuits as circuit}
        <div class="p-3 bg-surface-1 border border-border rounded-lg">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-text-primary">{circuit.service}</span>
            <span class="text-xs font-medium {CIRCUIT_COLORS[circuit.state] ?? 'text-text-muted'}">
              {circuit.state}
            </span>
          </div>
          <div class="text-xs text-text-muted space-y-0.5">
            <p>Failures: {circuit.failureCount}</p>
            {#if circuit.lastFailure}
              <p>Last failure: {formatRelativeTime(circuit.lastFailure)}</p>
            {/if}
          </div>
          <div class="flex gap-2 mt-2">
            {#if circuit.state === "closed"}
              <button
                onclick={() => onTrip(circuit.service)}
                class="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition-colors"
              >
                Trip
              </button>
            {:else}
              <button
                onclick={() => onReset(circuit.service)}
                class="px-2 py-1 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded transition-colors"
              >
                Reset
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
