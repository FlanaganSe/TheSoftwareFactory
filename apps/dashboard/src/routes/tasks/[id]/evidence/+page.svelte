<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { createApiClient } from "$lib/api/client";
  import type { EvidenceResponse } from "$lib/api/client";
  import { getApiKey, getApiUrl } from "$lib/stores/auth";
  import EvidenceViewer from "$lib/components/evidence/EvidenceViewer.svelte";

  let evidence: EvidenceResponse | null = $state(null);
  let loading = $state(true);
  let error = $state("");

  const taskId = $derived(page.params.id ?? "");

  onMount(async () => {
    if (!taskId) return;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      evidence = await client.getEvidence(taskId);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load evidence";
    } finally {
      loading = false;
    }
  });

  async function handleApprove() {
    if (!confirm("Approve this task?")) return;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      await client.approveTask(taskId);
      alert("Task approved.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to approve");
    }
  }

  async function handleReject() {
    if (!confirm("Reject this task?")) return;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      await client.rejectTask(taskId, "Rejected after evidence review");
      alert("Task rejected.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reject");
    }
  }

  let changesMessage = $state("");
  let showChangesInput = $state(false);

  async function handleChanges() {
    if (!changesMessage.trim()) return;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      await client.requestChanges(taskId, changesMessage);
      showChangesInput = false;
      changesMessage = "";
      alert("Changes requested.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }
</script>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <a href="/tasks/{taskId}" class="text-text-muted hover:text-text-secondary text-xs">
        &larr; Back to task
      </a>
      <h2 class="text-lg font-semibold text-text-primary">Evidence Review</h2>
    </div>
  </div>

  {#if loading}
    <p class="text-text-muted text-sm">Loading evidence...</p>
  {:else if error}
    <p class="text-red-400 text-sm">{error}</p>
  {:else if evidence}
    <EvidenceViewer {evidence} />

    <!-- Approval actions at bottom -->
    <div class="mt-8 p-4 bg-surface-1 border border-border rounded-lg flex flex-wrap items-center gap-3">
      <button
        onclick={handleApprove}
        class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md font-medium transition-colors"
      >
        Approve
      </button>
      <button
        onclick={() => { showChangesInput = !showChangesInput; }}
        class="px-4 py-2 bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 text-sm rounded-md font-medium transition-colors"
      >
        Request Changes
      </button>
      <button
        onclick={handleReject}
        class="px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 text-sm rounded-md font-medium transition-colors"
      >
        Reject
      </button>
    </div>

    {#if showChangesInput}
      <div class="mt-3 p-3 bg-surface-1 border border-border rounded-md">
        <textarea
          bind:value={changesMessage}
          placeholder="Describe the changes needed..."
          rows="3"
          class="w-full px-2 py-1.5 text-sm bg-surface-0 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
        ></textarea>
        <div class="flex gap-2 mt-2">
          <button
            onclick={handleChanges}
            disabled={!changesMessage.trim()}
            class="px-3 py-1.5 bg-orange-600 text-white text-xs rounded-md disabled:opacity-50"
          >
            Send
          </button>
          <button
            onclick={() => { showChangesInput = false; }}
            class="px-3 py-1.5 bg-surface-3 text-text-secondary text-xs rounded-md"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
