<script lang="ts">
  import { onMount } from "svelte";
  import { createApiClient } from "$lib/api/client";
  import type { TaskSummary } from "$lib/api/client";
  import { getApiKey, getApiUrl } from "$lib/stores/auth";
  import TaskList from "$lib/components/tasks/TaskList.svelte";

  let tasks: TaskSummary[] = $state([]);
  let loading = $state(true);
  let error = $state("");

  onMount(async () => {
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      const result = await client.getTasks();
      tasks = result.tasks;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load tasks";
    } finally {
      loading = false;
    }
  });
</script>

<div class="max-w-4xl">
  <h2 class="text-lg font-semibold text-text-primary mb-4">Review Inbox</h2>

  {#if loading}
    <div class="py-12 text-center">
      <p class="text-text-muted text-sm">Loading tasks...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <p class="text-red-400 text-sm">{error}</p>
    </div>
  {:else}
    <TaskList {tasks} />
  {/if}
</div>
