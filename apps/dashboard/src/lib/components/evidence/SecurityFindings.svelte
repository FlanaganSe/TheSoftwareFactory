<script lang="ts">
  import type { SecurityScanResponse } from "$lib/api/client";
  import { SEVERITY_COLORS } from "$lib/utils/colors";

  interface Props {
    results: SecurityScanResponse;
  }

  let { results }: Props = $props();
</script>

<div class="space-y-2">
  <h3 class="text-sm font-medium text-text-primary">Security Findings</h3>
  <div class="flex gap-4 text-xs">
    <span class="text-text-muted">{results.totalFindings} total</span>
    {#if results.criticalCount > 0}
      <span class="text-red-500 font-bold">{results.criticalCount} critical</span>
    {/if}
    {#if results.highCount > 0}
      <span class="text-red-400">{results.highCount} high</span>
    {/if}
  </div>

  {#if results.vulnerabilities.length > 0}
    <div class="space-y-1.5">
      {#each results.vulnerabilities as vuln}
        <div class="flex items-start gap-2 px-3 py-2 bg-surface-2 rounded-md text-xs">
          <span class="shrink-0 {SEVERITY_COLORS[vuln.severity]}">{vuln.severity}</span>
          <div class="min-w-0">
            <p class="text-text-secondary">{vuln.description}</p>
            {#if vuln.file}
              <p class="text-text-muted font-mono mt-0.5">
                {vuln.file}{vuln.line ? `:${vuln.line}` : ""}
              </p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
