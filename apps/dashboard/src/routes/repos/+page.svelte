<script lang="ts">
  import { onMount } from "svelte";
  import { createApiClient } from "$lib/api/client";
  import type { RepoSummary } from "$lib/api/client";
  import { getApiKey, getApiUrl } from "$lib/stores/auth";

  let repos: RepoSummary[] = $state([]);
  let loading = $state(true);
  let error = $state("");

  onMount(async () => {
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      const result = await client.getRepos();
      repos = result.repos;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load repositories";
    } finally {
      loading = false;
    }
  });
</script>

<div class="max-w-4xl">
  <h2 class="text-lg font-semibold text-text-primary mb-4">Repositories</h2>

  {#if loading}
    <div class="py-12 text-center">
      <p class="text-text-muted text-sm">Loading repositories...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <p class="text-red-400 text-sm">{error}</p>
    </div>
  {:else if repos.length === 0}
    <div class="py-12 text-center">
      <p class="text-text-muted text-sm">
        No repositories found. Run <code class="font-mono text-accent">factory repo scan owner/repo</code> to scan a repository.
      </p>
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border text-left">
            <th class="pb-2 text-text-muted font-medium">Repository</th>
            <th class="pb-2 text-text-muted font-medium">Class</th>
            <th class="pb-2 text-text-muted font-medium">Branch</th>
            <th class="pb-2 text-text-muted font-medium">Last Scanned</th>
          </tr>
        </thead>
        <tbody>
          {#each repos as repo}
            <tr class="border-b border-border/50 hover:bg-surface-1/50">
              <td class="py-2">
                <a href="/repos/{repo.id}" class="text-accent hover:underline font-mono text-xs">
                  {repo.githubOwner}/{repo.githubRepo}
                </a>
              </td>
              <td class="py-2">
                <span class="inline-block px-2 py-0.5 rounded text-xs font-medium"
                  class:bg-green-900={repo.repoClass === "A"}
                  class:text-green-300={repo.repoClass === "A"}
                  class:bg-yellow-900={repo.repoClass === "B"}
                  class:text-yellow-300={repo.repoClass === "B"}
                  class:bg-red-900={repo.repoClass === "C"}
                  class:text-red-300={repo.repoClass === "C"}
                >
                  {repo.repoClass}
                </span>
              </td>
              <td class="py-2 text-text-secondary text-xs">{repo.defaultBranch}</td>
              <td class="py-2 text-text-muted text-xs">
                {repo.lastScannedAt ? new Date(repo.lastScannedAt).toLocaleDateString() : "Never"}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="text-text-muted text-xs mt-4">
      Run <code class="font-mono text-accent">factory repo scan owner/repo</code> to scan a new repository.
    </p>
  {/if}
</div>
