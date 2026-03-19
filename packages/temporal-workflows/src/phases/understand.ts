/** Understand phase — stub. Real implementation in M12. */

export interface UnderstandInput {
  readonly taskId: string;
  readonly objective: string;
  readonly baseSha: string;
}

export interface UnderstandResult {
  readonly taskId: string;
  readonly summary: string;
}

export async function understandPhase(
  input: UnderstandInput,
): Promise<UnderstandResult> {
  return { taskId: input.taskId, summary: "stub-understand" };
}
