# Temporal Time-Skipping Test Server: How It Works and Why Tests Break

**Date:** 2026-03-19

---

## 1. The Time Locking Counter Mechanism

The Temporal Java Test Server uses a **Time Locking Counter** (an integer, not a boolean) to control time-skipping behavior. This is the single most important detail for understanding the problem.

**Source:** Proto type definitions at `node_modules/.pnpm/@temporalio+proto@1.14.1/node_modules/@temporalio/proto/protos/root.d.ts` lines 95376-95490.

The counter works as follows:

- **`lockTimeSkipping()`** -- increments the counter by 1
- **`unlockTimeSkipping()`** -- decrements the counter by 1
- **When the counter is positive** -- time moves at *real-time* pace (time-skipping is disabled)
- **When the counter reaches 0** -- time-skipping activates and the server fast-forwards to the next scheduled event (timer expiration, activity timeout, etc.)
- **The server starts with the counter at 1** -- time-skipping is LOCKED by default

This is explicitly documented in the proto comments:

> "Test Server is typically started with locked time skipping and Time Locking Counter = 1."

> "If the counter reaches 0, it unlocks time skipping and fast forwards time."

---

## 2. How the TypeScript SDK Uses Lock/Unlock

### 2.1 TimeSkippingWorkflowClient.result()

**File:** `node_modules/.pnpm/@temporalio+testing@1.14.1_tslib@2.8.1/node_modules/@temporalio/testing/src/client.ts` lines 56-67

```ts
override async result<T>(
  workflowId: string,
  runId?: string | undefined,
  opts?: WorkflowResultOptions | undefined
): Promise<T> {
  await this.testService.unlockTimeSkipping({});   // counter: 1 -> 0
  try {
    return await super.result(workflowId, runId, opts);  // long-poll for workflow close event
  } finally {
    await this.testService.lockTimeSkipping({});    // counter: 0 -> 1
  }
}
```

When you call `handle.result()`:
1. The counter decrements from 1 to 0
2. Since counter reaches 0, time-skipping ACTIVATES -- the server fast-forwards through ALL pending timers
3. The method long-polls (`getWorkflowExecutionHistory` with `waitNewEvent: true`) for a close event
4. When the workflow finishes, the counter is re-locked (incremented back to 1)

### 2.2 TestWorkflowEnvironment.sleep()

**File:** `node_modules/.pnpm/@temporalio+testing@1.14.1_tslib@2.8.1/node_modules/@temporalio/testing/src/testing-workflow-environment.ts` lines 338-344

```ts
sleep = async (durationMs: Duration): Promise<void> => {
  if (this.supportsTimeSkipping) {
    await this.connection.testService!.unlockTimeSkippingWithSleep({ duration: msToTs(durationMs) });
  } else {
    await new Promise((resolve) => setTimeout(resolve, msToNumber(durationMs)));
  }
};
```

Uses `unlockTimeSkippingWithSleep`, which:

> "decreases time locking counter by one and increases it back once the Test Server Time advances by the duration specified in the request."

This is an atomic "unlock, fast-forward by N ms, re-lock" operation.

### 2.3 Critical: No Other Operations Touch the Lock

`start()`, `signal()`, `describe()`, `query()` -- **none of these** interact with the time-locking counter. They are ordinary gRPC calls that execute against the test server at whatever the current server time happens to be. They do NOT pause or hold the time-skipping mechanism.

---

## 3. Analysis of the Review Phase Tests

### 3.1 Direct Review Phase Tests (PASS)

**File:** `packages/temporal-workflows/__tests__/review-phase.test.ts` lines 35-48

```ts
// Test: "returns approved when approve signal is sent"
const handle = await testEnv.client.workflow.start("reviewPhase", {
  args: [{ taskId: "t1", reviewTimeoutMs: 14_400_000 }],
});
await handle.signal(approveSignal, { actor: "reviewer" });
return (await handle.result()) as ReviewResult;
```

This works because of execution order:
1. `start()` -- starts the workflow (counter stays at 1, no time-skipping)
2. `signal()` -- delivers the approve signal (counter stays at 1)
3. `result()` -- calls `unlockTimeSkipping()` (counter: 1 -> 0), but by now the signal has already been processed and the condition `() => result !== undefined` evaluates to true, so the workflow completes immediately without needing to fast-forward through the 4-hour timer

The race condition is benign here because:
- Between `start()` and `signal()`, time-skipping is LOCKED (counter = 1), so the 4-hour timer cannot fire
- The signal arrives before `result()` unlocks time-skipping

### 3.2 Timeout Test (PASS by Design)

**File:** `packages/temporal-workflows/__tests__/review-phase.test.ts` lines 86-98

```ts
// Test: "times out after configured timeout"
const handle = await testEnv.client.workflow.start("reviewPhase", {
  args: [{ taskId: "t1", reviewTimeoutMs: 3_600_000 }], // 1 hour
});
return (await handle.result()) as ReviewResult;
```

