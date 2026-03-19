import { createRequire } from "node:module";
import { createDb } from "@software-factory/db";
import {
  createAuditActivities,
  createBranchLeaseActivity,
  createCostCheckActivity,
  createKillCheckActivity,
  createRedisClient,
  createSandboxActivities,
  createTaskActivities,
} from "@software-factory/temporal-activities";
import { NativeConnection, Worker } from "@temporalio/worker";
import Docker from "dockerode";
import type { WorkerConfig } from "./config.js";
import { ActivityLogInterceptor } from "./interceptors.js";

const require = createRequire(import.meta.url);

export async function createWorker(config: WorkerConfig): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const { db } = createDb(config.databaseUrl);
  const redis = createRedisClient(config.redisUrl);
  await redis.connect();

  // Create activity implementations with injected dependencies
  const taskActivities = createTaskActivities(db);
  const auditActivities = createAuditActivities(db);
  const safetyActivities = {
    ...createKillCheckActivity(redis),
    ...createCostCheckActivity(redis),
    ...createBranchLeaseActivity(redis),
  };
  const docker = new Docker({
    socketPath: config.dockerSocketPath ?? "/var/run/docker.sock",
  });
  const sandboxActivities = createSandboxActivities(docker);

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: "sf-orchestration",
    workflowsPath: require.resolve("@software-factory/temporal-workflows"),
    activities: {
      ...taskActivities,
      ...auditActivities,
      ...safetyActivities,
      ...sandboxActivities,
    },
    interceptors: {
      activity: [() => ({ inbound: new ActivityLogInterceptor() })],
    },
  });

  return worker;
}
