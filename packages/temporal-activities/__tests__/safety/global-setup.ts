/**
 * Global setup for safety primitive tests.
 *
 * Starts a single Redis container shared across all safety test files,
 * following the Testcontainers globalSetup pattern:
 * https://node.testcontainers.org/quickstart/global-setup/
 *
 * Connection details are shared via vitest's provide/inject mechanism.
 */

import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";

let container: StartedTestContainer;

export default async function setup({ provide }: TestProject) {
  container = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();

  const redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  provide("redisUrl", redisUrl);
}

export async function teardown() {
  await container?.stop();
}

// Type declaration for provide/inject
// See: https://vitest.dev/config/#globalsetup
declare module "vitest" {
  export interface ProvidedContext {
    redisUrl: string;
  }
}