No signal is sent. When `result()` unlocks time-skipping, the server fast-forwards the 1-hour timer instantly, causing `condition()` to return `false` (timeout), and the workflow completes with `timed_out`.

### 3.3 Orchestrator Test (PASS with Workaround)

**File:** `packages/temporal-workflows/__tests__/orchestrator.test.ts` line 36

```ts
config: {
  reviewTimeoutMs: 1,  // <--- 1 millisecond!
  // ...
}
```

The orchestrator test uses `reviewTimeoutMs: 1` to avoid the problem entirely. With a 1ms timeout, even at real-time pace (time-skipping locked), the timer expires almost instantly when the workflow task is processed. The test never needs to signal the review phase.

---

## 4. Answering Your Specific Questions

### Q1: Does the time-skipping server advance time past the 4-hour timeout immediately?

**It depends on whether `handle.result()` has been called.**

- **Before `result()` is called:** NO. The counter is at 1 (locked). Time moves at real-time pace. The 4-hour timer will NOT fire for 4 real hours.
- **After `result()` is called:** YES, immediately. The counter drops to 0 and the server fast-forwards to the next timer event, which is the 4-hour timeout. If no signal has been delivered yet, the timeout fires before the polling loop gets a chance to run.

### Q2: Does the server wait until the test is idle before advancing time?

**No.** The server does not have any concept of "test idle detection." Time advancement is controlled purely by the lock counter:
- Counter > 0: real-time pace
- Counter = 0: fast-forward to next event

### Q3: Will the polling loop scenario work?

```ts
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 200));
  const desc = await reviewHandle.describe();
  if (desc.status.name === "RUNNING") {
    await reviewHandle.signal(approveSignal, { actor: "reviewer" });
    break;
  }
}
```

**This loop will work AS LONG AS `handle.result()` has NOT been called yet.** During the polling loop, the counter is still at 1, so time-skipping is locked and the 4-hour timer will not fire. The `describe()` and `signal()` calls do not affect the lock counter.

However, the moment `result()` is called after the loop, time-skipping unlocks. If the signal was successfully delivered, the condition is already satisfied and the workflow completes. If the signal was NOT delivered (e.g., the loop finished without finding RUNNING status), the 4-hour timeout fires instantly.

---

## 5. Why Adding Child Workflows Before Review Could Break Tests

### The Core Problem

When the orchestrator runs multiple child workflows before review (intake, understand, plan, setup, implement, validate, evidence), each `executeChild()` must complete before the next one starts. During this entire sequence, time-skipping is either:

1. **Locked (counter = 1):** Each child workflow runs at real-time pace. Activities that use `testEnv.sleep()` inside them would call `unlockTimeSkippingWithSleep`, temporarily dropping the counter. But the test code calling `handle.result()` on the parent would unlock time-skipping for ALL workflows in the test server, not just the parent.

2. **If the parent `result()` is called before signaling review:** Time-skipping unlocks, all pending timers (including the 4-hour review timeout) fire simultaneously. The review phase times out before the test can send a signal.

### Specific Scenarios That Break

**Scenario A: Test calls `parentHandle.result()` and expects to signal review mid-flight**

```ts
const parentHandle = await client.workflow.start("taskOrchestrator", { ... });
// Time-skipping unlocks immediately!
const result = await parentHandle.result();
// By now, all timers have fired, review has timed out
```

This is what the current orchestrator test avoids by using `reviewTimeoutMs: 1`. If the timeout were 4 hours, calling `result()` would fast-forward through the review timeout before any signal could be sent.

**Scenario B: Test tries to poll for review child, then signal it**

```ts
const parentHandle = await client.workflow.start("taskOrchestrator", { ... });

// Poll for review child to start running
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 200));
  // Try to describe the review child workflow
}

// Signal the parent (which forwards to review child)
await parentHandle.signal(approveSignal, { actor: "reviewer" });
const result = await parentHandle.result(); // NOW time-skipping unlocks
```

This WOULD work if:
- All prior child workflows (intake through evidence) complete during the polling window
- The review child actually starts before the polling loop gives up
- The signal arrives before `result()` is called

But with mock activities that return instantly, the prior children complete in a few hundred ms. The review child would be RUNNING within the first few polling iterations. The signal is then delivered while time-skipping is still locked. When `result()` finally unlocks time-skipping, the condition is already satisfied (signal was received), so the workflow completes immediately without the timeout firing.

**Scenario C: Global time-skipping interference between concurrent tests**

The test environment documentation explicitly warns:

> "Time skipping, which is automatically done when awaiting a workflow result and manually done on sleep, is global to the environment, not to the workflow under test."

(`testing-workflow-environment.ts` lines 138-140)

If two tests share the same `TestWorkflowEnvironment` and one calls `result()`, it unlocks time-skipping globally, potentially causing timeouts in the other test's review phase.

