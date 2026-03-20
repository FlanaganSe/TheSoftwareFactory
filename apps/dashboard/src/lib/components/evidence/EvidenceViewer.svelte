<script lang="ts">
  import type { EvidenceResponse } from "$lib/api/client";
  import RiskSummary from "./RiskSummary.svelte";
  import DiffViewer from "./DiffViewer.svelte";
  import TestResults from "./TestResults.svelte";
  import SecurityFindings from "./SecurityFindings.svelte";
  import BlastRadius from "./BlastRadius.svelte";

  interface Props {
    evidence: EvidenceResponse;
  }

  let { evidence }: Props = $props();

  const sections = [
    "objective",
    "annotatedDiff",
    "blastRadius",
    "ownersImpacted",
    "testResults",
    "securityScanResults",
    "lintResults",
    "protectedSurfaceEdits",
    "migrationImpact",
    "revertabilityClass",
    "unresolvedAssumptions",
    "commandsRun",
    "pendingExternalChecks",
  ] as const;

  const sectionLabels: Record<string, string> = {
    objective: "Objective",
    annotatedDiff: "Annotated Diff",
    blastRadius: "Blast Radius",
    ownersImpacted: "Owners Impacted",
    testResults: "Test Results",
    securityScanResults: "Security Scan",
    lintResults: "Lint Results",
    protectedSurfaceEdits: "Protected Edits",
    migrationImpact: "Migration Impact",
    revertabilityClass: "Revertability",
    unresolvedAssumptions: "Unresolved Assumptions",
    commandsRun: "Commands Run",
    pendingExternalChecks: "Pending Checks",
  };

  let collapsedSections = $state<Set<string>>(new Set());

  function toggleSection(section: string) {
    const next = new Set(collapsedSections);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    collapsedSections = next;
  }

  const hasValidatorControlEdits = $derived(
    evidence.protectedSurfaceEdits.some(
      (e) => e.protectionClass === "validator_control_file",
    ),
  );
</script>

