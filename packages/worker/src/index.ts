import { loadWorkerConfig } from "./config.js";
import { createWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting worker",
      temporalAddress: config.temporalAddress,
      namespace: config.temporalNamespace,
    }),
  );

  const worker = await createWorker(config);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(JSON.stringify({ level: "info", msg: "Shutting down worker" }));
    worker.shutdown();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await worker.run();
  console.log(JSON.stringify({ level: "info", msg: "Worker stopped" }));
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "Worker failed to start",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
