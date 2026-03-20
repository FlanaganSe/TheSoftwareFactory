/**
 * Temporal OTel interceptors for activity span tracing.
 *
 * The V8 sandbox blocks standard OTel in workflow code.
 * Temporal's OTel integration uses a sinks mechanism to bridge the gap:
 * - makeWorkflowExporter: extracts trace context from V8 sandbox via sinks
 * - OpenTelemetryActivityInboundInterceptor: wraps activity execution in OTel spans
 * - OpenTelemetryWorkflowClientInterceptor: propagates trace context on workflow start/signal
 */

export {
  OpenTelemetryActivityInboundInterceptor,
  makeWorkflowExporter,
} from "@temporalio/interceptors-opentelemetry";