<div class="flex gap-6">
  <!-- Left nav -->
  <nav class="w-48 shrink-0 hidden lg:block">
    <div class="sticky top-4 space-y-1">
      {#each sections as section}
        <a
          href="#{section}"
          class="block text-xs px-2 py-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
        >
          {sectionLabels[section]}
        </a>
      {/each}
    </div>
  </nav>

  <!-- Main content -->
  <div class="flex-1 min-w-0 space-y-6">
    {#if hasValidatorControlEdits}
      <div class="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p class="text-sm font-semibold text-red-400">WARNING: Validator control file edits detected</p>
        <p class="text-xs text-red-400/80 mt-1">
          This change modifies files that control the factory's validation behavior. Review with extreme care.
        </p>
      </div>
    {/if}

    <!-- Objective -->
    <section id="objective">
      <h3 class="text-sm font-medium text-text-primary mb-2">Objective</h3>
      <p class="text-sm text-text-secondary">{evidence.objective}</p>
    </section>

    <!-- Risk Summary -->
    <section id="riskSummary">
      <RiskSummary annotations={evidence.annotatedDiff} />
    </section>

    <!-- Blast Radius -->
    <section id="blastRadius">
      <BlastRadius files={evidence.blastRadiusFiles} packages={evidence.blastRadiusPackages} />
    </section>

    <!-- Annotated Diff -->
    <section id="annotatedDiff">
      {#if !collapsedSections.has("annotatedDiff")}
        <DiffViewer annotations={evidence.annotatedDiff} />
      {:else}
        <button onclick={() => toggleSection("annotatedDiff")} class="text-xs text-accent hover:underline">
          Show Annotated Diff ({evidence.annotatedDiff.length} annotations)
        </button>
      {/if}
    </section>

    <!-- Owners Impacted -->
    <section id="ownersImpacted">
      <h3 class="text-sm font-medium text-text-primary mb-2">Owners Impacted</h3>
      {#if evidence.ownersImpacted.length === 0}
        <p class="text-xs text-text-muted">No CODEOWNERS impacted.</p>
      {:else}
        <div class="flex flex-wrap gap-1.5">
          {#each evidence.ownersImpacted as owner}
            <span class="px-2 py-0.5 bg-surface-2 rounded text-xs text-text-secondary font-mono">{owner}</span>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Test Results -->
    <section id="testResults">
      <TestResults results={evidence.testResults} />
    </section>

    <!-- Security Scan -->
    <section id="securityScanResults">
      <SecurityFindings results={evidence.securityScanResults} />
    </section>

    <!-- Lint Results -->
    <section id="lintResults">
      <h3 class="text-sm font-medium text-text-primary mb-2">Lint Results</h3>
      <div class="flex gap-4 text-xs">
        <span class="{evidence.lintResults.errorCount > 0 ? 'text-red-400' : 'text-green-400'}">
          {evidence.lintResults.errorCount} errors
        </span>
        <span class="text-yellow-400">{evidence.lintResults.warningCount} warnings</span>
      </div>
    </section>

    <!-- Protected Surface Edits -->
    <section id="protectedSurfaceEdits">
      <h3 class="text-sm font-medium text-text-primary mb-2">Protected Edits</h3>
      {#if evidence.protectedSurfaceEdits.length === 0}
        <p class="text-xs text-text-muted">No protected files edited.</p>
      {:else}
        <div class="space-y-2">
          {#each evidence.protectedSurfaceEdits as edit}
            <div class="px-3 py-2 border rounded-md text-xs
              {edit.protectionClass === 'validator_control_file'
                ? 'border-red-500/50 bg-red-500/5'
                : 'border-warning/30 bg-warning/5'}">
              <div class="flex items-center gap-2">
                <span class="font-mono text-text-secondary">{edit.filePath}</span>
                <span class="px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">{edit.protectionClass}</span>
              </div>
              <p class="text-text-muted mt-1">{edit.justification}</p>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Migration Impact -->
    <section id="migrationImpact">
      <h3 class="text-sm font-medium text-text-primary mb-2">Migration Impact</h3>
      {#if !evidence.migrationImpact.hasMigrations}
        <p class="text-xs text-text-muted">No migrations.</p>
      {:else}
        <div class="text-xs space-y-1">
          {#each evidence.migrationImpact.migrationFiles as file}
            <p class="font-mono text-text-secondary">{file}</p>
          {/each}
          {#each evidence.migrationImpact.schemaChanges as change}
            <p class="text-text-muted">{change}</p>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Revertability -->
    <section id="revertabilityClass">
      <h3 class="text-sm font-medium text-text-primary mb-2">Revertability</h3>
      <span class="px-2 py-0.5 rounded text-xs
        {evidence.revertabilityClass === 'clean_revert' ? 'bg-green-500/20 text-green-400' : ''}
        {evidence.revertabilityClass === 'revert_with_migration' ? 'bg-yellow-500/20 text-yellow-400' : ''}
        {evidence.revertabilityClass === 'non_revertable' ? 'bg-red-500/20 text-red-400' : ''}">
        {evidence.revertabilityClass}
      </span>
    </section>

    <!-- Unresolved Assumptions -->
    <section id="unresolvedAssumptions">
      <h3 class="text-sm font-medium text-text-primary mb-2">Unresolved Assumptions</h3>
      {#if evidence.unresolvedAssumptions.length === 0}
        <p class="text-xs text-text-muted">None.</p>
      {:else}
        <ul class="list-disc list-inside text-xs text-text-secondary space-y-1">
          {#each evidence.unresolvedAssumptions as assumption}
            <li>{assumption}</li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Commands Run -->
    <section id="commandsRun">
      <h3 class="text-sm font-medium text-text-primary mb-2">Commands Run</h3>
      {#if evidence.commandsRun.length === 0}
        <p class="text-xs text-text-muted">None.</p>
      {:else}
        <div class="space-y-1">
          {#each evidence.commandsRun as cmd}
            <div class="flex items-center gap-2 text-xs font-mono">
              <span class="{cmd.exitCode === 0 ? 'text-green-400' : 'text-red-400'}">
                [{cmd.exitCode}]
              </span>
              <span class="text-text-secondary">{cmd.command}</span>
              <span class="text-text-muted">{cmd.durationMs}ms</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Pending External Checks -->
    <section id="pendingExternalChecks">
      <h3 class="text-sm font-medium text-text-primary mb-2">Pending External Checks</h3>
      {#if evidence.pendingExternalChecks.length === 0}
        <p class="text-xs text-text-muted">None.</p>
      {:else}
        <ul class="list-disc list-inside text-xs text-text-secondary space-y-1">
          {#each evidence.pendingExternalChecks as check}
            <li>{check}</li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>
