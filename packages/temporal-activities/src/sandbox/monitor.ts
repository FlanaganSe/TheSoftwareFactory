import type Docker from "dockerode";

export type MonitorReason =
  | "wall_clock_timeout"
  | "oom_killed"
  | "no_progress"
  | "container_died"
  | "resource_exceeded";

export type MonitorStatus =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MonitorReason };

export interface MonitorOptions {
  readonly wallClockTimeoutMs: number;
  readonly statsIntervalMs: number;
  readonly noProgressThreshold: number;
}

export interface MonitorHandle {
  getStatus(): MonitorStatus;
  recordExecResult(exitCode: number, outputHash: string): void;
  stop(): void;
}

const DEFAULT_OPTIONS: MonitorOptions = {
  wallClockTimeoutMs: 1_800_000, // 30 min
  statsIntervalMs: 10_000, // 10s
  noProgressThreshold: 3,
};

export function createMonitor(
  containerId: string,
  docker: Docker,
  options?: Partial<MonitorOptions>,
): MonitorHandle {
  const opts: MonitorOptions = { ...DEFAULT_OPTIONS, ...options };

  let status: MonitorStatus = { ok: true };
  let stopped = false;

  // Track no-progress detection
  let lastOutputHash = "";
  let sameHashCount = 0;

  // Wall-clock timeout
  const wallClockTimer = setTimeout(() => {
    if (!stopped) {
      status = { ok: false, reason: "wall_clock_timeout" };
      const container = docker.getContainer(containerId);
      container.kill().catch(() => {});
    }
  }, opts.wallClockTimeoutMs);

  // Resource stats polling
  const statsTimer = setInterval(async () => {
    if (stopped) return;
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();

      if (!info.State.Running) {
        if (info.State.OOMKilled) {
          status = { ok: false, reason: "oom_killed" };
        } else {
          status = { ok: false, reason: "container_died" };
        }
        return;
      }

      const stats = (await container.stats({ stream: false })) as {
        memory_stats?: { usage?: number; limit?: number };
        pids_stats?: { current?: number };
      };
      const memUsage = stats.memory_stats?.usage ?? 0;
      const memLimit = stats.memory_stats?.limit ?? 1;
      const pids = stats.pids_stats?.current ?? 0;

      if (memUsage / memLimit > 0.8 || pids > 200) {
        // Warning threshold — not an error yet, but tracked
      }
    } catch {
      // Container may have been removed — ignore
    }
  }, opts.statsIntervalMs);

  // Docker event monitoring
  let eventStream: NodeJS.ReadableStream | null = null;
  void (async () => {
    try {
      eventStream = (await docker.getEvents({
        filters: {
          container: [containerId],
          event: ["die", "oom", "kill"],
        },
      })) as NodeJS.ReadableStream;

      eventStream.on("data", (chunk: Buffer) => {
        if (stopped) return;
        try {
          const event = JSON.parse(chunk.toString()) as {
            Action?: string;
          };
          if (event.Action === "oom") {
            status = { ok: false, reason: "oom_killed" };
          } else if (event.Action === "die" || event.Action === "kill") {
            if (status.ok) {
              status = { ok: false, reason: "container_died" };
            }
          }
        } catch {
          // Ignore parse errors
        }
      });
    } catch {
      // Event stream may fail if container is gone
    }
  })();

  return {
    getStatus(): MonitorStatus {
      return status;
    },

    recordExecResult(exitCode: number, outputHash: string): void {
      if (stopped) return;
      const combined = `${exitCode}:${outputHash}`;
      if (combined === lastOutputHash) {
        sameHashCount++;
        if (sameHashCount >= opts.noProgressThreshold) {
          status = { ok: false, reason: "no_progress" };
        }
      } else {
        lastOutputHash = combined;
        sameHashCount = 1;
      }
    },

    stop(): void {
      stopped = true;
      clearTimeout(wallClockTimer);
      clearInterval(statsTimer);
      if (eventStream) {
        (
          eventStream as NodeJS.ReadableStream & { destroy?: () => void }
        ).destroy?.();
        eventStream = null;
      }
    },
  };
}

export async function checkOomKilled(
  containerId: string,
  docker: Docker,
): Promise<boolean> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return info.State.OOMKilled === true;
  } catch {
    return false;
  }
}
