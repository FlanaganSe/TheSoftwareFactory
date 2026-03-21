<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { getApiKey, getApiUrl, isAuthenticated } from "$lib/stores/auth";
  import { createSSEClient } from "$lib/api/sse";
  import type { SSEClient } from "$lib/api/sse";
  import { handleTaskEvent } from "$lib/stores/task-events.svelte";
  import Sidebar from "$lib/components/layout/Sidebar.svelte";
  import Header from "$lib/components/layout/Header.svelte";

  let { children } = $props();

  let sseClient: SSEClient | null = null;

  const isLoginPage = $derived(page.url.pathname === "/login");

  onMount(() => {
    if (!isAuthenticated() && !isLoginPage) {
      goto("/login");
      return;
    }

    if (isAuthenticated()) {
      sseClient = createSSEClient(getApiUrl(), getApiKey());
      sseClient.onTasks(handleTaskEvent);
      sseClient.connect();
    }
  });

  onDestroy(() => {
    sseClient?.disconnect();
  });
</script>

{#if isLoginPage}
  {@render children()}
{:else}
  <div class="flex min-h-screen bg-surface-0">
    <Sidebar />
    <div class="flex-1 flex flex-col">
      <Header>
        <div class="text-sm text-text-muted">
          {page.url.pathname}
        </div>
      </Header>
      <main class="flex-1 p-6 overflow-auto">
        {@render children()}
      </main>
    </div>
  </div>
{/if}
