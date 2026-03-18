# Temporal TypeScript SDK -- Research for Software Factory Control Plane

**Date:** 2026-03-18
**Scope:** Deep investigation of the Temporal TypeScript SDK for building a durable-execution control plane that orchestrates AI-assisted software engineering tasks through a 13-step workflow.

---

## 1. SDK Version & Compatibility

### Current Versions (as of March 2026)

| Package | Latest Version | Notes |
|---------|---------------|-------|
| `@temporalio/workflow` | 1.14.0 | |
| `@temporalio/activity` | 1.14.1 | |
| `@temporalio/client` | 1.15.0 | |
| `@temporalio/worker` | (matches above) | |
| `@temporalio/testing` | (matches above) | |
| `temporalio` | (umbrella) | |

**All `@temporalio/*` packages in a project must have the same version number.** This is enforced by peer dependencies but requires care in monorepos.

**Node.js support:** 20, 22, 24. Node 18 was dropped in v1.15.0.

### Key Recent Changes

- **v1.15.0** (Feb 2025): Poller autoscaling exponential backoff fix, Bun runtime support (experimental), Node 18 dropped.
- **v1.14.0** (Dec 2024): Experimental AI SDK integration, TLS auto-enabled with API key, worker heartbeating for smooth shutdown.
- **v1.13.0** (Aug 2024): Experimental Nexus support, fairness keys.

