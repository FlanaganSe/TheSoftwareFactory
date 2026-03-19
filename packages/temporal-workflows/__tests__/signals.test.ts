import { describe, expect, it } from "vitest";
import {
  approveSignal,
  changesRequestedSignal,
  checkCompleteSignal,
  clarifyResponseSignal,
  costOverrideSignal,
  getPhaseQuery,
  getProgressQuery,
  getStateQuery,
  killSignal,
  mergeQueueUpdateSignal,
  prClosedSignal,
  prReviewSignal,
  rejectSignal,
  resumeSignal,
} from "../src/signals.js";

describe("signal definitions", () => {
  it("all signals have correct names", () => {
    expect(killSignal.name).toBe("kill");
    expect(approveSignal.name).toBe("approve");
    expect(rejectSignal.name).toBe("reject");
    expect(changesRequestedSignal.name).toBe("changes_requested");
    expect(resumeSignal.name).toBe("resume");
    expect(clarifyResponseSignal.name).toBe("clarify_response");
    expect(costOverrideSignal.name).toBe("cost_override");
  });

  it("GitHub lifecycle signals have correct names", () => {
    expect(prReviewSignal.name).toBe("pr_review");
    expect(checkCompleteSignal.name).toBe("check_complete");
    expect(mergeQueueUpdateSignal.name).toBe("merge_queue_update");
    expect(prClosedSignal.name).toBe("pr_closed");
  });
});

describe("query definitions", () => {
  it("all queries have correct names", () => {
    expect(getStateQuery.name).toBe("getState");
    expect(getProgressQuery.name).toBe("getProgress");
    expect(getPhaseQuery.name).toBe("getPhase");
  });
});

describe("signal/query type-level checks", () => {
  it("signals and queries are importable and defined", () => {
    // These are runtime checks that the defineSignal/defineQuery calls succeeded
    expect(killSignal).toBeDefined();
    expect(approveSignal).toBeDefined();
    expect(rejectSignal).toBeDefined();
    expect(changesRequestedSignal).toBeDefined();
    expect(resumeSignal).toBeDefined();
    expect(clarifyResponseSignal).toBeDefined();
    expect(costOverrideSignal).toBeDefined();
    expect(prReviewSignal).toBeDefined();
    expect(checkCompleteSignal).toBeDefined();
    expect(mergeQueueUpdateSignal).toBeDefined();
    expect(prClosedSignal).toBeDefined();
    expect(getStateQuery).toBeDefined();
    expect(getProgressQuery).toBeDefined();
    expect(getPhaseQuery).toBeDefined();
  });
});
