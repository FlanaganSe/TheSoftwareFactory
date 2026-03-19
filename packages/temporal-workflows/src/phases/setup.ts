/** Setup phase — stub. Real implementation in M10/M12. */

export interface SetupInput {
  readonly taskId: string;
}

export interface SetupResult {
  readonly taskId: string;
  readonly sandboxReady: boolean;
}

export async function setupPhase(input: SetupInput): Promise<SetupResult> {
  return { taskId: input.taskId, sandboxReady: true };
}