**Source:** [Releases on GitHub](https://github.com/temporalio/sdk-typescript/releases)

---

## 2. Workflow Design Patterns

### 2.1 Per-Phase Workflows with Continue-As-New

The software factory's 13-step workflow maps naturally to **per-phase workflows** connected by Continue-As-New or parent-child orchestration. The key constraint is the **51,200 event / 50 MB hard limit** per workflow execution.

**Event budget estimation:**
- Basic workflow start/complete: ~5 events
- Each activity (schedule + start + complete): ~6 events
- Each timer (schedule + fire): ~5 events
- A single signal: ~2 events

An "implement" phase that runs 50 LLM calls + 20 file operations + 10 git operations = ~480 events. This is well within limits, but a long-running task with iteration loops can grow quickly.

**Recommendation:** Use `workflowInfo().continueAsNewSuggested` as the primary trigger, with a secondary check at `historyLength > 10_000` for safety.

### 2.2 Continue-As-New Pattern (TypeScript)

```typescript
import * as wf from '@temporalio/workflow';

export interface PhaseState {
  taskId: string;
  phase: 'implement' | 'validate' | 'review';
  iterationCount: number;
  accumulatedState: Record<string, unknown>;
}

export async function implementPhaseWorkflow(state: PhaseState): Promise<PhaseState> {
  // Re-register all signal/query/update handlers immediately
  let reviewDecision: 'approve' | 'reject' | 'request-changes' | undefined;
  wf.setHandler(reviewDecisionSignal, (decision) => { reviewDecision = decision; });
  wf.setHandler(taskStateQuery, () => state);

  // Phase logic with iteration loop
  for (let i = state.iterationCount; i < MAX_ITERATIONS; i++) {
    // Check continue-as-new before each iteration
    if (wf.workflowInfo().continueAsNewSuggested || wf.workflowInfo().historyLength > 10_000) {
      // Drain pending handlers before continuing
      await wf.condition(wf.allHandlersFinished);
      return await wf.continueAsNew<typeof implementPhaseWorkflow>({
        ...state,
        iterationCount: i,
      });
    }

    // Do work...
    await runImplementationStep(state);
    state.iterationCount = i + 1;
  }

  return state;
}
```

**Critical rules for Continue-As-New:**
1. Never call `continueAsNew` from inside a signal/update handler -- only from the main workflow function.
2. Always `await wf.condition(wf.allHandlersFinished)` before calling `continueAsNew` to drain pending handlers.
3. Re-register all handlers immediately at workflow start (they do not survive Continue-As-New).
4. Design workflow parameters to be self-contained -- the new execution receives only what you pass.
5. Omit Run ID when sending signals/queries to target the currently active execution in the chain.

**Source:** [Continue-As-New docs](https://docs.temporal.io/develop/typescript/continue-as-new), [Entity pattern docs](https://docs.temporal.io/develop/typescript/entity-pattern)

### 2.3 Phase Handoff Strategies

There are two viable approaches for connecting phases:

**Option A: Parent orchestrator + child workflows per phase**
```typescript
export async function taskOrchestrator(taskId: string): Promise<void> {
  const intakeResult = await executeChild(intakePhaseWorkflow, { args: [{ taskId }] });
  const implResult = await executeChild(implementPhaseWorkflow, { args: [intakeResult] });
  const validResult = await executeChild(validatePhaseWorkflow, { args: [implResult] });
  // ... etc
}
```
- Parent tracks overall lifecycle; each child is a phase.
- Parent can receive signals and route them to the correct child.
- Risk: parent accumulates events for each child start/complete (~8 events per child). With 13 phases, that is ~104 events for the parent -- well within limits.

**Option B: Sequential Continue-As-New with phase transitions**
```typescript
export async function taskWorkflow(state: TaskState): Promise<void> {
  switch (state.phase) {
    case 'intake': state = await runIntake(state); break;
    case 'implement': state = await runImplement(state); break;
    // ...
  }
  state.phase = nextPhase(state.phase);
  await wf.continueAsNew<typeof taskWorkflow>(state);
}
```
- Single workflow ID for the entire task lifecycle.
- Simpler client interaction (one handle per task).
- Risk: must carefully manage state serialization size (2 MB arg limit).

**Recommendation for the software factory:** Use **Option A** (parent orchestrator). Reasons:
- Each phase has distinct timeout and retry characteristics (LLM-heavy vs. git-heavy vs. human-wait).
- The parent workflow is a clean state machine with minimal event accumulation.
- Child workflows can be individually queried, signaled, and cancelled.
- Phase-specific task queues allow dedicated worker pools (see Section 6).

### 2.4 Child Workflow Patterns

```typescript
import { startChild, executeChild } from '@temporalio/workflow';

// Fire-and-forget with handle (for long-running phases)
const childHandle = await startChild(implementPhaseWorkflow, {
  workflowId: `task-${taskId}-implement`,
  args: [phaseState],
  parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
  cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
});

// Signal the child
await childHandle.signal(killSwitchSignal);

// Await result
const result = await childHandle.result();
```

**Source:** [Child workflow docs](https://docs.temporal.io/develop/typescript/child-workflows)

---

## 3. Activity Design

### 3.1 Activity Proxy Configuration

Different activity types need different timeout/retry profiles. Use separate `proxyActivities` calls:

```typescript
// Fast DB writes -- short timeout, standard retry
const dbActivities = proxyActivities<typeof import('./activities/db')>({
  startToCloseTimeout: '30s',
  retry: { initialInterval: '1s', maximumAttempts: 5 },
});

// LLM API calls -- long timeout, generous retry with backoff
const llmActivities = proxyActivities<typeof import('./activities/llm')>({
  startToCloseTimeout: '5m',
  scheduleToCloseTimeout: '30m',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumAttempts: 8 },
});

// GitHub API calls -- medium timeout, rate-limit-aware retry
const githubActivities = proxyActivities<typeof import('./activities/github')>({
  startToCloseTimeout: '2m',
  retry: { initialInterval: '2s', backoffCoefficient: 2, maximumAttempts: 10 },
});

// Docker container management -- long timeout with heartbeats
const dockerActivities = proxyActivities<typeof import('./activities/docker')>({
  startToCloseTimeout: '15m',
  heartbeatTimeout: '30s',
  retry: { initialInterval: '5s', maximumAttempts: 3 },
});
```

### 3.2 Idempotent Activity Pattern

Activities that write to Postgres must be idempotent. The standard pattern uses an idempotency key:

```typescript
// activities/db.ts
import { Context } from '@temporalio/activity';

export interface DB {
  query(sql: string, params: unknown[]): Promise<unknown>;
}

export const createDbActivities = (db: DB) => ({
  async updateTaskState(input: {
    taskId: string;
    newState: string;
    idempotencyKey: string;
  }): Promise<void> {
    // INSERT ... ON CONFLICT ensures idempotency
    await db.query(
      `INSERT INTO task_state_transitions (task_id, state, idempotency_key, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.taskId, input.newState, input.idempotencyKey]
    );
    // Update current state only if transition is valid
    await db.query(
      `UPDATE tasks SET state = $2, updated_at = NOW()
       WHERE id = $1 AND state = ANY($3)`,
      [input.taskId, input.newState, validPriorStates(input.newState)]
    );
  },

  async recordEvidence(input: {
    taskId: string;
    evidenceType: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<void> {
    await db.query(
      `INSERT INTO evidence_packets (task_id, evidence_type, payload, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.taskId, input.evidenceType, JSON.stringify(input.payload), input.idempotencyKey]
    );
  },
});
```

### 3.3 Activity Dependency Injection

Activities run in standard Node.js (not the deterministic sandbox). Use the factory pattern to inject dependencies:

```typescript
// worker.ts
import { Worker } from '@temporalio/worker';
import { createDbActivities } from './activities/db';
import { createGithubActivities } from './activities/github';
import { createLlmActivities } from './activities/llm';

const db = createPool({ connectionString: process.env.DATABASE_URL });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const llmClient = new OpenRouterClient({ apiKey: process.env.OPENROUTER_KEY });

const worker = await Worker.create({
  workflowsPath: require.resolve('./workflows'),
  taskQueue: 'software-factory',
  activities: {
    ...createDbActivities(db),
    ...createGithubActivities(octokit),
    ...createLlmActivities(llmClient),
  },
});
```

### 3.4 Heartbeating for Long-Running Activities

LLM calls and Docker container operations should heartbeat to report progress and enable cancellation:

```typescript
import { heartbeat, activityInfo, CancelledFailure } from '@temporalio/activity';

export async function runLlmCompletion(input: {
  prompt: string;
  model: string;
}): Promise<string> {
  const startingChunk = activityInfo().heartbeatDetails?.chunkIndex ?? 0;

  // Stream response and heartbeat periodically
  let response = '';
  let chunkIndex = 0;
  for await (const chunk of streamLlmResponse(input)) {
    if (chunkIndex < startingChunk) { chunkIndex++; continue; } // Resume from checkpoint
    response += chunk;
    chunkIndex++;
    if (chunkIndex % 10 === 0) {
      heartbeat({ chunkIndex }); // Checkpoint progress
    }
  }
  return response;
}
```

### 3.5 Non-Retryable Errors

```typescript
import { ApplicationFailure } from '@temporalio/activity';

// Validation errors should not be retried
if (!isValidBranch(branchName)) {
  throw ApplicationFailure.create({
    message: `Invalid branch name: ${branchName}`,
    type: 'ValidationError',
    nonRetryable: true,
  });
}

// Rate limit with custom retry delay
if (response.status === 429) {
  const retryAfter = parseInt(response.headers['retry-after'] ?? '60');
  throw ApplicationFailure.create({
    message: 'GitHub API rate limited',
    type: 'RateLimitError',
    nextRetryDelay: `${retryAfter}s`,
  });
}
```

**Sources:** [Core application docs](https://docs.temporal.io/develop/typescript/core-application), [Failure detection docs](https://docs.temporal.io/develop/typescript/failure-detection), [Activity timeouts blog](https://temporal.io/blog/activity-timeouts)

---

## 4. Signal / Query / Update Patterns

### 4.1 Defining Message Types

```typescript
import * as wf from '@temporalio/workflow';

// Signals (async, fire-and-forget, no return value)
export const reviewDecisionSignal = wf.defineSignal<[{
  decision: 'approve' | 'reject' | 'request-changes';
  reviewer: string;
  comments?: string;
}]>('reviewDecision');

export const killSwitchSignal = wf.defineSignal<[{ reason: string }]>('killSwitch');

// Queries (sync, read-only, must not block or mutate)
export const taskStateQuery = wf.defineQuery<TaskState>('taskState');
export const phaseProgressQuery = wf.defineQuery<PhaseProgress>('phaseProgress');

// Updates (sync write with optional validator, can return values)
export const reassignTaskUpdate = wf.defineUpdate<
  { previousAssignee: string },  // return type
  [{ newAssignee: string }]       // args
>('reassignTask');
```

### 4.2 Human-in-the-Loop Review Pattern

This is the core pattern for the software factory's approval flow:

```typescript
export async function reviewPhaseWorkflow(state: ReviewState): Promise<ReviewResult> {
  let reviewDecision: ReviewDecision | undefined;
  let killSwitchTriggered = false;

  // Signal: human review decision
  wf.setHandler(reviewDecisionSignal, (input) => {
    reviewDecision = input;
  });

  // Signal: emergency kill switch
  wf.setHandler(killSwitchSignal, (input) => {
    killSwitchTriggered = true;
    state.killReason = input.reason;
  });

  // Query: current state (read-only, sync, cannot be async)
  wf.setHandler(taskStateQuery, () => state);

  // Update with validator: reassign task (sync write, returns previous assignee)
  wf.setHandler(
    reassignTaskUpdate,
    (input) => {
      const previous = state.assignee;
      state.assignee = input.newAssignee;
      return { previousAssignee: previous };
    },
    {
      validator: (input) => {
        if (!isValidUser(input.newAssignee)) {
          throw new Error(`Unknown user: ${input.newAssignee}`);
        }
      },
    }
  );

  // Present evidence and wait for human decision (with timeout)
  await presentEvidence(state);

  const gotDecision = await wf.condition(
    () => reviewDecision !== undefined || killSwitchTriggered,
    '7 days' // timeout waiting for human
  );

  if (!gotDecision) {
    // Timed out waiting for human -- escalate
    await escalateTimeout(state);
    return { outcome: 'timeout', state };
  }

  if (killSwitchTriggered) {
    return { outcome: 'killed', state };
  }

  // Drain all pending handlers before completing
  await wf.condition(wf.allHandlersFinished);

  return { outcome: reviewDecision!.decision, state };
}
```

### 4.3 Client-Side Interaction

```typescript
import { Client, WorkflowUpdateStage } from '@temporalio/client';

const client = new Client({ /* connection */ });
const handle = client.workflow.getHandle(`task-${taskId}-review`);

// Query current state (instant, read-only)
const state = await handle.query(taskStateQuery);

// Send signal (fire-and-forget)
await handle.signal(reviewDecisionSignal, {
  decision: 'approve',
  reviewer: 'sean',
  comments: 'LGTM',
});

// Send update (wait for completion, get return value)
const { previousAssignee } = await handle.executeUpdate(reassignTaskUpdate, {
  args: [{ newAssignee: 'alice' }],
});

// Start update but don't wait for completion
const updateHandle = await handle.startUpdate(reassignTaskUpdate, {
  args: [{ newAssignee: 'bob' }],
  waitForStage: WorkflowUpdateStage.ACCEPTED,
});
const result = await updateHandle.result();
```

### 4.4 Concurrent Handler Safety

When multiple signals/updates might arrive concurrently, use `async-mutex`:

```typescript
import { Mutex } from 'async-mutex';

export async function implementPhaseWorkflow(state: PhaseState): Promise<void> {
  const lock = new Mutex();

  wf.setHandler(feedbackSignal, async (feedback) => {
    await lock.runExclusive(async () => {
      // Only one handler instance executes this section at a time
      state.feedback.push(feedback);
      await recordFeedback(feedback);
    });
  });
}
```

**Note:** `async-mutex` is safe in the workflow sandbox because it does not use non-deterministic APIs.

**Sources:** [Message passing docs](https://docs.temporal.io/develop/typescript/message-passing), [Workflow message passing encyclopedia](https://docs.temporal.io/encyclopedia/workflow-message-passing)

---

## 5. Error Handling

### 5.1 Temporal Error Hierarchy

| Error Type | When | Retry? |
|-----------|------|--------|
| `ApplicationFailure` | Thrown from activity/workflow code | Retryable by default; set `nonRetryable: true` to stop |
| `ActivityFailure` | Wraps activity errors in workflows | Inspect `.cause` for the underlying `ApplicationFailure` |
| `ChildWorkflowFailure` | Child workflow failed/cancelled | Inspect `.cause` for details |
| `CancelledFailure` | Workflow or activity was cancelled | Not retried |
| `TimeoutFailure` | Activity or workflow timed out | Retried per retry policy |

### 5.2 Error Handling in Workflows

```typescript
import { ActivityFailure, ApplicationFailure, isCancellation } from '@temporalio/workflow';

try {
  await callLlmActivity(prompt);
} catch (err) {
  if (isCancellation(err)) {
    // Workflow was cancelled -- run cleanup in non-cancellable scope
    await CancellationScope.nonCancellable(() => cleanup());
    throw err;
  }
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure) {
    if (err.cause.type === 'RateLimitError') {
      // Handle rate limiting -- maybe wait and retry at workflow level
      await wf.sleep(err.cause.message); // or a fixed duration
    } else if (err.cause.type === 'ValidationError') {
      // Non-retryable -- transition to failed state
      state.status = 'failed';
      state.failureReason = err.cause.message;
    }
  }
  throw err;
}
```

### 5.3 Circuit Breaker / Kill Switch Pattern

Temporal does not have a built-in circuit breaker. Implement it as a workflow-level check:

**Strategy A: Signal-based kill switch (recommended for the software factory)**

```typescript
export async function implementPhaseWorkflow(state: PhaseState): Promise<PhaseState> {
  let killed = false;
  let killReason = '';

  wf.setHandler(killSwitchSignal, (input) => {
    killed = true;
    killReason = input.reason;
  });

  // Check before every activity invocation
  function checkKillSwitch(): void {
    if (killed) {
      throw ApplicationFailure.create({
        message: `Kill switch activated: ${killReason}`,
        type: 'KillSwitchError',
        nonRetryable: true,
      });
    }
  }

  for (const step of executionPlan) {
    checkKillSwitch();
    await executeStep(step);
    state.completedSteps.push(step);
    checkKillSwitch();
  }

  return state;
}
```

**Strategy B: External circuit breaker state via query activity**

```typescript
// Check an external flag (e.g., from Postgres or Redis) at each step
const { checkCircuitBreaker } = proxyActivities<typeof import('./activities/circuit-breaker')>({
  startToCloseTimeout: '5s',
  retry: { maximumAttempts: 2 },
});

// In workflow:
for (const step of executionPlan) {
  const { open, reason } = await checkCircuitBreaker({ taskId: state.taskId });
  if (open) {
    throw ApplicationFailure.create({
      message: `Circuit breaker open: ${reason}`,
      type: 'CircuitBreakerOpen',
      nonRetryable: true,
    });
  }
  await executeStep(step);
}
```

The signal-based approach (Strategy A) is preferred because it does not consume activity events in the history and is instantaneous. The activity-based approach (Strategy B) is useful when the kill switch needs to be system-wide across multiple workflows.

### 5.4 Self-Healing Guardrails

```typescript
// Max iteration limiter
const MAX_ITERATIONS = 50;
if (state.iterationCount >= MAX_ITERATIONS) {
  throw ApplicationFailure.create({
    message: `Max iterations (${MAX_ITERATIONS}) exceeded`,
    type: 'MaxIterationsExceeded',
    nonRetryable: true,
  });
}

// No-progress detector
if (state.lastProgressAt && (Date.now() - state.lastProgressAt > NO_PROGRESS_TIMEOUT_MS)) {
  // Note: use wf.currentTimeMs() in workflows, not Date.now()
  // Date.now() is replaced by a deterministic version in the sandbox
}

// Cost budget check (via activity)
const { totalCost } = await checkCostBudget({ taskId: state.taskId });
if (totalCost > state.costBudget) {
  throw ApplicationFailure.create({
    message: `Cost budget exceeded: $${totalCost} > $${state.costBudget}`,
    type: 'CostBudgetExceeded',
    nonRetryable: true,
  });
}
```

**Source:** [Cancellation docs](https://docs.temporal.io/develop/typescript/cancellation)

---

## 6. Testing

### 6.1 Test Framework Setup

```bash
npm install --save-dev @temporalio/testing
```

The testing package downloads a lightweight test server with time-skipping support. Compatible with Jest and Mocha.

### 6.2 Unit Testing Activities

```typescript
import { MockActivityEnvironment } from '@temporalio/testing';
import { createDbActivities } from './activities/db';

describe('updateTaskState', () => {
  it('writes state transition idempotently', async () => {
    const mockDb = { query: jest.fn().mockResolvedValue(undefined) };
    const activities = createDbActivities(mockDb);
    const env = new MockActivityEnvironment();

    await env.run(activities.updateTaskState, {
      taskId: 'task-1',
      newState: 'in_progress',
      idempotencyKey: 'key-1',
    });

    expect(mockDb.query).toHaveBeenCalledTimes(2); // INSERT + UPDATE
  });
});
```

### 6.3 Integration Testing Workflows with Mocked Activities

```typescript
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { v4 as uuid } from 'uuid';

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await testEnv?.teardown();
});

it('review phase times out after 7 days', async () => {
  const mockActivities = {
    presentEvidence: async () => {},
    escalateTimeout: async () => {},
  };

  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('./workflows/review-phase'),
    activities: mockActivities,
  });

  const result = await worker.runUntil(
    testEnv.client.workflow.execute(reviewPhaseWorkflow, {
      workflowId: uuid(),
      taskQueue: 'test',
      args: [initialReviewState],
    }),
  );

  expect(result.outcome).toBe('timeout');
});
```

### 6.4 Testing Signals and Queries

```typescript
it('approves task via signal', async () => {
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('./workflows/review-phase'),
    activities: mockActivities,
  });

  const handle = await testEnv.client.workflow.start(reviewPhaseWorkflow, {
    workflowId: uuid(),
    taskQueue: 'test',
    args: [initialReviewState],
  });

  // Run worker in background
  const workerPromise = worker.run();

  // Query current state
  const state = await handle.query(taskStateQuery);
  expect(state.phase).toBe('review');

  // Send approval signal
  await handle.signal(reviewDecisionSignal, {
    decision: 'approve',
    reviewer: 'sean',
  });

  const result = await handle.result();
  expect(result.outcome).toBe('approve');

  worker.shutdown();
  await workerPromise;
});
```

### 6.5 Replay Testing (Determinism Verification)

```typescript
import { Worker } from '@temporalio/worker';

it('replays without determinism errors', async () => {
  // Download history from a real execution
  const handle = client.workflow.getHandle('task-123-implement');
  const history = await handle.fetchHistory();

  // Replay against current code -- throws DeterminismViolationError if broken
  await Worker.runReplayHistory(
    { workflowsPath: require.resolve('./workflows') },
    history,
  );
});

// Bulk replay for CI
it('replays all recent workflow histories', async () => {
  const executions = client.workflow.list({
    query: 'TaskQueue="software-factory" AND StartTime > "2026-03-01T00:00:00"',
  });
  const histories = executions.intoHistories();
  const results = Worker.runReplayHistories(
    { workflowsPath: require.resolve('./workflows') },
    histories,
  );
  for await (const result of results) {
    if (result.error) {
      throw new Error(`Replay failed for ${result.workflowId}: ${result.error}`);
    }
  }
});
```

**Source:** [Testing suite docs](https://docs.temporal.io/develop/typescript/testing-suite)

---

## 7. Worker Configuration

### 7.1 Task Queue Strategy

Use separate task queues for different workload profiles:

| Task Queue | Activities | Characteristics |
|-----------|-----------|----------------|
| `sf-orchestration` | State transitions, lightweight coordination | Fast, high concurrency |
| `sf-llm` | LLM API calls | Slow (30s-5m), IO-bound, lower concurrency |
| `sf-docker` | Container management | Very slow (5-15m), heartbeat-heavy |
| `sf-github` | GitHub API calls | Medium speed, rate-limit sensitive |
| `sf-db` | Postgres writes | Fast, high concurrency |

### 7.2 Worker Configuration

```typescript
import { Worker } from '@temporalio/worker';

// Orchestration worker -- handles workflows + fast activities
const orchestrationWorker = await Worker.create({
  connection: nativeConnection,
  namespace: 'software-factory',
  taskQueue: 'sf-orchestration',
  workflowsPath: require.resolve('./workflows'),
  activities: { ...dbActivities, ...lightweightActivities },
  maxConcurrentWorkflowTaskExecutions: 100,
  maxConcurrentActivityTaskExecutions: 200,
  reuseV8Context: true, // default; significantly reduces memory
});

// LLM worker -- dedicated to slow LLM calls
const llmWorker = await Worker.create({
  connection: nativeConnection,
  namespace: 'software-factory',
  taskQueue: 'sf-llm',
  activities: { ...llmActivities },
  enableNonLocalActivities: true,
  maxConcurrentActivityTaskExecutions: 20, // LLM calls are expensive
  maxActivitiesPerSecond: 10, // Rate limit
  shutdownGraceTime: '30s', // Allow in-flight LLM calls to complete
});

// Docker worker -- dedicated to container management
const dockerWorker = await Worker.create({
  connection: nativeConnection,
  namespace: 'software-factory',
  taskQueue: 'sf-docker',
  activities: { ...dockerActivities },
  maxConcurrentActivityTaskExecutions: 5, // Limited by host resources
  defaultHeartbeatThrottleInterval: '10s',
});
```

### 7.3 Key WorkerOptions

| Option | Default | Purpose |
|--------|---------|---------|
| `maxConcurrentWorkflowTaskExecutions` | 40 | Workflow task parallelism |
| `maxConcurrentActivityTaskExecutions` | 100 | Activity task parallelism |
| `maxConcurrentLocalActivityExecutions` | 100 | Local activity parallelism |
| `maxConcurrentWorkflowTaskPolls` | min(10, executions) | Concurrent workflow pollers |
| `maxConcurrentActivityTaskPolls` | min(10, executions) | Concurrent activity pollers |
| `reuseV8Context` | true | Single V8 context (lower memory) |
| `maxCachedWorkflows` | varies | Workflow isolates kept in memory |
| `stickyQueueScheduleToStartTimeout` | 10s | Sticky queue timeout |
| `shutdownGraceTime` | 0 | Grace period before cancelling tasks |
| `maxActivitiesPerSecond` | unlimited | Worker-level rate limit |
| `maxTaskQueueActivitiesPerSecond` | unlimited | Server-side rate limit |

### 7.4 Resource-Based Auto-Tuning

For workloads where profiling is impractical, use the tuner:

```typescript
// Note: tuner is mutually exclusive with max* settings
const worker = await Worker.create({
  taskQueue: 'sf-llm',
  activities: { ...llmActivities },
  tuner: {
    targetMemoryUsage: 0.7,
    targetCpuUsage: 0.8,
  },
});
```

**Recommendation:** Start with fixed-size slot suppliers (explicit `maxConcurrent*` settings) for predictable behavior, then consider resource-based tuning once workload patterns are understood.

**Sources:** [Worker performance docs](https://docs.temporal.io/develop/worker-performance), [WorkerOptions API](https://typescript.temporal.io/api/interfaces/worker.WorkerOptions)

---

## 8. Deployment (Self-Hosted)

### 8.1 Components

A self-hosted Temporal deployment requires:

| Component | Purpose | Image |
|-----------|---------|-------|
| **Temporal Server** | Core workflow engine, gRPC frontend | `temporalio/server` (production) or `temporalio/auto-setup` (dev) |
| **PostgreSQL** | Persistence store (workflow state, history) | `postgres:16` |
| **Elasticsearch** (or OpenSearch) | Visibility store (workflow search, list, filter) | `elasticsearch:8.x` or `opensearchproject/opensearch:2.x` |
| **Temporal UI** | Web interface for monitoring | `temporalio/ui` |
| **Temporal Admin Tools** | CLI tools (tctl, temporal) | `temporalio/admin-tools` |

### 8.2 Docker Compose Setup

The official docker-compose files have moved from the archived `temporalio/docker-compose` repo to `temporalio/samples-server/compose/`.

Available configurations:

| File | Backend |
|------|---------|
| `docker-compose.yml` | PostgreSQL + Elasticsearch (default, recommended) |
| `docker-compose-postgres.yml` | PostgreSQL only (no advanced visibility) |
| `docker-compose-tls.yml` | PostgreSQL + Elasticsearch + TLS |
| `docker-compose-multirole.yaml` | Multi-role with Prometheus + Grafana |

```bash
git clone https://github.com/temporalio/samples-server.git
cd samples-server/compose
docker compose up
# gRPC: localhost:7233
# Web UI: localhost:8080
```

### 8.3 Production Considerations

1. **Use `temporalio/server` not `temporalio/auto-setup` in production.** The auto-setup image runs schema migrations on startup -- fine for dev, dangerous for production.
2. **Externalize the database.** Use a managed Postgres instance (RDS, Cloud SQL) for reliability.
3. **Elasticsearch is recommended** for any deployment handling more than a few workflows. It powers the visibility API (list, filter, search workflows).
4. **Resource requirements (minimum for dev):**
   - Temporal Server: 1 CPU, 1 GB RAM
   - PostgreSQL: 1 CPU, 1 GB RAM
   - Elasticsearch: 2 CPU, 2 GB RAM (256 MB heap)
   - Total minimum: ~4 CPU, 4 GB RAM
5. **TLS:** Use the TLS compose variant or terminate TLS at a reverse proxy (nginx) in front of the Temporal server.
6. **Dynamic configuration:** Mount a `dynamicconfig/` directory to tune server behavior at runtime.

### 8.4 Minimal docker-compose.yml for Development

```yaml
services:
  postgresql:
    image: postgres:16
    environment:
      POSTGRES_USER: temporal
      POSTGRES_PASSWORD: temporal
    ports:
      - "5432:5432"

  elasticsearch:
    image: elasticsearch:8.13.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms256m -Xmx256m
    ports:
      - "9200:9200"

  temporal:
    image: temporalio/auto-setup:latest
    depends_on:
      - postgresql
      - elasticsearch
    environment:
      - DB=postgres12
      - DB_PORT=5432
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=temporal
      - POSTGRES_SEEDS=postgresql
      - ENABLE_ES=true
      - ES_SEEDS=elasticsearch
      - ES_VERSION=v7
    ports:
      - "7233:7233"

  temporal-ui:
    image: temporalio/ui:latest
    depends_on:
      - temporal
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
    ports:
      - "8080:8080"
```

**Sources:** [Deployment docs](https://docs.temporal.io/self-hosted-guide/deployment), [samples-server compose](https://github.com/temporalio/samples-server/tree/main/compose)

---

## 9. Versioning & Determinism

### 9.1 Determinism Rules

Workflow code runs in a sandboxed V8 context where `Math.random()`, `Date`, and `setTimeout` are replaced with deterministic versions. Key constraints:

- No non-deterministic operations (random, current time via external APIs, UUID generation via `crypto`).
- No IO (network, filesystem, database) -- only through activities.
- All imports must be static.
- Class instances and functions are not serializable -- use plain objects and interfaces.

### 9.2 Patching for Safe Code Changes

When modifying workflow code that has in-flight executions:

```typescript
import { patched, deprecatePatch } from '@temporalio/workflow';

// Step 1: Deploy with feature flag
export async function implementPhaseWorkflow(state: PhaseState): Promise<PhaseState> {
  if (patched('v2-validation-step')) {
    // New code path
    await validateWithNewApproach(state);
  } else {
    // Old code path (for in-flight workflows)
    await validateWithOldApproach(state);
  }
}

// Step 2: After all old executions complete, deprecate
export async function implementPhaseWorkflow(state: PhaseState): Promise<PhaseState> {
  deprecatePatch('v2-validation-step');
  await validateWithNewApproach(state);
}

// Step 3: After retention period, remove patch entirely
export async function implementPhaseWorkflow(state: PhaseState): Promise<PhaseState> {
  await validateWithNewApproach(state);
}
```

**Replay testing is essential** to verify that code changes do not break determinism for in-flight workflows.

**Source:** [Versioning docs](https://docs.temporal.io/develop/typescript/versioning)

---

## 10. Patterns Specific to the Software Factory

### 10.1 Task Lifecycle State Machine

The task state machine maps cleanly to Temporal workflow state:

```
created -> assigned -> in_progress -> evidence_ready -> approved -> pr_created
  -> external_checks_pending -> merge_ready -> merged | failed
```

Additional states: `needs_clarification`, `changes_requested`, `addressing_review_feedback`, `external_blocked`.

**Implementation:** Store current state as a workflow variable. Use a `taskStateQuery` to expose it. Use signals for transitions triggered by external events (human review, GitHub webhook). Use activities for transitions triggered by internal logic.

### 10.2 Branch Lease with TTL

```typescript
// Signal-based lease management in the orchestrator workflow
const LEASE_TTL = '4 hours';

export async function branchLeaseWorkflow(input: {
  branch: string;
  taskId: string;
}): Promise<void> {
  let renewed = true;

  wf.setHandler(renewLeaseSignal, () => { renewed = true; });
  wf.setHandler(releaseLeaseSignal, () => { renewed = false; });
  wf.setHandler(leaseStatusQuery, () => ({ branch: input.branch, taskId: input.taskId, active: renewed }));

  while (renewed) {
    renewed = false; // Will be set back to true by renewLeaseSignal
    await wf.sleep(LEASE_TTL);
  }

  // Lease expired or explicitly released
  await releaseBranchLease({ branch: input.branch, taskId: input.taskId });
}
```

### 10.3 Cancellation Scope for Cleanup

When a kill switch is triggered or workflow is cancelled, ensure cleanup runs:

```typescript
import { CancellationScope, isCancellation } from '@temporalio/workflow';

export async function implementPhaseWorkflow(state: PhaseState): Promise<PhaseState> {
  try {
    // Main implementation logic
    await runImplementation(state);
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      // Cleanup must run even when cancelled
      await CancellationScope.nonCancellable(async () => {
        await cleanupBranch(state);
        await releaseLease(state);
        await updateTaskState({ taskId: state.taskId, newState: 'failed' });
      });
    }
    throw err;
  }
}
```

### 10.4 Architecture Summary

```
                          Client (API/CLI)
                               |
                    [signal/query/update]
                               |
                    +----------v-----------+
                    |  Task Orchestrator    |  (parent workflow, sf-orchestration queue)
                    |  - state machine     |
                    |  - phase routing     |
                    |  - kill switch       |
                    +-----+----+----+------+
                          |    |    |
              +-----------+    |    +-----------+
              |                |                |
     +--------v------+  +-----v-------+  +-----v--------+
     | Intake Phase  |  | Implement   |  | Validate     |  (child workflows)
     | Workflow      |  | Phase WF    |  | Phase WF     |
     +---------------+  +------+------+  +------+-------+
                               |                |
                        [activities]      [activities]
                               |                |
              +-------+--------+------+    +----+----+
              |       |        |      |    |    |    |
           sf-llm  sf-github sf-db  sf-docker  ...
              |       |        |      |
           [LLM]  [GitHub]  [PG]  [Docker]
```

---

## 11. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Event history overflow in long implementation phases | Continue-As-New at `historyLength > 10_000`; store large payloads externally |
| Signal loss during Continue-As-New | Always drain handlers with `allHandlersFinished` before continuing |
| LLM API cost runaway | Cost budget check activity before each LLM call; kill switch signal |
| Workflow code changes break in-flight executions | Patching API + replay testing in CI |
| Worker memory pressure from many cached workflows | `reuseV8Context: true` (default); tune `maxCachedWorkflows` |
| Non-determinism bugs | Workflow sandbox catches most issues; replay tests catch the rest |
| State serialization exceeds 2 MB arg limit | Store large state in Postgres, pass references in workflow args |
| Docker compose not production-ready | Use `temporalio/server` (not auto-setup) with managed Postgres and ES |

---

## 12. Open Questions for Planning Phase

1. **Single namespace or multi-namespace?** One namespace per environment (dev/staging/prod) is typical. Multi-tenant would need namespace-per-tenant.
2. **Workflow ID naming convention?** Suggested: `task-{taskId}-{phase}` for child workflows, `task-{taskId}` for the orchestrator. This enables easy querying.
3. **Should the branch lease be a separate workflow or integrated into the task orchestrator?** Separate workflow is cleaner but adds complexity. A signal-based approach within the orchestrator is simpler.
4. **Data converter:** Should we encrypt workflow payloads at rest? Temporal supports Payload Codecs for encryption, but it adds operational complexity. Consider for phase 2.
5. **Visibility queries:** Will we need custom search attributes for task state, assignee, repository? Yes -- plan for this in schema design.
