<script lang="ts">
  import { page } from "$app/state";

  const repoId = $derived(page.params.id ?? "");
</script>

<div class="max-w-4xl">
  <div class="flex items-center gap-3 mb-6">
    <a href="/repos" class="text-text-muted hover:text-text-secondary text-xs">&larr; Repositories</a>
    <h2 class="text-lg font-semibold text-text-primary">Repo Readiness</h2>
  </div>

  <div class="space-y-6">
    <div class="p-4 bg-surface-1 border border-border rounded-lg">
      <h3 class="text-sm font-medium text-text-primary mb-2">Repository</h3>
      <p class="text-xs text-text-muted font-mono">{repoId}</p>
      <p class="text-xs text-text-muted mt-2">
        Repository readiness data is populated via CLI scans. This screen displays the
        CapabilitySnapshot from the most recent scan.
      </p>
    </div>

    <div class="p-4 bg-surface-1 border border-border rounded-lg">
      <h3 class="text-sm font-medium text-text-primary mb-2">Branch Protection</h3>
      <p class="text-xs text-text-muted">Scan the repository to populate protection data.</p>
    </div>

    <div class="p-4 bg-surface-1 border border-border rounded-lg">
      <h3 class="text-sm font-medium text-text-primary mb-2">Rulesets</h3>
      <p class="text-xs text-text-muted">Scan the repository to populate ruleset data.</p>
    </div>
  </div>
</div>
