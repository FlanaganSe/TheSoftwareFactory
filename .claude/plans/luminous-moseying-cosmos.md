# Fix: Thread sandbox + code context through implement phase

## Context

The LLM agent in the implement phase runs blind. The `executeAgentStep` activity receives only `{ taskId, objective, plan, model, budgetCents, maxSteps, wallClockTimeoutMs }`. The worker then constructs an `AgentConfig` with `containerId: ""`, `repoMap: []`, `relevantFiles: []`, `policies: []`. Every tool call fails (Docker can't exec into container `""`), the state fingerprint never changes, and the `no_progress` guardrail trips after 3 steps in ~2.2 seconds.

The infrastructure is working (repo cloned, sandbox provisioned, Temporal orchestrating). The problem is that the data doesn't cross the `executeAgentStep` activity boundary.

Secondary: the orchestrator's main loop has no try/catch, so child workflow failures skip cleanup (sandbox leak, task state stuck as `in_progress`). And audit entries are computed during agent execution but dropped from the activity return.

## Changes

### 1. `packages/temporal-workflows/src/activity-types.ts`

**Extend `AgentStepConfig`** (line 216) — add 4 fields:
```
containerId: string
repoMap: readonly RepoMapEntryData[]
relevantFiles: readonly FileContentData[]
policies: readonly PolicyConfig[]
```
All referenced types already exist in this file. `PolicyConfig` is imported from core at line 15. `RepoMapEntryData` at line 242. `FileContentData` at line 271.

**Extend `AgentStepResult`** (line 226) — add audit trail:
```
auditEntries?: readonly LLMCallAuditEntryData[]
```
Define new `LLMCallAuditEntryData` interface (mirrors `LLMCallAuditEntry` from core with only the serializable fields: `model`, `provider`, `inputTokens`, `outputTokens`, `costCents`, `latencyMs`, `taskId`, `phase`, `finishReason`, `contentHash`).

### 2. `packages/temporal-workflows/src/index.ts`

Add `LLMCallAuditEntryData` to the re-export list at line 82-142.

### 3. `packages/temporal-workflows/src/phases/implement.ts`

**Extend `ImplementInput`** (line 55) — add:
```
repoMap: readonly RepoMapEntryData[]
policies: readonly PolicyConfig[]
```
Import `RepoMapEntryData`, `PolicyConfig` from `../activity-types.js`.

**Update `executeAgentStep` call** (line 148) — pass new fields:
```typescript
containerId: input.sandbox.containerId,
repoMap: input.repoMap,
relevantFiles: [],  // agent reads via sandbox file_read tool
policies: input.policies,
```

### 4. `packages/temporal-workflows/src/orchestrator.ts`

**Thread context to implement phase** (line 440-462) — add to the `executeChild` args:
```typescript
repoMap: understandResult?.repoMap ?? [],
policies: trustedContext?.policySnapshot ?? [],
```

**Wrap main loop in try/catch** (lines 295-860):
```typescript
let failureReason: string | undefined;
try {
  for (let i = startIdx; ...) { /* existing loop body */ }
} catch (error) {
  currentState = "failed";
  failureReason = error instanceof Error ? error.message : String(error);
}
// existing cleanup block runs unconditionally after this
```

Update the `transitionTaskState` call in cleanup (line 918) to include `failureReason` in the audit content when present.

### 5. `packages/temporal-activities/src/llm/activities.ts`

**Extend local `AgentStepConfig`** (line 10) — add same 4 fields, using local types:
```
containerId: string
repoMap: readonly RepoMapEntry[]      (from ../indexing/types.js — already imported)
relevantFiles: readonly FileContent[] (from ./context.js — already imported)
policies: readonly PolicyConfig[]     (from @software-factory/core)
```

**Extend local `AgentStepResult`** (line 20) — add `auditEntries`.

**Add containerId validation** at top of `executeAgentStep`:
```typescript
if (!stepConfig.containerId) {
  throw ApplicationFailure.nonRetryable(
    "Cannot execute agent: no sandbox container (containerId is empty)",
    "MISSING_SANDBOX",
  );
}
```

**Include `auditEntries`** in the return object (line 54):
```typescript
auditEntries: value.auditEntries,
```

### 6. `packages/worker/src/worker.ts`

**Update `createAgentConfig`** (line 80-115) — use real data from `stepConfig`:
```typescript
const instance = {
  containerId: stepConfig.containerId,  // was: ""
  phase: "execution" as const,
  labels: {},
};
// ...
return {
  ...
  repoMap: stepConfig.repoMap,              // was: []
  relevantFiles: stepConfig.relevantFiles,  // was: []
  policies: stepConfig.policies,            // was: []
  ...
};
```

Remove the unnecessary dynamic `import("@software-factory/temporal-activities")` calls — the functions are already available in scope from the top-level imports.

### 7. Tests

**`packages/temporal-workflows/__tests__/implement-phase.test.ts`** — add `repoMap` and `policies` to `baseInput` (line 64):
```typescript
repoMap: [],
policies: [],
```

## Files modified (summary)

| File | What changes |
|------|-------------|
| `activity-types.ts` | `AgentStepConfig` +4 fields, `AgentStepResult` +1 field, new `LLMCallAuditEntryData` |
| `index.ts` (workflows) | Add `LLMCallAuditEntryData` to re-exports |
| `implement.ts` (phase) | `ImplementInput` +2 fields, pass context to `executeAgentStep` |
| `orchestrator.ts` | Pass repoMap/policies to implement, try/catch around main loop |
| `activities.ts` (LLM) | Local types match, containerId validation, return auditEntries |
| `worker.ts` | Use real containerId/repoMap/policies from stepConfig |
| `implement-phase.test.ts` | Add repoMap/policies to baseInput |

## Out of scope (flagged for separate work)

- **Index persistence duplicate-append bug** (`index-repository.ts:58`): Returns existing version for same repo+SHA, then appends duplicate files/symbols. Needs its own fix with different scope.
- **Empty understand results**: If the test repo has no supported-language files, the indexer produces empty repoMap. The agent would get an empty repoMap but at least have a working sandbox and can explore via tools.
- **Relevant file contents**: The understand phase returns file paths, not contents. The agent can read files on-demand via `file_read`. Eagerly loading file contents into the Temporal payload is a future optimization.

## Verification

1. `pnpm run typecheck` — all packages pass
2. `pnpm run test` — existing tests pass with updated baseInput
3. Manual E2E: submit a task, verify in Temporal UI that `executeAgentStep` receives non-empty `containerId` and `repoMap`; verify the agent can read files in the sandbox
4. Failure path: kill the sandbox container mid-run → verify orchestrator catches the error, transitions task to `failed`, and destroys sandbox
