<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/state";
  import { createApiClient } from "$lib/api/client";
  import type { TaskDetailResponse, EvidenceResponse } from "$lib/api/client";
  import type { TaskState, WorkflowPhase } from "@software-factory/core";
  import { WORKFLOW_PHASES } from "@software-factory/core";
  import { getApiKey, getApiUrl } from "$lib/stores/auth";
  import TaskBadge from "$lib/components/tasks/TaskBadge.svelte";
  import TaskTimeline from "$lib/components/tasks/TaskTimeline.svelte";
  import ActivityFeed from "$lib/components/tasks/ActivityFeed.svelte";
  import CostProgress from "$lib/components/tasks/CostProgress.svelte";
  import RiskSummary from "$lib/components/evidence/RiskSummary.svelte";
  import BlastRadius from "$lib/components/evidence/BlastRadius.svelte";
  import { formatDateTime, formatCost } from "$lib/utils/format";
  import { getTaskProgress } from "$lib/stores/task-events.svelte";

  let task: TaskDetailResponse | null = $state(null);
  let evidence: EvidenceResponse | null = $state(null);
  let loading = $state(true);
  let error = $state("");
  let actionLoading = $state(false);
  let showRejectConfirm = $state(false);
  let showChangesInput = $state(false);
  let changesMessage = $state("");
  let rejectConfirmed = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const taskId = $derived(page.params.id ?? "");

  function deriveCompletedPhases(currentPhase?: string): WorkflowPhase[] {
    if (!currentPhase) return [];
    const idx = WORKFLOW_PHASES.indexOf(currentPhase as WorkflowPhase);
    if (idx <= 0) return [];
    return WORKFLOW_PHASES.slice(0, idx) as unknown as WorkflowPhase[];
  }

  // Prefer live SSE data over polling data
  // Note: (task as TaskDetailResponse | null) cast is required because svelte-check
  // cannot properly infer $state types inside $derived blocks
  const liveProgress = $derived(getTaskProgress(taskId));
  const taskRef = $derived(task as TaskDetailResponse | null);
  const effectivePhase = $derived(
    (liveProgress?.currentPhase ?? taskRef?.currentPhase) as WorkflowPhase | undefined
  );
  const completedPhases = $derived(
    liveProgress?.completedPhases?.length
      ? (liveProgress.completedPhases as WorkflowPhase[])
      : deriveCompletedPhases(taskRef?.currentPhase)
  );
  const effectiveCost = $derived(liveProgress?.costCents ?? taskRef?.costCents);
  const isRunning = $derived(taskRef?.workflowStatus === "RUNNING");

  async function fetchTask(): Promise<void> {
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      task = await client.getTask(taskId);
    } catch {
      // Polling failure is non-fatal — keep showing last known state
    }
  }

  onMount(async () => {
    if (!taskId) return;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      task = await client.getTask(taskId);
      try {
        evidence = await client.getEvidence(taskId);
      } catch {
        // Evidence may not exist yet
      }

      // Poll while workflow is running
      if (task?.workflowStatus === "RUNNING") {
        pollTimer = setInterval(async () => {
          await fetchTask();
          // Stop polling once no longer running
          if (task && task.workflowStatus !== "RUNNING" && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
            // Try fetching evidence now that workflow may have produced it
            try {
              evidence = await createApiClient(getApiUrl(), getApiKey()).getEvidence(taskId);
            } catch {
              // Still no evidence
            }
          }
        }, 5_000);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load task";
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  });

  async function handleApprove() {
    const confirmMsg = isPausedAtSetup
      ? "Approve the setup contract? This will provision the sandbox."
      : isPausedAtImplement
        ? "Approve implementation? The agent will begin coding."
        : "Approve this task? This will proceed to PR creation.";
    if (!confirm(confirmMsg)) return;
    actionLoading = true;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      if (isPausedAtSetup) {
        await client.approveSetup(taskId);
      } else if (isPausedAtImplement) {
        await client.approveImplementation(taskId);
      } else {
        await client.approveTask(taskId);
      }
      if (task) task = { ...task, status: "in_progress" };
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      actionLoading = false;
    }
  }

  async function handleReject() {
    if (!rejectConfirmed) {
      showRejectConfirm = true;
      return;
    }
    actionLoading = true;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      if (isPausedAtImplement) {
        await client.rejectImplementation(taskId, "Rejected by operator");
      } else {
        await client.rejectTask(taskId, "Rejected by operator");
      }
      if (task) task = { ...task, status: "failed" };
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      actionLoading = false;
      showRejectConfirm = false;
      rejectConfirmed = false;
    }
  }

  async function handleChanges() {
    if (!changesMessage.trim()) return;
    actionLoading = true;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      await client.requestChanges(taskId, changesMessage);
      if (task) task = { ...task, status: "changes_requested" };
      showChangesInput = false;
      changesMessage = "";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to request changes");
    } finally {
      actionLoading = false;
    }
  }

  async function handleKill() {
    if (!confirm("Kill this task? This will immediately terminate the workflow.")) return;
    actionLoading = true;
    try {
      const client = createApiClient(getApiUrl(), getApiKey());
      await client.killTask(taskId, "Killed by operator");
      if (task) task = { ...task, status: "cancelled" };
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to kill task");
    } finally {
      actionLoading = false;
    }
  }

  const taskStatus = $derived((task as TaskDetailResponse | null)?.status ?? "");
  const effectiveState = $derived(liveProgress?.state ?? taskRef?.state ?? taskStatus);
  const isPausedAtImplement = $derived(
    effectiveState === "paused" && effectivePhase === "implement",
  );
  const isPausedAtSetup = $derived(
    effectiveState === "paused" && effectivePhase === "setup",
  );
  const canApprove = $derived(
    taskStatus === "evidence_ready" ||
    taskStatus === "changes_requested" ||
    isPausedAtImplement ||
    isPausedAtSetup,
  );
  const canReject = $derived(
    taskStatus === "evidence_ready" ||
    taskStatus === "changes_requested" ||
    isPausedAtImplement,
  );
  const canKill = $derived(
    !!task && !["merged", "failed", "cancelled"].includes(taskStatus),
  );
