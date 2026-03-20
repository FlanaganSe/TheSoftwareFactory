# Research: Why `cloneRepo` Is Not Registered as a Worker Activity

## Root Cause

The `cloneRepo` activity is defined inside `createGitHubActivities()`, which is only instantiated when `config.githubAppId` is truthy. When `GITHUB_APP_ID` is not set, the worker registers `githubActivities = {}` (an empty object), so **zero GitHub activities** are registered -- including `cloneRepo`.

**The critical conditional** (`packages/worker/src/worker.ts:59-71`):
```ts
const githubActivities = config.githubAppId
  ? createGitHubActivities({...})
  : {};
```

When this falls through to `{}`, the spread `...githubActivities` at line 166 contributes nothing to the activities map. Then when the understand phase calls `githubActivities.cloneRepo(...)`, Temporal cannot find it.

## Question 1: Where is `cloneRepo` defined?

**Implementation location:** `packages/temporal-activities/src/github/branch.ts:171-204`

It lives inside the `createBranchActivities()` factory, which is called by `createGitHubActivities()`.

**Wrapper location:** `packages/temporal-activities/src/github/activities.ts:138-146`

The `createGitHubActivities()` function wraps the branch activity's `cloneRepo`, adding `ApplicationFailure` error handling.

## Question 2: What does `cloneRepo` actually do?

Full implementation at `packages/temporal-activities/src/github/branch.ts:171-204`:

1. Gets a GitHub App installation token via `deps.credentialBroker.getToken("implementation")`
2. Constructs a clone URL: `https://x-access-token:{token}@github.com/{owner}/{repo}.git`
3. Creates the target directory if it doesn't exist (`mkdirSync`)
4. Runs `git clone --depth 1 {cloneUrl} {targetPath}` via `execFileSync` (120s timeout)
5. Runs `git rev-parse HEAD` to get the head SHA
6. Returns `{ path: targetPath, headSha }`

**Yes, it requires the CredentialBroker.** It calls `deps.credentialBroker.getToken("implementation")` to get the token used for authentication in the clone URL. Without a valid `CredentialBroker`, this function cannot work.

The `"implementation"` phase permissions are: `{ contents: "write", checks: "write" }` (from `packages/temporal-activities/src/github/credential-broker.ts:22`). However, `cloneRepo` only needs `contents: "read"`. This is a minor over-privilege, but not the bug.

## Question 3: How does the understand phase proxy it?

File: `packages/temporal-workflows/src/phases/understand.ts:29-32`

```ts
const githubActivities = proxyActivities<GitHubActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});
```

Then called at line 86-90:
```ts
const cloneResult = await githubActivities.cloneRepo(
  input.repoOwner,
  input.repoName,
  input.repoPath,
);
```

It is proxied as part of the `GitHubActivities` type interface. The `proxyActivities<GitHubActivities>()` call creates a proxy where any method access (e.g., `.cloneRepo`) schedules a Temporal activity with that name. The activity must be registered on the worker for Temporal to dispatch it.

## Question 4: What activity types exist in `activity-types.ts`?

File: `packages/temporal-workflows/src/activity-types.ts`

Complete list of interfaces (all type-only, no runtime code):

| Interface | Methods |
|---|---|
| `TaskActivities` (line 65) | `createTask`, `transitionTaskState`, `getTask`, `listActiveTasks` |
| `AuditActivities` (line 79) | `insertAuditEntry` |
| `SafetyActivities` (line 109) | `checkKillSwitch`, `checkCostBudget`, `acquireBranchLease`, `releaseBranchLease`, `renewBranchLease`, `recordCost` |
| `SandboxActivities` (line 167) | `provisionSandbox`, `execInSandbox`, `destroySandbox`, `cleanupOrphans` |
| `GitHubActivities` (line 186) | `scanRepository`, `captureTrustedContext`, `createCandidateBranch`, `pushChanges`, **`cloneRepo`** |
| `LLMActivities` (line 236) | `executeAgentStep` |
| `IndexActivities` (line 260) | `indexRepositoryActivity` |
| `PlanActivities` (line 276) | `generatePlan` |
| `ValidationActivities` (line 350) | `runTests`, `runLinter`, `runSecurityScan`, `computeBlastRadius`, `checkValidatorBoundary`, `getChangedFiles` |
| `EvidenceActivities` (line 484) | `generateAndPersistEvidence` |
| `PRActivities` (line 569) | `createPullRequest`, `updatePullRequest` |
| `CheckRunActivities` (line 642) | `createFactoryCheckRun`, `updateCheckRun`, `uploadSarif` |
| `AutoMergeActivities` (line 662) | `enableAutoMerge`, `enqueuePullRequest` |
| `ReviewStateActivities` (line 705) | `createReviewState`, `getReviewState`, `updateReviewState` |
| `ReviewTrackerActivities` (line 736) | `reconcilePRState` |
| `MergeActivities` (line 789) | `checkMergeReadiness`, `mergePullRequest`, `deleteBranch` |
| `LearnActivities` (line 813) | `recordTaskMetrics` |
| `BroadReconcilerActivities` (line 828) | `reconcileAllResources`, `reconcileActivePRs` |

`cloneRepo` is defined in `GitHubActivities` at lines 207-211.

## Question 5: Full conditional structure for GitHub activities in worker

