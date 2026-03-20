import { loadWorkerConfig } from "./config.js";
import { logger } from "./logger.js";
import { createWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  logger.info(
    {
      temporalAddress: config.temporalAddress,
      namespace: config.temporalNamespace,
    },
    "Starting worker",
  );

  const worker = await createWorker(config);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down worker");
    worker.shutdown();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await worker.run();
  logger.info("Worker stopped");
}

main().catch((err: unknown) => {
  logger.fatal(
    { error: err instanceof Error ? err.message : String(err) },
    "Worker failed to start",
  );
  process.exit(1);
});