</script>

<div class="max-w-4xl">
  {#if loading}
    <p class="text-text-muted text-sm">Loading...</p>
  {:else if error}
    <p class="text-red-400 text-sm">{error}</p>
  {:else if task}
    <!-- Header -->
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-semibold text-text-primary">Task {taskId.slice(0, 8)}</h2>
          <TaskBadge state={((task.state ?? task.status) as TaskState) ?? "created"} />
        </div>
        {#if task.startTime}
          <p class="text-xs text-text-muted mt-1">Started {formatDateTime(task.startTime)}</p>
        {/if}
      </div>

      <a
        href="/tasks"
        class="text-xs text-text-muted hover:text-text-secondary"
      >
        Back to inbox
      </a>
    </div>

    <!-- Phase Timeline -->
    <div class="mb-6 p-4 bg-surface-1 border border-border rounded-lg">
      <TaskTimeline
        currentPhase={effectivePhase}
        {completedPhases}
      />
      {#if effectiveCost != null && task?.costBudgetCents}
        <div class="mt-3">
          <CostProgress costCents={effectiveCost} budgetCents={task.costBudgetCents} />
        </div>
      {/if}
    </div>

    <!-- Paused state context -->
    {#if isPausedAtSetup}
      <div class="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
        <p class="text-sm text-yellow-300 font-medium">Awaiting Setup Approval</p>
        <p class="text-xs text-text-muted mt-1">The sandbox environment needs approval before provisioning. Review and approve to continue.</p>
      </div>
    {:else if isPausedAtImplement}
      <div class="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
        <p class="text-sm text-yellow-300 font-medium">Awaiting Implementation Approval</p>
        <p class="text-xs text-text-muted mt-1">The agent is ready to begin coding. Review the plan and approve to start implementation.</p>
      </div>
    {/if}

    <!-- Quick Actions -->
    <div class="mb-6 flex flex-wrap gap-2">
      {#if canApprove}
        <button
          onclick={handleApprove}
          disabled={actionLoading}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md font-medium transition-colors disabled:opacity-50"
        >
          Approve
        </button>
      {/if}

      {#if canReject && !isPausedAtImplement && !isPausedAtSetup}
        <button
          onclick={() => { showChangesInput = !showChangesInput; }}
          class="px-4 py-2 bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 text-sm rounded-md font-medium transition-colors"
        >
          Request Changes
        </button>
      {/if}

      {#if canReject}
        <button
          onclick={() => { showRejectConfirm = true; }}
          class="px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 text-sm rounded-md font-medium transition-colors"
        >
          Reject
        </button>
      {/if}

      {#if canKill}
        <button
          onclick={handleKill}
          disabled={actionLoading}
          class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md font-medium transition-colors disabled:opacity-50"
        >
          Kill
        </button>
      {/if}
    </div>

    <!-- Reject confirmation -->
    {#if showRejectConfirm}
      <div class="mb-4 p-3 bg-red-500/5 border border-red-500/30 rounded-md">
        <p class="text-xs text-red-400 mb-2">Are you sure you want to reject this task?</p>
        <div class="flex gap-2">
          <button
            onclick={() => { rejectConfirmed = true; handleReject(); }}
            class="px-3 py-1.5 bg-red-600 text-white text-xs rounded-md"
          >
            Confirm Reject
          </button>
          <button
            onclick={() => { showRejectConfirm = false; }}
            class="px-3 py-1.5 bg-surface-3 text-text-secondary text-xs rounded-md"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}

    <!-- Changes input -->
    {#if showChangesInput}
      <div class="mb-4 p-3 bg-surface-1 border border-border rounded-md">
        <textarea
          bind:value={changesMessage}
          placeholder="Describe the changes needed..."
          rows="3"
          class="w-full px-2 py-1.5 text-sm bg-surface-0 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
        ></textarea>
        <div class="flex gap-2 mt-2">
          <button
            onclick={handleChanges}
            disabled={!changesMessage.trim() || actionLoading}
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

    <!-- Agent Activity (live during implement phase) -->
    {#if liveProgress?.agentSteps?.length}
      <div class="mb-6 p-4 bg-surface-1 border border-border rounded-lg">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-text-primary">Agent Activity</h3>
          <span class="text-xs text-text-muted">{liveProgress.agentSteps.length} steps</span>
        </div>
        {#if effectiveCost != null && task?.costBudgetCents}
          <div class="mb-3">
            <CostProgress costCents={effectiveCost} budgetCents={task.costBudgetCents} />
          </div>
        {/if}
        <ActivityFeed steps={liveProgress.agentSteps} />
      </div>
    {/if}

    <!-- Evidence summary -->
    {#if evidence}
      <div class="space-y-4 p-4 bg-surface-1 border border-border rounded-lg mb-6">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-text-primary">Evidence Summary</h3>
          <a
            href="/tasks/{taskId}/evidence"
            class="text-xs text-accent hover:underline"
          >
            View full evidence
          </a>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <RiskSummary annotations={evidence.annotatedDiff} />
          <BlastRadius files={evidence.blastRadiusFiles} packages={evidence.blastRadiusPackages} />
        </div>

        <div class="flex gap-4 text-xs">
          <span class="text-green-400">{evidence.testResults.passed} tests passed</span>
          {#if evidence.testResults.failed > 0}
            <span class="text-red-400">{evidence.testResults.failed} failed</span>
          {/if}
          {#if evidence.securityScanResults.totalFindings > 0}
            <span class="text-yellow-400">{evidence.securityScanResults.totalFindings} security findings</span>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