### The `reviewTimeoutMs: 1` Workaround

The current orchestrator tests use `reviewTimeoutMs: 1` specifically to avoid dealing with time-skipping. With a 1ms timeout:
- The `condition()` in the review phase is `Promise.race([sleep(1), conditionInner(fn)])`
- The 1ms timer expires almost instantly during normal workflow task processing
- The review returns `timed_out` without needing any signal
- The orchestrator handles `timed_out` with `currentState = "failed"; break;`
- The test expects either success or failure (lines 207-216: `try { await handle.result() } catch { // Review timeout failure is expected }`)

---

## 6. How `condition(fn, timeout)` Works Internally

**File:** `node_modules/.pnpm/@temporalio+workflow@1.14.1/node_modules/@temporalio/workflow/src/workflow.ts` lines 1160-1176

```ts
export async function condition(fn: () => boolean, timeout?: Duration): Promise<void | boolean> {
  if (typeof timeout === 'number' || typeof timeout === 'string') {
    return CancellationScope.cancellable(async () => {
      try {
        return await Promise.race([
          sleep(timeout).then(() => false),
          conditionInner(fn).then(() => true)
        ]);
      } finally {
        CancellationScope.current().cancel();
      }
    });
  }
  return conditionInner(fn);
}
```

`condition(fn, timeout)` is a `Promise.race` between:
- A `sleep(timeout)` that resolves to `false` (timed out)
- A `conditionInner(fn)` that resolves to `true` when `fn()` returns true

The `sleep()` here is the WORKFLOW's `sleep`, not `setTimeout`. It creates a Temporal timer command. When the time-skipping server fast-forwards, it fires this timer, causing the race to resolve with `false` (timeout).

---

## 7. Summary of Key Findings

| Aspect | Behavior |
|--------|----------|
| Counter initial value | 1 (locked) |
| `result()` effect | Unlocks (counter -1), re-locks on completion |
| `signal()` effect | None on counter |
| `describe()` effect | None on counter |
| `query()` effect | None on counter |
| `start()` effect | None on counter |
| Time-skip trigger | Counter reaches 0 |
| Fast-forward scope | Global -- all workflows in the test server |
| Multiple tests | Must NOT share environment concurrently |

### Recommendations for Testing Review Phase in Orchestrator

1. **Signal before calling `result()`**: Start the orchestrator, poll/wait for the review phase to be active, send the signal, THEN call `result()`. Time-skipping stays locked during the entire signal delivery because the counter never reaches 0 until `result()`.

2. **Use the query handler**: The orchestrator exposes `getPhaseQuery`. Poll with `handle.query(getPhaseQuery)` until it returns `"review"`, then signal, then call `result()`.

3. **Avoid `reviewTimeoutMs: 1` if testing the happy path**: If you want to test that the review signal actually approves the workflow (instead of timing out), use a real timeout value and rely on the fact that signals arrive while time-skipping is locked.

4. **Run tests serially or use separate environments**: Never run two tests concurrently against the same `TestWorkflowEnvironment` if either calls `result()`.

---

## 8. Relevant File Paths

### Temporal testing SDK source (time-skipping implementation)
- `/Users/seanflanagan/proj/software-factory/node_modules/.pnpm/@temporalio+testing@1.14.1_tslib@2.8.1/node_modules/@temporalio/testing/src/client.ts` -- TimeSkippingWorkflowClient with lock/unlock in `result()` (lines 56-67)
- `/Users/seanflanagan/proj/software-factory/node_modules/.pnpm/@temporalio+testing@1.14.1_tslib@2.8.1/node_modules/@temporalio/testing/src/testing-workflow-environment.ts` -- `sleep()` using `unlockTimeSkippingWithSleep` (lines 338-344), global time-skipping warning (lines 138-140)

### Proto definitions (lock counter semantics)
- `/Users/seanflanagan/proj/software-factory/node_modules/.pnpm/@temporalio+proto@1.14.1/node_modules/@temporalio/proto/protos/root.d.ts` -- TestService RPC docs (lines 95376-95490)

### Workflow SDK (condition internals)
- `/Users/seanflanagan/proj/software-factory/node_modules/.pnpm/@temporalio+workflow@1.14.1/node_modules/@temporalio/workflow/src/workflow.ts` -- `condition()` implementation (lines 1160-1176)

### Project test files
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/__tests__/orchestrator.test.ts` -- uses `reviewTimeoutMs: 1` workaround (line 36)
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/__tests__/review-phase.test.ts` -- uses `reviewTimeoutMs: 14_400_000` with signal-before-result pattern (lines 35-48)
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/review.ts` -- review phase with `condition(() => result !== undefined, reviewTimeoutMs)` (lines 74-77)
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/orchestrator.ts` -- parent workflow phase loop (lines 218-509)
