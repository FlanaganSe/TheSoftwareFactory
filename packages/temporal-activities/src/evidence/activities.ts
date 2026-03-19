import type { CodeownersEntry, PolicyConfig } from "@software-factory/core";
import type { DbInstance } from "@software-factory/db";
import { evidenceRepo } from "@software-factory/db";
import { ApplicationFailure } from "@temporalio/activity";
import type { SandboxSupervisor } from "../sandbox/index.js";
import type { ArtifactStore, ArtifactStoreConfig } from "./artifact-store.js";
import { createArtifactStore } from "./artifact-store.js";
import type {
  AgentResultData,
  CapabilityData,
  ValidationData,
} from "./generator.js";
import { generateEvidence } from "./generator.js";
import { buildLocator, withOptionalArtifacts } from "./locator.js";
import type { EvidenceLocator } from "./locator.js";
import type { ManifestEntry, ManifestMeta } from "./manifest.js";
import { createManifest } from "./manifest.js";
import { redactSecrets } from "./redaction.js";
import { categorizeRisks } from "./risk-summary.js";
import type { RiskCategorization } from "./risk-summary.js";

export interface EvidenceActivityDeps {
  readonly db: DbInstance;
  readonly sandbox: SandboxSupervisor;
  readonly artifactStoreConfig: ArtifactStoreConfig;
}

export interface EvidenceGenerateInput {
  readonly taskId: string;
  readonly objective: string;
  readonly attemptNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeBaseSha: string;
  readonly containerId: string;
  readonly validationResult: ValidationData;
  readonly agentResult: AgentResultData;
  readonly capabilitySnapshot: CapabilityData;
  readonly codeownersEntries: readonly CodeownersEntry[];
  readonly changedFiles: readonly string[];
  readonly policies: readonly PolicyConfig[];
}

export interface EvidenceGenerateResult {
  readonly bundleId: string;
  readonly locator: EvidenceLocator;
  readonly riskSummary: RiskCategorization;
  readonly passed: boolean;
}

function toActivityFailure(message: string): never {
  throw ApplicationFailure.nonRetryable(message);
}

