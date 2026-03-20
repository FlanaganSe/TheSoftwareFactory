import { describe, expect, it } from "vitest";
import {
  type GuardrailState,
  createGuardrails,
} from "../../src/llm/guardrails.js";

describe("createGuardrails", () => {
  function makeState(overrides: Partial<GuardrailState> = {}): GuardrailState {
    return {
      stepCount: 0,
      stateFingerprints: [],
      toolCallHashes: [],
      startTimeMs: Date.now(),
      totalCostCents: 0,
      ...overrides,
    };
  }

  describe("max_steps", () => {
    it("trips after reaching max step count", () => {
      const g = createGuardrails({ maxSteps: 10 });
      const state = makeState({ stepCount: 10 });
      const trip = g.checkAfterStep(state);
      expect(trip).not.toBeNull();
      expect(trip?.guardrail).toBe("max_steps");
    });

    it("does not trip before max step count", () => {
      const g = createGuardrails({ maxSteps: 10 });
      const state = makeState({ stepCount: 9 });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });
  });

  describe("no_progress", () => {
    it("trips after 3 identical fingerprints", () => {
      const g = createGuardrails({ noProgressThreshold: 3 });
      const fp = g.computeFingerprint(new Map(), 0, 0, 0);
      const state = makeState({
        stateFingerprints: [fp, fp, fp],
      });
      const trip = g.checkAfterStep(state);
      expect(trip).not.toBeNull();
      expect(trip?.guardrail).toBe("no_progress");
    });

    it("does not trip with different fingerprints", () => {
      const g = createGuardrails({ noProgressThreshold: 3 });
      const fp1 = g.computeFingerprint(new Map(), 0, 0, 0);
      const fp2 = g.computeFingerprint(new Map([["a.ts", "hash"]]), 0, 0, 0);
      const fp3 = g.computeFingerprint(new Map(), 1, 0, 0);
      const state = makeState({
        stateFingerprints: [fp1, fp2, fp3],
      });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });

    it("does not trip with fewer than threshold fingerprints", () => {
      const g = createGuardrails({ noProgressThreshold: 3 });
      const fp = g.computeFingerprint(new Map(), 0, 0, 0);
      const state = makeState({
        stateFingerprints: [fp, fp],
      });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });
  });

  describe("loop_of_doom", () => {
    it("trips after 4 identical tool call hashes", () => {
      const g = createGuardrails({ loopOfDoomThreshold: 4 });
      const hash = g.computeToolCallHash("file_read", { path: "a.ts" });
      const state = makeState({
        toolCallHashes: [hash, hash, hash, hash],
      });
      const trip = g.checkAfterStep(state);
      expect(trip).not.toBeNull();
      expect(trip?.guardrail).toBe("loop_of_doom");
    });

    it("does not trip with only 3 identical hashes (threshold is 4)", () => {
      const g = createGuardrails({ loopOfDoomThreshold: 4 });
      const hash = g.computeToolCallHash("file_read", { path: "a.ts" });
      const state = makeState({
        toolCallHashes: [hash, hash, hash],
      });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });
  });

  describe("wall_clock", () => {
    it("trips after configured timeout", () => {
      const g = createGuardrails({ wallClockTimeoutMs: 1000 });
      const state = makeState({ startTimeMs: Date.now() - 2000 });
      const trip = g.checkAfterStep(state, Date.now());
      expect(trip).not.toBeNull();
      expect(trip?.guardrail).toBe("wall_clock");
    });

    it("does not trip before timeout", () => {
      const g = createGuardrails({ wallClockTimeoutMs: 60_000 });
      const state = makeState({ startTimeMs: Date.now() });
      const trip = g.checkAfterStep(state, Date.now());
      expect(trip).toBeNull();
    });
  });

  describe("cost_budget", () => {
    it("trips when cost exceeds budget", () => {
      const g = createGuardrails({ budgetCents: 1000 });
      const state = makeState({ totalCostCents: 1001 });
      const trip = g.checkAfterStep(state);
      expect(trip).not.toBeNull();
      expect(trip?.guardrail).toBe("cost_budget");
    });

    it("does not trip when cost is under budget", () => {
      const g = createGuardrails({ budgetCents: 1000 });
      const state = makeState({ totalCostCents: 500 });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });
  });

  describe("no guardrail tripped", () => {
    it("returns null when all conditions are within limits", () => {
      const g = createGuardrails({
        maxSteps: 10,
        noProgressThreshold: 3,
        loopOfDoomThreshold: 4,
        wallClockTimeoutMs: 60_000,
        budgetCents: 1000,
      });
      const state = makeState({
        stepCount: 5,
        stateFingerprints: ["a", "b", "c"],
        toolCallHashes: ["x", "y", "z"],
        totalCostCents: 100,
      });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });
  });

  describe("computeFingerprint", () => {
    it("produces deterministic output for same input", () => {
      const g = createGuardrails();
      const fp1 = g.computeFingerprint(new Map([["a.ts", "hash1"]]), 5, 2, 1);
      const fp2 = g.computeFingerprint(new Map([["a.ts", "hash1"]]), 5, 2, 1);
      expect(fp1).toBe(fp2);
    });

    it("produces different output for different input", () => {
      const g = createGuardrails();
      const fp1 = g.computeFingerprint(new Map([["a.ts", "hash1"]]), 5, 2, 1);
      const fp2 = g.computeFingerprint(new Map([["b.ts", "hash1"]]), 5, 2, 1);
      expect(fp1).not.toBe(fp2);
    });

    it("produces different output for different actionCount", () => {
      const g = createGuardrails();
      const fp1 = g.computeFingerprint(new Map(), 0, 0, 0, 3);
      const fp2 = g.computeFingerprint(new Map(), 0, 0, 0, 6);
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("no_progress with actionCount", () => {
    it("does not trip during read-only exploration when actionCount grows", () => {
      const g = createGuardrails({ noProgressThreshold: 3 });
      // Simulate 3 steps of read-only exploration: no files written,
      // but auditLog.length grows each step (agent is reading files)
      const fp1 = g.computeFingerprint(new Map(), 0, 0, 0, 2);
      const fp2 = g.computeFingerprint(new Map(), 0, 0, 0, 5);
      const fp3 = g.computeFingerprint(new Map(), 0, 0, 0, 8);
      const state = makeState({ stateFingerprints: [fp1, fp2, fp3] });
      const trip = g.checkAfterStep(state);
      expect(trip).toBeNull();
    });
  });

  describe("computeToolCallHash", () => {
    it("same tool+args+error produces same hash", () => {
      const g = createGuardrails();
      const h1 = g.computeToolCallHash("file_read", { path: "a.ts" }, "err");
      const h2 = g.computeToolCallHash("file_read", { path: "a.ts" }, "err");
      expect(h1).toBe(h2);
    });

    it("different args produces different hash", () => {
      const g = createGuardrails();
      const h1 = g.computeToolCallHash("file_read", { path: "a.ts" });
      const h2 = g.computeToolCallHash("file_read", { path: "b.ts" });
      expect(h1).not.toBe(h2);
    });
  });
});
