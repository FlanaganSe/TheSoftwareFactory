/** Plan phase — stub. Real implementation in M12. */

export interface PlanInput {
  readonly taskId: string;
  readonly objective: string;
}

export interface PlanResult {
  readonly taskId: string;
  readonly plan: string;
}

export async function planPhase(input: PlanInput): Promise<PlanResult> {
  return { taskId: input.taskId, plan: "stub-plan" };
}
