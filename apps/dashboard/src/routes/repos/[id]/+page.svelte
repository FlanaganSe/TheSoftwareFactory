<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { createApiClient } from "$lib/api/client";
  import type { RepoDetailResponse } from "$lib/api/client";
  import { getApiKey, getApiUrl } from "$lib/stores/auth";

  const repoId = $derived(page.params.id ?? "");

  let data: RepoDetailResponse | null = $state(null);
  let loading = $state(true);
  let error = $state("");

  onMount(async () => {
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      data = await client.getRepo(repoId);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load repository";
    } finally {
      loading = false;
    }
  });

  function snapshotField(key: string): unknown {
    return data?.latestSnapshot?.[key] ?? null;
  }
</script>

<div class="max-w-4xl">
  <div class="flex items-center gap-3 mb-6">
    <a href="/repos" class="text-text-muted hover:text-text-secondary text-xs">&larr; Repositories</a>
    <h2 class="text-lg font-semibold text-text-primary">Repo Readiness</h2>
  </div>

  {#if loading}
    <div class="py-12 text-center">
      <p class="text-text-muted text-sm">Loading...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <p class="text-red-400 text-sm">{error}</p>
    </div>
  {:else if data}
    {@const repo = data.repo}
    {@const snap = data.latestSnapshot}

    <div class="space-y-6">
      <!-- Repository Info -->
      <div class="p-4 bg-surface-1 border border-border rounded-lg">
        <h3 class="text-sm font-medium text-text-primary mb-3">Repository</h3>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div><span class="text-text-muted">Name:</span> <span class="font-mono">{repo.githubOwner}/{repo.githubRepo}</span></div>
          <div><span class="text-text-muted">Class:</span> {repo.repoClass}</div>
          <div><span class="text-text-muted">Branch:</span> {repo.defaultBranch}</div>
          <div><span class="text-text-muted">Autonomy:</span> {repo.autonomyLevel}</div>
          <div><span class="text-text-muted">Last Scanned:</span> {repo.lastScannedAt ? new Date(repo.lastScannedAt).toLocaleString() : "Never"}</div>
          {#if data.sourceRevision}
            <div><span class="text-text-muted">Revision:</span> <span class="font-mono">{data.sourceRevision.slice(0, 8)}</span></div>
          {/if}
        </div>
      </div>

      {#if snap}
        <!-- Branch Protection -->
        <div class="p-4 bg-surface-1 border border-border rounded-lg">
          <h3 class="text-sm font-medium text-text-primary mb-3">Branch Protection</h3>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div><span class="text-text-muted">Required Reviews:</span> {snapshotField("requiredReviewCount") ?? 0}</div>
            <div><span class="text-text-muted">Dismiss Stale:</span> {snapshotField("dismissesStaleReviews") ? "Yes" : "No"}</div>
            <div><span class="text-text-muted">Code Owner Review:</span> {snapshotField("requiresCodeOwnerReview") ? "Yes" : "No"}</div>
            <div><span class="text-text-muted">Signed Commits:</span> {snapshotField("requiresSignedCommits") ? "Yes" : "No"}</div>
            <div><span class="text-text-muted">Linear History:</span> {snapshotField("requiresLinearHistory") ? "Yes" : "No"}</div>
          </div>
        </div>

        <!-- Rulesets -->
        <div class="p-4 bg-surface-1 border border-border rounded-lg">
          <h3 class="text-sm font-medium text-text-primary mb-3">Rulesets</h3>
          {@const rulesets = (snapshotField("rulesets") ?? []) as Array<Record<string, unknown>>}
          {#if rulesets.length > 0}
            <div class="space-y-1">
              {#each rulesets as rs}
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-mono text-text-secondary">{rs.name}</span>
                  <span class="px-1.5 py-0.5 rounded bg-surface-2 text-text-muted text-[10px]">{rs.enforcement}</span>
                  <span class="text-text-muted">{rs.sourceType}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-xs text-text-muted">No rulesets configured.</p>
          {/if}
        </div>

        <!-- CODEOWNERS -->
        <div class="p-4 bg-surface-1 border border-border rounded-lg">
          <h3 class="text-sm font-medium text-text-primary mb-3">CODEOWNERS</h3>
          {@const co = snapshotField("codeowners") as Record<string, unknown> | null}
          {#if co?.found}
            <div class="text-xs space-y-1">
              <div><span class="text-text-muted">Location:</span> {co.location}</div>
              <div><span class="text-text-muted">Entries:</span> {(co.entries as unknown[])?.length ?? 0}</div>
            </div>
          {:else}
            <p class="text-xs text-text-muted">No CODEOWNERS file found.</p>
          {/if}
        </div>

        <!-- Warnings -->
        {@const warnings = (snapshotField("warnings") ?? []) as string[]}
        {#if warnings.length > 0}
          <div class="p-4 bg-surface-1 border border-yellow-700 rounded-lg">
            <h3 class="text-sm font-medium text-yellow-400 mb-3">Warnings</h3>
            <ul class="space-y-1">
              {#each warnings as w}
                <li class="text-xs text-yellow-300">{w}</li>
              {/each}
            </ul>
          </div>
        {/if}
      {:else}
        <div class="py-8 text-center">
          <p class="text-text-muted text-sm">
            This repository has not been scanned yet.
            Run <code class="font-mono text-accent">factory repo scan {repo.githubOwner}/{repo.githubRepo}</code> to scan.
          </p>
        </div>
      {/if}
    </div>
  {/if}
</div>
