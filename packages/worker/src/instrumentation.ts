/**
 * OpenTelemetry instrumentation setup.
 *
 * This file MUST be loaded before the application via:
 *   node --import ./src/instrumentation.ts src/index.ts
 *   (or with tsx: npx tsx --import ./src/instrumentation.ts src/index.ts)
 *
 * 3-tier observability:
 *   Tier 1 (always on): Pino JSON logs + /health + /metrics
 *   Tier 2 (opt-in): Set OTEL_EXPORTER_OTLP_ENDPOINT to enable trace/metric export
 *   Tier 3 (full): docker compose --profile observability for collector + Jaeger + Grafana
 */

import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

export const otelResource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "software-factory",
  [ATTR_SERVICE_VERSION]: "0.1.0",
});

// Prometheus exporter (Tier 1 — always on, read via API /metrics route)
const prometheusExporter = new PrometheusExporter({
  port: 9464,
  preventServerStart: true,
});

// OTLP metric reader (Tier 2/3 — only if endpoint configured)
const otlpMetricReader = otelEndpoint
  ? new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${otelEndpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 60_000,
    })
  : undefined;

const metricReaders = otlpMetricReader
  ? [prometheusExporter, otlpMetricReader]
  : [prometheusExporter];

const sdk = new NodeSDK({
  resource: otelResource,
  traceExporter: otelEndpoint
    ? new OTLPTraceExporter({ url: `${otelEndpoint}/v1/traces` })
    : undefined,
  metricReaders,
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", () => sdk.shutdown());

export { prometheusExporter };
