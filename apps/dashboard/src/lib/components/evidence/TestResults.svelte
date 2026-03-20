<script lang="ts">
  import type { TestResultsResponse } from "$lib/api/client";

  interface Props {
    results: TestResultsResponse;
  }

  let { results }: Props = $props();
</script>

<div class="space-y-2">
  <h3 class="text-sm font-medium text-text-primary">Test Results</h3>
  <div class="flex gap-4 text-xs">
    <span class="text-green-400">{results.passed} passed</span>
    <span class="text-red-400">{results.failed} failed</span>
    <span class="text-text-muted">{results.skipped} skipped</span>
  </div>

  {#if results.details.length > 0}
    <div class="border border-border rounded-md overflow-hidden">
      <table class="w-full text-xs">
        <thead>
          <tr class="bg-surface-2 text-text-muted">
            <th class="text-left px-3 py-1.5">Test</th>
            <th class="text-left px-3 py-1.5 w-20">Status</th>
            <th class="text-right px-3 py-1.5 w-20">Time</th>
          </tr>
        </thead>
        <tbody>
          {#each results.details as detail}
            <tr class="border-t border-border">
              <td class="px-3 py-1.5 font-mono text-text-secondary">{detail.name}</td>
              <td class="px-3 py-1.5">
                <span class="{detail.status === 'passed' ? 'text-green-400' : detail.status === 'failed' ? 'text-red-400' : 'text-text-muted'}">
                  {detail.status}
                </span>
              </td>
              <td class="px-3 py-1.5 text-right text-text-muted">
                {detail.durationMs ? `${detail.durationMs}ms` : "-"}
              </td>
            </tr>
            {#if detail.errorMessage}
              <tr class="border-t border-border/50">
                <td colspan="3" class="px-3 py-1.5 text-red-400/80 font-mono bg-red-500/5">
                  {detail.errorMessage}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
