<script lang="ts">
  import { onMount } from "svelte";
  import { createApiClient } from "$lib/api/client";
  import type { SafetyStatusResponse, HealthResponse } from "$lib/api/client";
  import { getApiKey, getApiUrl } from "$lib/stores/auth";
  import KillSwitch from "$lib/components/safety/KillSwitch.svelte";
  import CircuitBreakers from "$lib/components/safety/CircuitBreakers.svelte";
  import CostDashboard from "$lib/components/safety/CostDashboard.svelte";

  let safetyStatus: SafetyStatusResponse | null = $state(null);
  let health: HealthResponse | null = $state(null);
  let loading = $state(true);
  let error = $state("");

  function getClient() {
    return createApiClient(getApiUrl(), getApiKey());
  }

  onMount(async () => {
    try {
      const client = getClient();
      const [safety, healthData] = await Promise.all([
        client.getSafetyStatus().catch(() => null),
        client.getHealth().catch(() => null),
      ]);
      safetyStatus = safety;
      health = healthData;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load safety data";
    } finally {
      loading = false;
    }
  });

  async function handleActivateKill(reason?: string) {
    try {
      const client = getClient();
      await client.activateGlobalKill(reason);
      if (safetyStatus) safetyStatus = { ...safetyStatus, globalKill: true };
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to activate kill switch");
    }
  }

  async function handleDeactivateKill() {
    try {
      const client = getClient();
      await client.deactivateGlobalKill();
      if (safetyStatus) safetyStatus = { ...safetyStatus, globalKill: false };
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to deactivate kill switch");
    }
  }

  async function handleTripCircuit(service: string) {
    try {
      const client = getClient();
      await client.tripCircuitBreaker(service);
      // Refresh status
      safetyStatus = await client.getSafetyStatus();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to trip circuit");
    }
  }

  async function handleResetCircuit(service: string) {
    try {
      const client = getClient();
      await client.resetCircuitBreaker(service);
      safetyStatus = await client.getSafetyStatus();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reset circuit");
    }
  }
</script>

<div class="max-w-4xl space-y-6">
  <h2 class="text-lg font-semibold text-text-primary">Safety Dashboard</h2>

  {#if loading}
    <p class="text-text-muted text-sm">Loading safety data...</p>
  {:else if error}
    <p class="text-red-400 text-sm">{error}</p>
  {:else}
    <!-- Kill Switch -->
    {#if safetyStatus}
      <KillSwitch
        active={safetyStatus.globalKill}
        onActivate={handleActivateKill}
        onDeactivate={handleDeactivateKill}
      />

      <!-- Circuit Breakers -->
      <CircuitBreakers
        circuits={safetyStatus.circuits}
        onTrip={handleTripCircuit}
        onReset={handleResetCircuit}
      />

      <!-- Daily Cost -->
      <div class="p-4 bg-surface-1 border border-border rounded-lg">
        <CostDashboard cost={safetyStatus.dailyCost} />
      </div>

      <!-- Active Kills -->
      {#if safetyStatus.activeKills.length > 0}
        <div class="p-4 bg-surface-1 border border-border rounded-lg">
          <h3 class="text-sm font-medium text-text-primary mb-3">Active Kills</h3>
          <div class="space-y-2">
            {#each safetyStatus.activeKills as kill}
              <div class="flex items-center justify-between text-xs px-3 py-2 bg-red-500/5 border border-red-500/20 rounded">
                <span class="text-text-secondary">
                  {kill.taskId ? `Task ${kill.taskId.slice(0, 8)}` : "Global"}
                </span>
                <span class="text-text-muted">{kill.reason ?? "No reason"}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <div class="p-4 bg-surface-1 border border-border rounded-lg">
        <p class="text-xs text-text-muted">Safety system unavailable. Redis may not be configured.</p>
      </div>
    {/if}

    <!-- System Health -->
    {#if health}
      <div class="p-4 bg-surface-1 border border-border rounded-lg">
        <h3 class="text-sm font-medium text-text-primary mb-3">System Health</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each Object.entries(health.checks) as [name, check]}
            <div class="flex items-center justify-between text-xs px-3 py-2 bg-surface-2 rounded">
              <span class="text-text-secondary capitalize">{name}</span>
              <span class="{check.status === 'healthy' ? 'text-green-400' : 'text-red-400'}">
                {check.status}
                {#if check.latencyMs}
                  <span class="text-text-muted ml-1">({check.latencyMs}ms)</span>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
