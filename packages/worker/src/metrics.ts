import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("software-factory");

// Task lifecycle
export const taskDuration = meter.createHistogram("factory.task.duration", {
  description: "Task total duration in milliseconds",
  unit: "ms",
});

export const taskCount = meter.createCounter("factory.task.count", {
  description: "Number of tasks by status",
});

// LLM usage
export const llmTokens = meter.createCounter("factory.llm.tokens", {
  description: "LLM tokens consumed",
});

export const llmCost = meter.createCounter("factory.llm.cost", {
  description: "LLM cost in cents",
  unit: "cents",
});

export const llmLatency = meter.createHistogram("factory.llm.latency", {
  description: "LLM call latency in milliseconds",
  unit: "ms",
});

// Evidence review
export const evidenceReviewTime = meter.createHistogram(
  "factory.evidence.review_time",
  {
    description: "Time from evidence_ready to approved/rejected",
    unit: "ms",
  },
);

// Sandbox
export const sandboxDuration = meter.createHistogram(
  "factory.sandbox.duration",
  {
    description: "Sandbox phase duration",
    unit: "ms",
  },
);

// GitHub API
export const githubApiCalls = meter.createCounter("factory.github.api_calls", {
  description: "GitHub API calls by endpoint category",
});

// Credentials
export const credentialRotations = meter.createCounter(
  "factory.credential.rotations",
  {
    description: "Credential rotation events",
  },
);

// Safety metrics (M19)
export const killSwitchActivations = meter.createCounter(
  "factory.safety.kill_activations",
  {
    description: "Kill switch activation events",
  },
);

export const circuitBreakerTrips = meter.createCounter(
  "factory.safety.circuit_trips",
  {
    description: "Circuit breaker trip events",
  },
);

export const costBudgetOverrides = meter.createCounter(
  "factory.safety.budget_overrides",
  {
    description: "Cost budget override events",
  },
);
