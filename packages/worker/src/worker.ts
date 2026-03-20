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
  createValidationActivities,
} from "@software-factory/temporal-activities";
import { NativeConnection, Worker } from "@temporalio/worker";
import Docker from "dockerode";
import type { WorkerConfig } from "./config.js";
import { otelResource } from "./instrumentation.js";
import {
  OpenTelemetryActivityInboundInterceptor,
  makeWorkflowExporter,
} from "./interceptors.js";
import { logger } from "./logger.js";

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

  // Validation activities (always registered — core pipeline)
  const validationActivities = createValidationActivities({ docker, db });

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
            const providerConfig = {
              apiKey: config.openRouterApiKey ?? "",
              defaultModel: stepConfig.model,
            };
            const supervisor = createSandboxSupervisor(docker);
            const instance = {
              containerId: stepConfig.containerId,
              phase: "execution" as const,
              labels: {},
            };
            return {
              taskId: stepConfig.taskId,
              objective: stepConfig.objective,
              plan: stepConfig.plan,
              repoMap: [...stepConfig.repoMap],
              relevantFiles: [...stepConfig.relevantFiles],
              policies: [...stepConfig.policies],
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
            defaultModel: "openai/gpt-5.4-nano",
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

  // Build OTel workflow exporter sink for V8 sandbox trace bridging.
  // The Temporal interceptors package pins @opentelemetry/sdk-trace-base@1.x
  // while our SDK uses 2.x — runtime compatible but types diverge.
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-grpc"
  );
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  // biome-ignore lint/suspicious/noExplicitAny: bridge sdk-trace-base 1.x/2.x type mismatch between Temporal interceptors and OTel SDK
  const spanExporter: any = otelEndpoint
    ? new OTLPTraceExporter({ url: `${otelEndpoint}/v1/traces` })
    : undefined;

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
      ...validationActivities,
      ...githubActivities,
      ...indexActivities,
      ...llmActivities,
      ...evidenceActivities,
    },
    ...(spanExporter
      ? {
          sinks: {
            exporter: makeWorkflowExporter(spanExporter, otelResource),
          },
        }
      : {}),
    interceptors: {
      activity: [
        (ctx) => ({
          inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
        }),
      ],
    },
  });

  logger.info("Worker created with OTel interceptors");

  return worker;
}
