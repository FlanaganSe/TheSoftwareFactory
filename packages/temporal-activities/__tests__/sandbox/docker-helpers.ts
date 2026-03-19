import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SetupContract } from "@software-factory/core";
import Docker from "dockerode";
import type { SecretBindings } from "../../src/sandbox/secrets.js";
import type { SandboxConfig } from "../../src/sandbox/supervisor.js";

export const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const TEST_IMAGE = "node:22-slim";

let suiteCounter = 0;

export function createTestSuite(): string {
  return `suite-${process.pid}-${++suiteCounter}-${Date.now()}`;
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function pullTestImage(): Promise<void> {
  try {
    await docker.getImage(TEST_IMAGE).inspect();
  } catch {
    await new Promise<void>((resolve, reject) => {
      docker.pull(
        TEST_IMAGE,
        (pullErr: Error | null, stream: NodeJS.ReadableStream) => {
          if (pullErr) return reject(pullErr);
          docker.modem.followProgress(stream, (progressErr: Error | null) => {
            if (progressErr) return reject(progressErr);
            resolve();
          });
        },
      );
    });
  }
}

export function makeTestContract(
  overrides?: Partial<SetupContract>,
): SetupContract {
  return {
    version: "1",
    image: TEST_IMAGE,
    setup: ["echo setup-done > /tmp/setup-marker"],
    maintenance: ["echo maintenance-done > /tmp/maint-marker"],
    secrets: {
      setup_only: ["NPM_TOKEN"],
      runtime: ["DB_URL"],
      per_tool: [],
    },
    health_check: ["test -f /tmp/setup-marker"],
    ...overrides,
  };
}

export function makeTestBindings(
  overrides?: Partial<SecretBindings>,
): SecretBindings {
  return {
    setupOnly: { NPM_TOKEN: "test-npm-token-123" },
    runtime: { DB_URL: "postgres://test:test@localhost/test" },
    perTool: {
      gh: { GITHUB_TOKEN: "ghp_test_token" },
    },
    ...overrides,
  };
}

export function makeTestConfig(
  suiteId: string,
  overrides?: Partial<SandboxConfig>,
): SandboxConfig {
  const tempDir = mkdtempSync(join(tmpdir(), "factory-test-"));
  return {
    repoPath: tempDir,
    setupContract: makeTestContract(),
    taskId: `${suiteId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    repoSlug: "test-org/test-repo",
    secrets: makeTestBindings(),
    ...overrides,
  };
}

export async function cleanupTestContainers(suiteId?: string): Promise<void> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ["com.factory.task-id"] },
  });
  for (const c of containers) {
    const taskId = c.Labels["com.factory.task-id"] ?? "";
    if (suiteId && !taskId.startsWith(suiteId)) continue;
    try {
      const container = docker.getContainer(c.Id);
      try {
        await container.stop({ t: 1 });
      } catch {
        // Already stopped
      }
      await container.remove({ force: true, v: true });
    } catch {
      // Already removed
    }
  }
}

export async function cleanupTestImages(): Promise<void> {
  const images = await docker.listImages({
    filters: { reference: ["factory-cache/test-org-test-repo"] },
  });
  for (const img of images) {
    try {
      await docker.getImage(img.Id).remove({ force: true });
    } catch {
      // Already removed
    }
  }
}
