import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNetworkManager } from "../../src/sandbox/network.js";
import { createSandboxSupervisor } from "../../src/sandbox/supervisor.js";
import {
  cleanupTestContainers,
  createTestSuite,
  docker,
  isDockerAvailable,
  makeTestConfig,
  pullTestImage,
} from "./docker-helpers.js";

const dockerAvailable = await isDockerAvailable();
const suiteId = createTestSuite();

beforeAll(async () => {
  if (!dockerAvailable) return;
  await pullTestImage();
}, 120_000);

afterAll(async () => {
  if (!dockerAvailable) return;
  await cleanupTestContainers(suiteId);
}, 30_000);

const cfg = () => makeTestConfig(suiteId);

describe.skipIf(!dockerAvailable)("NetworkManager", () => {
  it("container on bridge has network access", async () => {
    const supervisor = createSandboxSupervisor(docker);
    const config = cfg();
    const resolved = await supervisor.resolveEnvironment(config);
    if (resolved.isErr()) return;

    const result = await supervisor.createContainer(resolved.value);
    if (result.isErr()) return;

    const execResult = await supervisor.execCommand(result.value, [
      "cat",
      "/proc/net/route",
    ]);
    expect(execResult.isOk()).toBe(true);
    if (execResult.isErr()) return;

    const lines = execResult.value.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
  }, 60_000);

  it("after disconnectFromBridge, container has no network", async () => {
    const supervisor = createSandboxSupervisor(docker);
    const networkManager = createNetworkManager(docker);
    const config = cfg();
    const resolved = await supervisor.resolveEnvironment(config);
    if (resolved.isErr()) return;

    const result = await supervisor.createContainer(resolved.value);
    if (result.isErr()) return;

    const disconnectResult = await networkManager.disconnectFromBridge(
      result.value.containerId,
    );
    expect(disconnectResult.isOk()).toBe(true);

    const execResult = await supervisor.execCommand(result.value, [
      "cat",
      "/proc/net/route",
    ]);
    expect(execResult.isOk()).toBe(true);
    if (execResult.isErr()) return;

    const lines = execResult.value.stdout.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(1);
  }, 60_000);

  it("verifyNetworkIsolation returns true after disconnect", async () => {
    const supervisor = createSandboxSupervisor(docker);
    const networkManager = createNetworkManager(docker);
    const config = cfg();
    const resolved = await supervisor.resolveEnvironment(config);
    if (resolved.isErr()) return;

    const result = await supervisor.createContainer(resolved.value);
    if (result.isErr()) return;

    await networkManager.disconnectFromBridge(result.value.containerId);

    const isolated = await networkManager.verifyNetworkIsolation(
      result.value.containerId,
    );
    expect(isolated.isOk()).toBe(true);
    if (isolated.isOk()) {
      expect(isolated.value).toBe(true);
    }
  }, 60_000);
});
