<script lang="ts">
  import { browser } from "$app/environment";
  import type { Snippet } from "svelte";

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  let isDark = $state(true);

  function toggleTheme() {
    isDark = !isDark;
    if (browser) {
      document.documentElement.classList.toggle("light", !isDark);
      document.documentElement.classList.toggle("dark", isDark);
    }
  }
</script>

<header class="h-12 bg-surface-1 border-b border-border flex items-center justify-between px-6">
  {#if children}{@render children()}{/if}
  <button
    onclick={toggleTheme}
    class="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
    title="Toggle theme"
  >
    {#if isDark}
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    {:else}
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    {/if}
  </button>
</header>
