import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyNoSecretLeakage } from "../../src/sandbox/secrets.js";
import { createSandboxSupervisor } from "../../src/sandbox/supervisor.js";
import {
  cleanupTestContainers,
  cleanupTestImages,
  createTestSuite,
  docker,
  isDockerAvailable,
  makeTestConfig,
  pullTestImage,
} from "./docker-helpers.js";

const dockerAvailable = await isDockerAvailable();
const suiteId = createTestSuite();
let supervisor: ReturnType<typeof createSandboxSupervisor>;

beforeAll(async () => {
  if (!dockerAvailable) return;
  supervisor = createSandboxSupervisor(docker);
  await pullTestImage();
}, 120_000);

afterAll(async () => {
  if (!dockerAvailable) return;
  await cleanupTestContainers(suiteId);
  await cleanupTestImages();
}, 30_000);

const cfg = () => makeTestConfig(suiteId);

describe.skipIf(!dockerAvailable)("SandboxSupervisor", () => {
  describe("createContainer", () => {
    it("creates a container with correct security HostConfig", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      expect(resolved.isOk()).toBe(true);
      if (resolved.isErr()) return;

      const result = await supervisor.createContainer(resolved.value);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const container = docker.getContainer(result.value.containerId);
      const info = await container.inspect();

      expect(info.HostConfig.CapDrop).toContain("ALL");
      expect(info.HostConfig.ReadonlyRootfs).toBe(true);
      expect(info.Config.User).toBe("1000:1000");
      expect(info.HostConfig.PidsLimit).toBe(256);
      expect(info.HostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);
      expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
    }, 60_000);

    it("sets factory labels on created containers", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;

      const result = await supervisor.createContainer(resolved.value);
      if (result.isErr()) return;

      const container = docker.getContainer(result.value.containerId);
      const info = await container.inspect();

      expect(info.Config.Labels["com.factory.task-id"]).toBeDefined();
      expect(info.Config.Labels["com.factory.repo"]).toBe("test-org/test-repo");
      expect(info.Config.Labels["com.factory.phase"]).toBeDefined();
      expect(info.Config.Labels["com.factory.created-at"]).toBeDefined();
    }, 60_000);

    it("sets setup capabilities during setup phase", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;

      const result = await supervisor.createContainer(resolved.value);
      if (result.isErr()) return;

      const container = docker.getContainer(result.value.containerId);
      const info = await container.inspect();

      expect(info.HostConfig.CapAdd).toContain("CHOWN");
      expect(info.HostConfig.CapAdd).toContain("DAC_OVERRIDE");
      expect(info.HostConfig.CapAdd).toContain("FOWNER");
      expect(info.HostConfig.CapAdd).toContain("SETGID");
      expect(info.HostConfig.CapAdd).toContain("SETUID");
    }, 60_000);
  });

  describe("exec", () => {
    it("collects stdout and stderr separately", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;
      const cr = await supervisor.createContainer(resolved.value);
      if (cr.isErr()) return;

      const result = await supervisor.execCommand(cr.value, [
        "sh",
        "-c",
        "echo out-data && echo err-data >&2",
      ]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      expect(result.value.stdout).toContain("out-data");
      expect(result.value.stderr).toContain("err-data");
    }, 60_000);

    it("captures exit code", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;
      const cr = await supervisor.createContainer(resolved.value);
      if (cr.isErr()) return;

      const result = await supervisor.execCommand(cr.value, [
        "sh",
        "-c",
        "exit 42",
      ]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      expect(result.value.exitCode).toBe(42);
    }, 60_000);

    it("reports duration", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;
      const cr = await supervisor.createContainer(resolved.value);
      if (cr.isErr()) return;

      const result = await supervisor.execCommand(cr.value, [
        "sh",
        "-c",
        "sleep 0.1",
      ]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      expect(result.value.durationMs).toBeGreaterThanOrEqual(50);
    }, 60_000);
  });

  describe("execWithSecrets", () => {
    it("injects secrets into exec env, not container env", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;
      const cr = await supervisor.createContainer(resolved.value);
      if (cr.isErr()) return;

      const result = await supervisor.execWithSecrets(
        cr.value,
        ["sh", "-c", "echo $MY_SECRET"],
        { MY_SECRET: "secret-value-42" },
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      expect(result.value.stdout.trim()).toBe("secret-value-42");

      const leakCheck = await verifyNoSecretLeakage(
        cr.value.containerId,
        docker,
        {
          setupOnly: {},
          runtime: {},
          perTool: { test: { MY_SECRET: "secret-value-42" } },
        },
      );
      expect(leakCheck.isOk()).toBe(true);
      if (leakCheck.isOk()) {
        expect(leakCheck.value).toBe(true);
      }
    }, 60_000);
  });

  describe("setup", () => {
    it("runs setup commands and checks health", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;

      const containerResult = await supervisor.createContainer(resolved.value);
      if (containerResult.isErr()) return;

      const setupResult = await supervisor.runSetup(
        containerResult.value,
        config,
      );
      expect(setupResult.isOk()).toBe(true);
    }, 120_000);

    it("returns error on setup command failure", async () => {
      const config = makeTestConfig(suiteId, {
        setupContract: {
          version: "1",
          image: "node:22-slim",
          setup: ["false"],
          maintenance: [],
          secrets: { setup_only: [], runtime: [], per_tool: [] },
          health_check: [],
        },
        secrets: { setupOnly: {}, runtime: {}, perTool: {} },
      });
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;

      const containerResult = await supervisor.createContainer(resolved.value);
      if (containerResult.isErr()) return;

      const setupResult = await supervisor.runSetup(
        containerResult.value,
        config,
      );
      expect(setupResult.isErr()).toBe(true);
      if (setupResult.isErr()) {
        expect(setupResult.error.message).toContain("Setup command failed");
      }
    }, 60_000);
  });

  describe("cleanup", () => {
    it("destroys container and removes it", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;

      const result = await supervisor.createContainer(resolved.value);
      if (result.isErr()) return;

      const destroyResult = await supervisor.destroySandbox(result.value);
      expect(destroyResult.isOk()).toBe(true);

      try {
        await docker.getContainer(result.value.containerId).inspect();
        expect.fail("Container should not exist after destroy");
      } catch (error) {
        expect((error as { statusCode: number }).statusCode).toBe(404);
      }
    }, 60_000);

    it("cleanupOrphans removes old factory containers", async () => {
      const config = cfg();
      const resolved = await supervisor.resolveEnvironment(config);
      if (resolved.isErr()) return;

      const result = await supervisor.createContainer(resolved.value);
      if (result.isErr()) return;

      const cleaned = await supervisor.cleanupOrphans(0);
      expect(cleaned.isOk()).toBe(true);
      if (cleaned.isOk()) {
        expect(cleaned.value).toBeGreaterThanOrEqual(1);
      }
    }, 180_000);
  });
});
