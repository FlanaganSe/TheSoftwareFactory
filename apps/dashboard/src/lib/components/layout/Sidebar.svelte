<script lang="ts">
  import { page } from "$app/state";

  const navItems = [
    { href: "/tasks", label: "Review Inbox", icon: "inbox" },
    { href: "/repos", label: "Repositories", icon: "repo" },
    { href: "/safety", label: "Safety", icon: "shield" },
  ];

  const icons: Record<string, string> = {
    inbox: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    repo: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
    shield: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  };
</script>

<nav class="w-56 min-h-screen bg-surface-1 border-r border-border flex flex-col">
  <div class="p-4 border-b border-border">
    <h1 class="text-lg font-semibold tracking-tight text-text-primary">Software Factory</h1>
    <p class="text-xs text-text-muted mt-0.5">Control Plane</p>
  </div>

  <div class="flex-1 py-2">
    {#each navItems as item}
      {@const active = page.url.pathname.startsWith(item.href)}
      <a
        href={item.href}
        class="flex items-center gap-3 px-4 py-2.5 mx-2 rounded-md text-sm transition-colors
          {active ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'}"
      >
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d={icons[item.icon]} />
        </svg>
        {item.label}
      </a>
    {/each}
  </div>

  <div class="p-4 border-t border-border">
    <a
      href="/login"
      class="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
      Logout
    </a>
  </div>
</nav>
