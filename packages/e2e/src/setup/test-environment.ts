/**
 * E2E test environment — shared Temporal test server + mock activities.
 *
 * Each test file creates ONE environment in beforeAll (expensive) and
 * shares it across tests with unique task IDs for isolation.
 */

import type { Client } from "@temporalio/client";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { NativeConnection, Worker } from "@temporalio/worker";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type MockActivityOptions,
  type MockState,
  createMockActivities,
  createMockState,
} from "./mock-activities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_PATH = resolve(
  __dirname,
  "../../../temporal-workflows/src/index.ts",
);

export interface E2ETestEnvironment {
  readonly testEnv: TestWorkflowEnvironment;
  readonly client: Client;
  readonly nativeConnection: NativeConnection;
  readonly worker: Worker;
  readonly mockState: MockState;
  readonly taskQueue: string;
  teardown(): Promise<void>;
}

export interface CreateE2EOptions {
  /** Unique task queue name to isolate this test file's workflows */
  readonly taskQueue: string;
  /** Override mock activity options */
  readonly mockOptions?: Partial<MockActivityOptions>;
}

/**
 * Create a complete E2E test environment with Temporal test server and mock activities.
 *
 * Uses time-skipping for fast tests. Each test file should use a unique taskQueue.
 */
export async function createE2EEnvironment(
  options: CreateE2EOptions,
): Promise<E2ETestEnvironment> {
  // Dynamic imports to avoid issues with ESM/CJS interop in test runner
  const { TestWorkflowEnvironment } = await import("@temporalio/testing");
  const { Worker } = await import("@temporalio/worker");

  const testEnv = await TestWorkflowEnvironment.createTimeSkipping();

  const mockState = createMockState();
  const mockOpts: MockActivityOptions = {
    state: mockState,
    ...options.mockOptions,
  };
  const activities = createMockActivities(mockOpts);

  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: options.taskQueue,
    workflowsPath: WORKFLOWS_PATH,
    activities,
  });

  // Start worker in background — it processes workflows until shutdown
  const workerRunPromise = worker.run();

  return {
    testEnv,
    client: testEnv.client,
    nativeConnection: testEnv.nativeConnection,
    worker,
    mockState,
    taskQueue: options.taskQueue,
    async teardown() {
      worker.shutdown();
      await workerRunPromise;
      await testEnv.teardown();
    },
  };
}

/**
 * Create an environment with custom activities (for tests that need
 * different mock behavior like kill switch or cost overrides).
 */
export async function createCustomE2EEnvironment(
  options: CreateE2EOptions & {
    readonly activities: Record<string, unknown>;
    readonly mockState?: MockState;
  },
): Promise<E2ETestEnvironment> {
  const { TestWorkflowEnvironment } = await import("@temporalio/testing");
  const { Worker } = await import("@temporalio/worker");

  const testEnv = await TestWorkflowEnvironment.createTimeSkipping();

  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: options.taskQueue,
    workflowsPath: WORKFLOWS_PATH,
    activities: options.activities,
  });

  const workerRunPromise = worker.run();

  return {
    testEnv,
    client: testEnv.client,
    nativeConnection: testEnv.nativeConnection,
    worker,
    mockState: options.mockState ?? createMockState(),
    taskQueue: options.taskQueue,
    async teardown() {
      worker.shutdown();
      await workerRunPromise;
      await testEnv.teardown();
    },
  };
}
