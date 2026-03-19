/** Learn phase — stub. Real implementation in M18. */

export interface LearnInput {
  readonly taskId: string;
}

export interface LearnResult {
  readonly taskId: string;
  readonly lessonsLearned: number;
}

export async function learnPhase(input: LearnInput): Promise<LearnResult> {
  return { taskId: input.taskId, lessonsLearned: 0 };
}
