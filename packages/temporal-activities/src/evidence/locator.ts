/**
 * EvidenceLocator — the single contract for accessing evidence artifacts.
 * CLI (M15), PR body (M16), and dashboard (M22) all consume this.
 * They receive an EvidenceLocator and use it to retrieve artifacts —
 * never constructing S3 keys themselves.
 *
 * This is a plain data object: no methods, no async, fully serializable.
 */

export interface EvidenceLocator {
  readonly taskId: string;
  readonly attemptNumber: number;
  readonly bundleId: string;
  readonly artifactPrefix: string;
  readonly evidenceJsonKey: string;
  readonly manifestKey: string;
  readonly diffPatchKey: string;
  readonly sarifKey?: string;
  readonly sbomKey?: string;
  readonly testLogKey?: string;
  readonly createdAt: string;
}

export function buildLocator(
  taskId: string,
  attemptNumber: number,
  bundleId: string,
): EvidenceLocator {
  const prefix = `evidence/${taskId}/${attemptNumber}`;
  return {
    taskId,
    attemptNumber,
    bundleId,
    artifactPrefix: `${prefix}/`,
    evidenceJsonKey: `${prefix}/evidence.json`,
    manifestKey: `${prefix}/manifest.json`,
    diffPatchKey: `${prefix}/diff.patch`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Add optional artifact keys to a locator after determining availability.
 */
export function withOptionalArtifacts(
  locator: EvidenceLocator,
  options: {
    readonly hasSarif?: boolean;
    readonly hasSbom?: boolean;
    readonly hasTestLog?: boolean;
  },
): EvidenceLocator {
  const prefix = locator.artifactPrefix;
  return {
    ...locator,
    sarifKey: options.hasSarif ? `${prefix}semgrep.sarif` : undefined,
    sbomKey: options.hasSbom ? `${prefix}sbom.spdx.json` : undefined,
    testLogKey: options.hasTestLog ? `${prefix}test-output.log` : undefined,
  };
}
