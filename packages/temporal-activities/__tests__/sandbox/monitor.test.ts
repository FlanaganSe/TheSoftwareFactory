import { afterEach, describe, expect, it, vi } from "vitest";
import { createMonitor } from "../../src/sandbox/monitor.js";
import type { MonitorHandle } from "../../src/sandbox/monitor.js";

// Minimal Docker mock for monitor tests
function mockDocker() {
  return {
    getContainer: (_id: string) => ({
      inspect: vi.fn().mockResolvedValue({
        State: { Running: true, OOMKilled: false },
      }),
      stats: vi.fn().mockResolvedValue({
        memory_stats: { usage: 100_000, limit: 4_000_000_000 },
        pids_stats: { current: 5 },
      }),
      kill: vi.fn().mockResolvedValue(undefined),
    }),
    getEvents: vi.fn().mockResolvedValue({
      on: vi.fn(),
      destroy: vi.fn(),
    }),
  };
}

let monitor: MonitorHandle;

afterEach(() => {
  monitor?.stop();
});

describe("createMonitor", () => {
  it("starts with ok status", () => {
    const docker = mockDocker();
    monitor = createMonitor("container-1", docker as never, {
      wallClockTimeoutMs: 60_000,
      statsIntervalMs: 60_000,
      noProgressThreshold: 3,
    });
    expect(monitor.getStatus()).toEqual({ ok: true });
  });

  it("detects wall-clock timeout", async () => {
    vi.useFakeTimers();
    const docker = mockDocker();
    monitor = createMonitor("container-1", docker as never, {
      wallClockTimeoutMs: 100,
      statsIntervalMs: 60_000,
      noProgressThreshold: 3,
    });

    vi.advanceTimersByTime(150);
    expect(monitor.getStatus()).toEqual({
      ok: false,
      reason: "wall_clock_timeout",
    });
    vi.useRealTimers();
  });

  it("detects no-progress after threshold identical results", () => {
    const docker = mockDocker();
    monitor = createMonitor("container-1", docker as never, {
      wallClockTimeoutMs: 60_000,
      statsIntervalMs: 60_000,
      noProgressThreshold: 3,
    });

    // Three identical results should trigger no-progress
    monitor.recordExecResult(0, "hash-abc");
    monitor.recordExecResult(0, "hash-abc");
    monitor.recordExecResult(0, "hash-abc");

    expect(monitor.getStatus()).toEqual({
      ok: false,
      reason: "no_progress",
    });
  });

  it("does not trigger no-progress with changing results", () => {
    const docker = mockDocker();
    monitor = createMonitor("container-1", docker as never, {
      wallClockTimeoutMs: 60_000,
      statsIntervalMs: 60_000,
      noProgressThreshold: 3,
    });

    monitor.recordExecResult(0, "hash-1");
    monitor.recordExecResult(0, "hash-2");
    monitor.recordExecResult(0, "hash-3");

    expect(monitor.getStatus()).toEqual({ ok: true });
  });

  it("stop prevents further state changes", () => {
    vi.useFakeTimers();
    const docker = mockDocker();
    monitor = createMonitor("container-1", docker as never, {
      wallClockTimeoutMs: 100,
      statsIntervalMs: 60_000,
      noProgressThreshold: 3,
    });

    monitor.stop();
    vi.advanceTimersByTime(200);
    expect(monitor.getStatus()).toEqual({ ok: true });
    vi.useRealTimers();
  });
});
