<script lang="ts">
  import type { TaskState } from "@software-factory/core";
  import { STATE_COLORS, STATE_LABELS } from "$lib/utils/colors";

  interface Props {
    state: TaskState;
  }

  let { state }: Props = $props();
</script>

<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {STATE_COLORS[state] ?? 'bg-gray-500/20 text-gray-400'}">
  {STATE_LABELS[state] ?? state}
</span>
