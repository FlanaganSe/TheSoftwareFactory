import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cacheContainer,
  computeCacheKey,
  getCachedImage,
} from "../../src/sandbox/cache.js";
import { createSandboxSupervisor } from "../../src/sandbox/supervisor.js";
import {
  cleanupTestContainers,
  cleanupTestImages,
  createTestSuite,
  docker,
  isDockerAvailable,
  makeTestConfig,
  makeTestContract,
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

const cfg = (overrides?: Parameters<typeof makeTestConfig>[1]) =>
  makeTestConfig(suiteId, overrides);

describe.skipIf(!dockerAvailable)("Cache Integration", () => {
  it("first run: no cache → full setup → commit creates image", async () => {
    const config = cfg();
    const cacheKey = computeCacheKey({
      setupContract: config.setupContract,
      secrets: config.secrets,
    });

    const cached = await getCachedImage(docker, cacheKey, config.repoSlug);
    expect(cached.isOk()).toBe(true);
    if (cached.isOk()) {
      expect(cached.value).toBeNull();
    }

    const resolved = await supervisor.resolveEnvironment(config);
    if (resolved.isErr()) return;

    const containerResult = await supervisor.createContainer(resolved.value);
    if (containerResult.isErr()) return;

    const setupResult = await supervisor.runSetup(
      containerResult.value,
      config,
    );
    expect(setupResult.isOk()).toBe(true);

    const cachedAfter = await getCachedImage(docker, cacheKey, config.repoSlug);
    expect(cachedAfter.isOk()).toBe(true);
    if (cachedAfter.isOk()) {
      expect(cachedAfter.value).not.toBeNull();
    }
  }, 120_000);

  it("second run: cache hit → skip setup, container from cached image", async () => {
    const config = cfg();

    // First run: setup + commit
    const resolved1 = await supervisor.resolveEnvironment(config);
    if (resolved1.isErr()) return;
    const container1 = await supervisor.createContainer(resolved1.value);
    if (container1.isErr()) return;
    const setupResult = await supervisor.runSetup(container1.value, config);
    expect(setupResult.isOk()).toBe(true);
    await supervisor.destroySandbox(container1.value);

    // Second run: should find cache
    const resolved2 = await supervisor.resolveEnvironment(config);
    expect(resolved2.isOk()).toBe(true);
    if (resolved2.isErr()) return;

    expect(resolved2.value.cachedImage).not.toBeNull();

    // Verify we can create a container from the cached image and exec in it
    const container2 = await supervisor.createContainer(resolved2.value);
    expect(container2.isOk()).toBe(true);
    if (container2.isErr()) return;

    // Verify the container works (node is available from the cached image)
    const execResult = await supervisor.execCommand(container2.value, [
      "node",
      "--version",
    ]);
    expect(execResult.isOk()).toBe(true);
    if (execResult.isOk()) {
      expect(execResult.value.exitCode).toBe(0);
      expect(execResult.value.stdout).toContain("v");
    }
  }, 180_000);

  it("cache invalidation: changed setup contract → cache miss", async () => {
    const config1 = cfg();

    const resolved1 = await supervisor.resolveEnvironment(config1);
    if (resolved1.isErr()) return;
    const container1 = await supervisor.createContainer(resolved1.value);
    if (container1.isErr()) return;
    await supervisor.runSetup(container1.value, config1);
    await supervisor.destroySandbox(container1.value);

    const config2 = cfg({
      setupContract: makeTestContract({
        setup: ["echo different-setup > /tmp/setup-marker"],
      }),
    });

    const resolved2 = await supervisor.resolveEnvironment(config2);
    expect(resolved2.isOk()).toBe(true);
    if (resolved2.isErr()) return;

    expect(resolved2.value.cachedImage).toBeNull();
  }, 120_000);

  it("committed image does NOT contain exec-injected secrets", async () => {
    const config = cfg();

    const resolved = await supervisor.resolveEnvironment(config);
    if (resolved.isErr()) return;
    const containerResult = await supervisor.createContainer(resolved.value);
    if (containerResult.isErr()) return;

    await supervisor.execWithSecrets(
      containerResult.value,
      ["sh", "-c", "echo $NPM_TOKEN > /dev/null"],
      { NPM_TOKEN: "super-secret-token-xyz" },
    );

    const cacheKey = computeCacheKey({
      setupContract: config.setupContract,
      secrets: config.secrets,
    });
    const cacheResult = await cacheContainer(
      docker,
      containerResult.value.containerId,
      `${cacheKey}-secret-test`,
      config.repoSlug,
    );
    expect(cacheResult.isOk()).toBe(true);
    if (cacheResult.isErr()) return;

    const image = docker.getImage(cacheResult.value);
    const imageInfo = await image.inspect();
    const envVars = imageInfo.Config?.Env ?? [];
    const hasSecret = envVars.some((e: string) =>
      e.includes("super-secret-token-xyz"),
    );
    expect(hasSecret).toBe(false);

    await image.remove({ force: true });
  }, 120_000);
});
