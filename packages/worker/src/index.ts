import { createRequire } from "node:module";
import { loadWorkerConfig } from "./config.js";
import { logger } from "./logger.js";
import { createWorker } from "./worker.js";

// Fix: docker-modem's redirect handler is broken for Unix socket connections.
// Docker Desktop for Mac returns 3xx redirects for certain API calls (e.g. exec).
// The redirect handler constructs a URL without the socketPath, causing DNS lookup
// for "containers" (parsed from the Docker API path). Disabling redirects is safe —
// the Docker API over Unix sockets should never require redirect following.
const require_ = createRequire(import.meta.url);
const dockerModemHttp = require_("docker-modem/lib/http");
dockerModemHttp.maxRedirects = 0;

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
