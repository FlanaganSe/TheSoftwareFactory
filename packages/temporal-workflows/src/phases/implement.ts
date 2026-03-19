/** Implement phase — stub. Real implementation in M11/M12. */

export interface ImplementInput {
  readonly taskId: string;
  readonly objective: string;
  readonly plan: string;
  readonly iteration: number;
}

export interface ImplementResult {
  readonly taskId: string;
  readonly iteration: number;
  readonly filesChanged: number;
}

export async function implementPhase(
  input: ImplementInput,
): Promise<ImplementResult> {
  return { taskId: input.taskId, iteration: input.iteration, filesChanged: 0 };
}
