import { describe, expect, it } from "vitest";
import { AutonomyLevelSchema } from "../src/schemas/autonomy.js";
import { FactoryConfigSchema } from "../src/schemas/config.js";
import { EvidenceBundleSchema } from "../src/schemas/evidence.js";
import { PolicyConfigSchema } from "../src/schemas/policy.js";
import { SetupContractSchema } from "../src/schemas/sandbox.js";
import {
  CreateTaskSchema,
  TaskSchema,
  TaskStateSchema,
} from "../src/schemas/task.js";

// --- TaskStateSchema ---

describe("TaskStateSchema", () => {
  it("accepts all 16 valid states", () => {
    const states = [
      "created",
      "needs_clarification",
      "assigned",
      "in_progress",
      "paused",
      "evidence_ready",
      "changes_requested",
      "approved",
      "pr_created",
      "external_checks_pending",
      "addressing_review_feedback",
      "external_blocked",
      "merge_ready",
      "merged",
      "failed",
      "cancelled",
    ];
    for (const state of states) {
      expect(TaskStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("rejects invalid state", () => {
    expect(TaskStateSchema.safeParse("invalid_state").success).toBe(false);
  });
});

// --- TaskSchema ---

describe("TaskSchema", () => {
  const validTask = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    state: "created",
    objective: "Fix login bug",
    scope: null,
    constraints: null,
    budgetCents: 1000,
    repoId: "660e8400-e29b-41d4-a716-446655440000",
    createdBy: "operator-1",
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
  };

  it("accepts valid task", () => {
    expect(TaskSchema.safeParse(validTask).success).toBe(true);
  });

  it("requires id to be uuid", () => {
    const result = TaskSchema.safeParse({ ...validTask, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("requires objective", () => {
    const result = TaskSchema.safeParse({ ...validTask, objective: "" });
    expect(result.success).toBe(false);
  });

  it("rejects extra fields (.strict())", () => {
    const result = TaskSchema.safeParse({ ...validTask, extraField: "nope" });
    expect(result.success).toBe(false);
  });
});

// --- CreateTaskSchema ---

describe("CreateTaskSchema", () => {
  it("accepts valid creation input", () => {
    const result = CreateTaskSchema.safeParse({
      objective: "Add feature",
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      createdBy: "admin-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing objective", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      createdBy: "admin-1",
    });
    expect(result.success).toBe(false);
  });
});

// --- EvidenceBundleSchema ---

describe("EvidenceBundleSchema", () => {
  const validBundle = {
    objective: "Fix login bug",
    annotatedDiff: [
      {
        file: "src/auth.ts",
        hunkIndex: 0,
        annotation: "Fixed null check",
        riskLevel: "low",
        affectedConsumers: ["login.ts"],
      },
    ],
    blastRadius: { files: 2, packages: 1 },
    ownersImpacted: ["@team/auth"],
    testResults: {
      passed: 10,
      failed: 0,
      skipped: 1,
      newTests: ["auth.test.ts"],
      modifiedTests: [],
      deletedTests: [],
      details: [],
    },
    securityScanResults: {
      vulnerabilities: [],
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
    },
    lintResults: { errorCount: 0, warningCount: 0, details: [] },
    protectedSurfaceEdits: [],
    migrationImpact: {
      hasMigrations: false,
      migrationFiles: [],
      schemaChanges: [],
    },
    revertabilityClass: "clean_revert",
    unresolvedAssumptions: [],
    commandsRun: [{ command: "pnpm test", exitCode: 0, durationMs: 5000 }],
    pendingExternalChecks: [],
    schemaVersion: 1,
    taskId: "550e8400-e29b-41d4-a716-446655440000",
    attemptNumber: 1,
    baseSha: "abc123",
    headSha: "def456",
    mergeBaseSha: "abc123",
    createdAt: "2026-03-18T00:00:00Z",
  };

  it("accepts valid evidence bundle with all 13 fields", () => {
    expect(EvidenceBundleSchema.safeParse(validBundle).success).toBe(true);
  });

  it("rejects invalid revertabilityClass", () => {
    const result = EvidenceBundleSchema.safeParse({
      ...validBundle,
      revertabilityClass: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("requires all 13 evidence fields", () => {
    const { objective: _, ...missing } = validBundle;
    expect(EvidenceBundleSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects extra fields (.strict())", () => {
    const result = EvidenceBundleSchema.safeParse({
      ...validBundle,
      confidence: 0.95,
    });
    expect(result.success).toBe(false);
  });
});

// --- PolicyConfigSchema ---

describe("PolicyConfigSchema", () => {
  const validPolicy = {
    repoId: "550e8400-e29b-41d4-a716-446655440000",
    name: "deny-workflows",
    policyType: "edit_deny",
    protectionClass: "hard_protected",
    pathPatterns: [".github/workflows/**"],
    autonomyLevel: "L1",
    requiresApproval: true,
    approverRole: "admin",
    isActive: true,
  };

  it("accepts valid policy", () => {
    expect(PolicyConfigSchema.safeParse(validPolicy).success).toBe(true);
  });

  it("requires pathPatterns to be non-empty array", () => {
    const result = PolicyConfigSchema.safeParse({
      ...validPolicy,
      pathPatterns: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra fields (.strict())", () => {
    const result = PolicyConfigSchema.safeParse({
      ...validPolicy,
      extraField: true,
    });
    expect(result.success).toBe(false);
  });
});

// --- AutonomyLevelSchema ---

describe("AutonomyLevelSchema", () => {
  it.each(["L0", "L1", "L2"])("accepts %s", (level) => {
    expect(AutonomyLevelSchema.safeParse(level).success).toBe(true);
  });

  it("rejects L3", () => {
    expect(AutonomyLevelSchema.safeParse("L3").success).toBe(false);
  });

  it("rejects lowercase", () => {
    expect(AutonomyLevelSchema.safeParse("l1").success).toBe(false);
  });
});

// --- FactoryConfigSchema ---

describe("FactoryConfigSchema", () => {
  it("defaults reviewTimeoutMs to 14400000 (4 hours)", () => {
    const minimal = {
      api: {},
      database: { connectionString: "postgres://localhost/factory" },
      redis: { url: "redis://localhost" },
      temporal: {},
      objectStorage: {
        endpoint: "http://localhost:9000",
        accessKey: "key",
        secretKey: "secret",
      },
      github: {
        appId: "123",
        privateKeyPath: "/keys/app.pem",
        clientId: "Iv1.abc",
        clientSecret: "secret",
        webhookSecret: "whsec",
      },
      llm: {
        apiKey: "sk-test",
        defaultModel: "openai/gpt-4o",
      },
      autonomy: {},
      review: {},
      sandbox: {},
    };
    const result = FactoryConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.timeoutMs).toBe(14_400_000);
    }
  });
});

// --- SetupContractSchema ---

describe("SetupContractSchema", () => {
  const validContract = {
    version: "1",
    image: "node:22-slim",
    setup: ["npm install"],
    maintenance: ["npm ci"],
    secrets: {
      setup_only: ["NPM_TOKEN"],
      runtime: ["DATABASE_URL"],
      per_tool: [{ name: "GITHUB_TOKEN", tools: ["gh"] }],
    },
    health_check: ["node --version"],
  };

  it("accepts valid setup contract", () => {
    expect(SetupContractSchema.safeParse(validContract).success).toBe(true);
  });

  it("requires version", () => {
    const { version: _, ...missing } = validContract;
    expect(SetupContractSchema.safeParse(missing).success).toBe(false);
  });

  it("requires image", () => {
    const { image: _, ...missing } = validContract;
    expect(SetupContractSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects extra fields (.strict())", () => {
    const result = SetupContractSchema.safeParse({
      ...validContract,
      extraField: true,
    });
    expect(result.success).toBe(false);
  });
});