export function createEvidenceActivities(deps: EvidenceActivityDeps) {
  const store: ArtifactStore = createArtifactStore(deps.artifactStoreConfig);

  return {
    async generateAndPersistEvidence(
      input: EvidenceGenerateInput,
    ): Promise<EvidenceGenerateResult> {
      // 1. Ensure bucket exists
      const bucketResult = await store.ensureBucket();
      if (bucketResult.isErr()) {
        toActivityFailure(`Bucket setup failed: ${bucketResult.error.message}`);
      }

      // 2. Generate evidence bundle
      const evidenceResult = await generateEvidence({
        ...input,
        sandbox: deps.sandbox,
      });
      if (evidenceResult.isErr()) {
        toActivityFailure(
          `Evidence generation failed: ${evidenceResult.error.message}`,
        );
      }

      const { bundle, rawPatch, annotations } = evidenceResult.value;

      // 3. Upload artifacts to MinIO
      const prefix = `evidence/${input.taskId}/${input.attemptNumber}`;
      const manifestEntries: ManifestEntry[] = [];

      // evidence.json
      const evidenceJson = JSON.stringify(bundle, null, 2);
      const ejRef = await store.uploadArtifact(
        `${prefix}/evidence.json`,
        evidenceJson,
        "application/json",
      );
      if (ejRef.isErr()) {
        toActivityFailure(
          `Failed to upload evidence.json: ${ejRef.error.message}`,
        );
      }
      manifestEntries.push({
        filename: "evidence.json",
        sha256: ejRef.value.sha256,
        sizeBytes: ejRef.value.sizeBytes,
        contentType: "application/json",
      });

      // diff.patch
      const patchRef = await store.uploadArtifact(
        `${prefix}/diff.patch`,
        rawPatch,
        "text/x-diff",
      );
      if (patchRef.isErr()) {
        toActivityFailure(
          `Failed to upload diff.patch: ${patchRef.error.message}`,
        );
      }
      manifestEntries.push({
        filename: "diff.patch",
        sha256: patchRef.value.sha256,
        sizeBytes: patchRef.value.sizeBytes,
        contentType: "text/x-diff",
      });

      // Optional: SARIF
      let hasSarif = false;
      if (input.validationResult.sarifOutput) {
        const redacted = redactSecrets(input.validationResult.sarifOutput);
        const sarifRef = await store.uploadArtifact(
          `${prefix}/semgrep.sarif`,
          redacted,
          "application/json",
        );
        if (sarifRef.isOk()) {
          hasSarif = true;
          manifestEntries.push({
            filename: "semgrep.sarif",
            sha256: sarifRef.value.sha256,
            sizeBytes: sarifRef.value.sizeBytes,
            contentType: "application/json",
          });
        }
      }

      // Optional: SBOM
      let hasSbom = false;
      if (input.validationResult.sbomOutput) {
        const redacted = redactSecrets(input.validationResult.sbomOutput);
        const sbomRef = await store.uploadArtifact(
          `${prefix}/sbom.spdx.json`,
          redacted,
          "application/json",
        );
        if (sbomRef.isOk()) {
          hasSbom = true;
          manifestEntries.push({
            filename: "sbom.spdx.json",
            sha256: sbomRef.value.sha256,
            sizeBytes: sbomRef.value.sizeBytes,
            contentType: "application/json",
          });
        }
      }

      // Optional: test log
      let hasTestLog = false;
      if (input.validationResult.testLog) {
        const redacted = redactSecrets(input.validationResult.testLog);
        const logRef = await store.uploadArtifact(
          `${prefix}/test-output.log`,
          redacted,
          "text/plain",
        );
        if (logRef.isOk()) {
          hasTestLog = true;
          manifestEntries.push({
            filename: "test-output.log",
            sha256: logRef.value.sha256,
            sizeBytes: logRef.value.sizeBytes,
            contentType: "text/plain",
          });
        }
      }

      // 4. Create and upload manifest
      const meta: ManifestMeta = {
        taskId: input.taskId,
        attemptNumber: input.attemptNumber,
      };
      const manifest = createManifest(manifestEntries, meta);
      const manifestJson = JSON.stringify(manifest, null, 2);
      const manifestRef = await store.uploadArtifact(
        `${prefix}/manifest.json`,
        manifestJson,
        "application/json",
      );
      if (manifestRef.isErr()) {
        toActivityFailure(
          `Failed to upload manifest.json: ${manifestRef.error.message}`,
        );
      }

      // 5. Persist to Postgres
      const dbResult = await evidenceRepo.createEvidenceBundle(deps.db, {
        taskId: input.taskId,
        schemaVersion: bundle.schemaVersion,
        objective: bundle.objective,
        baseSha: bundle.baseSha,
        headSha: bundle.headSha,
        mergeBaseSha: bundle.mergeBaseSha,
        revertabilityClass: bundle.revertabilityClass,
        blastRadiusFiles: bundle.blastRadius.files,
        blastRadiusPackages: bundle.blastRadius.packages,
        hasProtectedSurfaceEdits: bundle.protectedSurfaceEdits.length > 0,
        hasMigrationImpact: bundle.migrationImpact.hasMigrations,
        artifactUrl: `${prefix}/`,
        annotatedDiff: [...bundle.annotatedDiff],
        ownersImpacted: [...bundle.ownersImpacted],
        testResults: bundle.testResults,
        securityScanResults: bundle.securityScanResults,
        lintResults: bundle.lintResults,
        protectedSurfaceEdits: [...bundle.protectedSurfaceEdits],
        migrationImpact: bundle.migrationImpact,
        unresolvedAssumptions: [...bundle.unresolvedAssumptions],
        commandsRun: [...bundle.commandsRun],
        pendingExternalChecks: [...bundle.pendingExternalChecks],
      });
      if (dbResult.isErr()) {
        toActivityFailure(
          `Failed to persist evidence: ${dbResult.error.message}`,
        );
      }

      const bundleId = dbResult.value.id;

      // 6. Seal evidence
      const sealResult = await evidenceRepo.sealEvidence(
        deps.db,
        bundleId,
        manifest.manifestHash,
      );
      if (sealResult.isErr()) {
        toActivityFailure(
          `Failed to seal evidence: ${sealResult.error.message}`,
        );
      }

      // 7. Build locator
      const locator = withOptionalArtifacts(
        buildLocator(input.taskId, input.attemptNumber, bundleId),
        { hasSarif, hasSbom, hasTestLog },
      );

      // 8. Categorize risks
      const validationSummary = {
        testsPassed: bundle.testResults.failed === 0,
        testFailCount: bundle.testResults.failed,
        criticalVulnCount: bundle.securityScanResults.criticalCount,
        highVulnCount: bundle.securityScanResults.highCount,
        mediumVulnCount: bundle.securityScanResults.vulnerabilities.filter(
          (v) => v.severity === "medium",
        ).length,
        lintErrorCount: bundle.lintResults.errorCount,
        lintWarningCount: bundle.lintResults.warningCount,
        hasMigrations: bundle.migrationImpact.hasMigrations,
        protectedSurfaceEdits: bundle.protectedSurfaceEdits.map(
          (e) => e.filePath,
        ),
      };

      const riskSummary = categorizeRisks(
        validationSummary,
        annotations,
        input.validationResult.validatorControlFileEdits?.map((e) => ({
          path: e.path,
          baseRefHash: e.baseRefHash,
          workspaceHash: e.workspaceHash,
          category: e.category as
            | "test_config"
            | "lint_config"
            | "security_config"
            | "ci_config"
            | "factory_config",
        })) ?? [],
      );

      const passed =
        bundle.testResults.failed === 0 &&
        bundle.securityScanResults.criticalCount === 0 &&
        riskSummary.hardBlockers.length === 0;

      return { bundleId, locator, riskSummary, passed };
    },
  };
}