File: `packages/worker/src/worker.ts:58-71`

```ts
// GitHub activities (requires App credentials)
const githubActivities = config.githubAppId
  ? createGitHubActivities({
      credentialBroker: new CredentialBroker(
        config.githubAppId,
        config.githubPrivateKey ?? "",
        config.githubInstallationId ?? 0,
      ),
      serializer: new MutationSerializer(),
      installationId: config.githubInstallationId ?? 0,
      db,
      apiUrl: config.apiUrl,
    })
  : {};
```

**`cloneRepo` IS bundled with the credential-dependent activities.** There is no separate registration path. When `GITHUB_APP_ID` is absent, `cloneRepo` (along with `scanRepository`, `captureTrustedContext`, `createCandidateBranch`, `pushChanges`, and all PR/merge/check-run activities) are all missing.

## Question 6: Does `cloneRepo` genuinely need the CredentialBroker?

**Yes.** Looking at `packages/temporal-activities/src/github/branch.ts:171-204`:

```ts
async cloneRepo(owner, repo, targetPath) {
  const token = await deps.credentialBroker.getToken("implementation");
  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  // ... git clone --depth 1 ...
}
```

The `CredentialBroker` is the only way to get the token. The `cloneRepo` function **cannot work without it** because:
- It authenticates via the GitHub App installation token
- Private repos require authentication
- Even public repos use the token (the URL is constructed unconditionally)

The dependency chain is: `cloneRepo` -> `createBranchActivities(deps)` -> `deps.credentialBroker.getToken("implementation")` -> `CredentialBroker` -> requires `appId`, `privateKey`, `installationId`.

## Question 7: Does `cloneRepo` exist in any other activity factory?

**No.** Searched the entire codebase. `cloneRepo` only exists in:
- `createBranchActivities()` in `packages/temporal-activities/src/github/branch.ts` (implementation)
- `createGitHubActivities()` in `packages/temporal-activities/src/github/activities.ts` (wrapper)
- Various test mocks and the E2E mock

There is no separate factory that registers it independently.

## Question 8: E2E mock activities

File: `packages/e2e/src/setup/mock-activities.ts:364-370`

```ts
async cloneRepo(
  _owner: string,
  _repo: string,
  targetPath: string,
): Promise<{ path: string; headSha: string }> {
  return { path: targetPath, headSha: "abc123def456" };
},
```

The mock is a flat function in `createMockActivities()` -- not nested under any "github" namespace. It returns a simple stub with the `headSha` matching `MOCK_TRUSTED_CONTEXT.baseSha`. In the E2E test environment, ALL activities (task, audit, safety, github, index, plan, sandbox, validation, evidence, PR, merge, learn) are registered as a single flat object, so `cloneRepo` IS always available in E2E tests.

## Diagnosis Summary

**The bug is straightforward:** `cloneRepo` is correctly defined, correctly implemented, and correctly proxied in the workflow. But it only gets registered when `GITHUB_APP_ID` is set, because it's bundled inside `createGitHubActivities()`.

**This is not a "separation of concerns" issue** -- `cloneRepo` genuinely needs the `CredentialBroker` to authenticate. It cannot be extracted to a credential-free factory without also providing an alternative authentication mechanism.

## Fix Options

### Option A: Ensure `GITHUB_APP_ID` is set (operational fix)
Simply ensure the environment has `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, and `GITHUB_INSTALLATION_ID` configured. Without these, the entire understand phase (and all subsequent phases that use GitHub) cannot function anyway, since `scanRepository` and `captureTrustedContext` are also inside the same conditional.

**This is arguably the correct fix** -- the factory is useless without GitHub App credentials, so the worker should require them or fail fast at startup.

### Option B: Fail fast at worker startup if GitHub credentials are missing
Add validation in `createWorker()` or `loadWorkerConfig()` that requires `GITHUB_APP_ID` (and friends) to be set, or at minimum log a clear warning that GitHub activities will be unavailable.

### Option C: Separate `cloneRepo` from the credential-gated activities
This would require `cloneRepo` to accept a token directly or support an alternative auth mechanism (e.g., SSH key, personal access token). This is a larger refactor and arguably wrong -- the current design correctly gates all GitHub operations behind App credentials.

## Key Files

| File | Lines | Purpose |
|---|---|---|
| `packages/temporal-activities/src/github/branch.ts` | 171-204 | `cloneRepo` implementation |
| `packages/temporal-activities/src/github/activities.ts` | 62-391 | `createGitHubActivities` factory (contains `cloneRepo` wrapper at 138-146) |
| `packages/temporal-workflows/src/phases/understand.ts` | 29-32, 86-90 | Proxy definition and `cloneRepo` call |
| `packages/temporal-workflows/src/activity-types.ts` | 186-212 | `GitHubActivities` interface (type definition for proxy) |
| `packages/worker/src/worker.ts` | 58-71 | Conditional registration (the root cause) |
| `packages/worker/src/config.ts` | 7, 35 | `githubAppId` config field, loaded from `GITHUB_APP_ID` env var |
| `packages/temporal-activities/src/github/credential-broker.ts` | 53-103 | `CredentialBroker` class used by `cloneRepo` |
| `packages/e2e/src/setup/mock-activities.ts` | 364-370 | E2E mock (always registered, so E2E tests pass) |
