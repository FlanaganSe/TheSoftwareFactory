<script lang="ts">
  interface Props {
    active: boolean;
    onActivate: (reason?: string) => void;
    onDeactivate: () => void;
  }

  let { active, onActivate, onDeactivate }: Props = $props();

  let showConfirm = $state(false);
  let reason = $state("");

  function handleAction() {
    if (active) {
      onDeactivate();
    } else {
      showConfirm = true;
    }
  }

  function confirmActivate() {
    onActivate(reason || undefined);
    showConfirm = false;
    reason = "";
  }
</script>

<div class="p-4 border rounded-lg {active ? 'border-red-500/50 bg-red-500/5' : 'border-border bg-surface-1'}">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-sm font-medium text-text-primary">Global Kill Switch</h3>
      <p class="text-xs text-text-muted mt-0.5">
        {active ? "ACTIVE — all workflows halted" : "Inactive — system running normally"}
      </p>
    </div>
    <button
      onclick={handleAction}
      class="px-4 py-2 rounded-md text-sm font-medium transition-colors
        {active
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : 'bg-red-600 hover:bg-red-700 text-white'}"
    >
      {active ? "Deactivate" : "Activate Kill Switch"}
    </button>
  </div>

  {#if showConfirm}
    <div class="mt-4 p-3 bg-surface-2 rounded-md border border-border">
      <p class="text-xs text-red-400 font-medium mb-2">
        This will immediately halt ALL running workflows. Are you sure?
      </p>
      <input
        type="text"
        bind:value={reason}
        placeholder="Reason (optional)"
        class="w-full px-2 py-1.5 text-xs bg-surface-1 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
      />
      <div class="flex gap-2 mt-2">
        <button
          onclick={confirmActivate}
          class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md font-medium"
        >
          Confirm Kill
        </button>
        <button
          onclick={() => { showConfirm = false; }}
          class="px-3 py-1.5 bg-surface-3 hover:bg-border text-text-secondary text-xs rounded-md"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>
