import { createRequire } from "node:module";
import { createDb } from "@software-factory/db";
import {
  CredentialBroker,
  MutationSerializer,
  createAuditActivities,
  createBranchLeaseActivity,
  createCostCheckActivity,
  createEvidenceActivities,
  createGitHubActivities,
  createIndexActivities,
  createKillCheckActivity,
  createLLMActivities,
  createPlanActivities,
  createRedisClient,
  createSandboxActivities,
  createSandboxSupervisor,
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

  // GitHub activities (requires App credentials)
  const githubActivities = config.githubAppId
    ? createGitHubActivities({
        credentialBroker: new CredentialBroker(
          config.githubAppId,
          config.githubPrivateKey ?? "",
          config.githubInstallationId ?? 0,
        ),
        serializer: new MutationSerializer(),
        installationId: config.githubInstallationId ?? 0,
        db,
        apiUrl: config.apiUrl,
      })
    : {};

  // Index activities
  const indexActivities = createIndexActivities({ db });

  // LLM activities
  const llmActivities = config.openRouterApiKey
    ? {
        ...createLLMActivities({
          createAgentConfig: async (stepConfig) => {
            const { createProvider, createAgentTools, createCostTracker } =
              await import("@software-factory/temporal-activities");
            const providerConfig = {
              apiKey: config.openRouterApiKey ?? "",
              defaultModel: stepConfig.model,
            };
            const supervisor = (
              await import("@software-factory/temporal-activities")
            ).createSandboxSupervisor(docker);
            const instance = {
              containerId: "",
              phase: "execution" as const,
              labels: {},
            };
            return {
              taskId: stepConfig.taskId,
              objective: stepConfig.objective,
              plan: stepConfig.plan,
              repoMap: [],
              relevantFiles: [],
              policies: [],
              sandbox: supervisor,
              sandboxInstance: instance,
              provider: providerConfig,
              budgetCents: stepConfig.budgetCents,
              maxSteps: stepConfig.maxSteps,
              wallClockTimeoutMs: stepConfig.wallClockTimeoutMs,
              costTrackerDeps: {
                checkCostBudget: safetyActivities.checkCostBudget,
                recordCost: safetyActivities.recordCost,
                openRouterApiKey: config.openRouterApiKey,
              },
              checkKillSwitch: safetyActivities.checkKillSwitch,
            };
          },
        }),
        ...createPlanActivities({
          providerConfig: {
            apiKey: config.openRouterApiKey,
            defaultModel: "anthropic/claude-sonnet-4-20250514",
          },
        }),
      }
    : {};

  // Evidence activities
  const supervisor = createSandboxSupervisor(docker);
  const evidenceActivities = config.minioSecretKey
    ? createEvidenceActivities({
        db,
        sandbox: supervisor,
        artifactStoreConfig: {
          endpoint: config.minioEndpoint ?? "http://localhost:9000",
          region: "us-east-1",
          bucket: config.minioBucket ?? "factory-artifacts",
          accessKeyId: config.minioAccessKey ?? "factory",
          secretAccessKey: config.minioSecretKey,
          forcePathStyle: true,
        },
      })
    : {};

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
      ...githubActivities,
      ...indexActivities,
      ...llmActivities,
      ...evidenceActivities,
    },
    interceptors: {
      activity: [() => ({ inbound: new ActivityLogInterceptor() })],
    },
  });

  return worker;
}
