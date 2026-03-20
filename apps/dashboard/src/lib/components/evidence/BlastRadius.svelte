<script lang="ts">
  interface Props {
    files: number;
    packages: number;
  }

  let { files, packages }: Props = $props();
</script>

<div class="space-y-2">
  <h3 class="text-sm font-medium text-text-primary">Blast Radius</h3>
  <div class="flex gap-6">
    <div class="text-center">
      <p class="text-2xl font-semibold text-text-primary">{files}</p>
      <p class="text-xs text-text-muted">files</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-semibold text-text-primary">{packages}</p>
      <p class="text-xs text-text-muted">packages</p>
    </div>
  </div>
</div>
