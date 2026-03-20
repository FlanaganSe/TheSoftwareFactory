<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/tasks");
  });
</script>

<div class="flex items-center justify-center h-64">
  <p class="text-text-muted text-sm">Redirecting...</p>
</div>
