<script lang="ts">
  import { goto } from "$app/navigation";
  import { setApiKey, setApiUrl, getApiUrl } from "$lib/stores/auth";

  let apiKey = $state("");
  let apiUrl = $state(getApiUrl());
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit() {
    if (!apiKey.trim()) {
      error = "API key is required";
      return;
    }

    loading = true;
    error = "";

    try {
      // Validate by hitting health endpoint (unauthenticated) then tasks endpoint (authenticated)
      const healthRes = await fetch(`${apiUrl}/health`);
      if (!healthRes.ok) {
        error = "Cannot reach API server. Check the URL.";
        return;
      }

      const taskRes = await fetch(`${apiUrl}/api/tasks`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (taskRes.status === 401) {
        error = "Invalid API key.";
        return;
      }

      setApiKey(apiKey);
      setApiUrl(apiUrl);
      goto("/tasks");
    } catch {
      error = "Cannot connect to API server.";
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen bg-surface-0 flex items-center justify-center">
  <div class="w-full max-w-sm p-6">
    <div class="text-center mb-8">
      <h1 class="text-xl font-semibold text-text-primary">Software Factory</h1>
      <p class="text-sm text-text-muted mt-1">Enter your API key to continue</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
      <div>
        <label for="apiUrl" class="block text-xs text-text-muted mb-1">API Server URL</label>
        <input
          id="apiUrl"
          type="url"
          bind:value={apiUrl}
          class="w-full px-3 py-2 text-sm bg-surface-1 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label for="apiKey" class="block text-xs text-text-muted mb-1">API Key</label>
        <input
          id="apiKey"
          type="password"
          bind:value={apiKey}
          placeholder="sf_..."
          class="w-full px-3 py-2 text-sm bg-surface-1 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </div>

      {#if error}
        <p class="text-xs text-red-400">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
      >
        {loading ? "Connecting..." : "Sign In"}
      </button>
    </form>
  </div>
</div>
