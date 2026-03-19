/** Evidence phase — stub. Real implementation in M14. */

export interface EvidenceInput {
  readonly taskId: string;
}

export interface EvidenceResult {
  readonly taskId: string;
  readonly bundleId: string;
}

export async function evidencePhase(
  input: EvidenceInput,
): Promise<EvidenceResult> {
  return { taskId: input.taskId, bundleId: "stub-evidence-bundle" };
}
