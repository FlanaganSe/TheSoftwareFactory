import { createHash } from "node:crypto";

export type GuardrailName =
  | "max_steps"
  | "no_progress"
  | "loop_of_doom"
  | "wall_clock"
  | "cost_budget";

export interface GuardrailTrip {
  readonly guardrail: GuardrailName;
  readonly message: string;
  readonly state: GuardrailState;
}

export interface GuardrailState {
  readonly stepCount: number;
  readonly stateFingerprints: readonly string[];
  readonly toolCallHashes: readonly string[];
  readonly startTimeMs: number;
  readonly totalCostCents: number;
}

export interface GuardrailConfig {
  readonly maxSteps: number;
  readonly noProgressThreshold: number;
  readonly loopOfDoomThreshold: number;
  readonly wallClockTimeoutMs: number;
  readonly budgetCents: number;
}

const DEFAULT_CONFIG: GuardrailConfig = {
  maxSteps: 20,
  noProgressThreshold: 10,
  loopOfDoomThreshold: 4,
  wallClockTimeoutMs: 1_800_000,
  budgetCents: 1000,
};

export function createGuardrails(partial?: Partial<GuardrailConfig>) {
  const config: GuardrailConfig = { ...DEFAULT_CONFIG, ...partial };

  function checkAfterStep(
    state: GuardrailState,
    nowMs?: number,
  ): GuardrailTrip | null {
    // 1. Max steps
    if (state.stepCount >= config.maxSteps) {
      return {
        guardrail: "max_steps",
        message: `Reached maximum step count (${config.maxSteps})`,
        state,
      };
    }

    // 2. No-progress fingerprint
    if (state.stateFingerprints.length >= config.noProgressThreshold) {
      const recent = state.stateFingerprints.slice(-config.noProgressThreshold);
      if (recent.every((fp) => fp === recent[0])) {
        return {
          guardrail: "no_progress",
          message: `No progress detected: ${config.noProgressThreshold} identical state fingerprints`,
          state,
        };
      }
    }

    // 3. Loop-of-doom
    if (state.toolCallHashes.length >= config.loopOfDoomThreshold) {
      const counts = new Map<string, number>();
      for (const hash of state.toolCallHashes) {
        counts.set(hash, (counts.get(hash) ?? 0) + 1);
      }
      for (const [, count] of counts) {
        if (count >= config.loopOfDoomThreshold) {
          return {
            guardrail: "loop_of_doom",
            message: `Loop detected: same tool call repeated ${count} times`,
            state,
          };
        }
      }
    }

    // 4. Wall-clock timeout
    const now = nowMs ?? Date.now();
    if (now - state.startTimeMs >= config.wallClockTimeoutMs) {
      return {
        guardrail: "wall_clock",
        message: `Wall-clock timeout exceeded (${config.wallClockTimeoutMs}ms)`,
        state,
      };
    }

    // 5. Cost budget
    if (state.totalCostCents >= config.budgetCents) {
      return {
        guardrail: "cost_budget",
        message: `Cost budget exceeded: ${state.totalCostCents} cents >= ${config.budgetCents} cents`,
        state,
      };
    }

    return null;
  }

  function computeFingerprint(
    modifiedFiles: ReadonlyMap<string, string>,
    testPassCount: number,
    testFailCount: number,
    lintErrorCount: number,
  ): string {
    const data = JSON.stringify({
      modifiedFilePaths: [...modifiedFiles.keys()].sort(),
      testPassCount,
      testFailCount,
      lintErrorCount,
    });
    return createHash("sha256").update(data).digest("hex");
  }

  function computeToolCallHash(
    toolName: string,
    args: unknown,
    error?: string,
  ): string {
    const data = toolName + JSON.stringify(args) + (error ?? "");
    return createHash("sha256").update(data).digest("hex");
  }

  return {
    checkAfterStep,
    computeFingerprint,
    computeToolCallHash,
    config,
  };
}
