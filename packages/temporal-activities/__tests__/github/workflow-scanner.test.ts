import { describe, expect, it } from "vitest";
import {
  scanWorkflowContent,
  scanWorkflows,
} from "../../src/github/workflow-scanner.js";

describe("scanWorkflowContent", () => {
  it("detects pull_request_target trigger", () => {
    const content = `
name: PR Target
on:
  pull_request_target:
    types: [opened, synchronize]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const result = scanWorkflowContent(
      ".github/workflows/pr-target.yml",
      content,
    );
    expect(result.dangerousWorkflows).toHaveLength(1);
    expect(result.dangerousWorkflows[0].path).toBe(
      ".github/workflows/pr-target.yml",
    );
    expect(result.dangerousWorkflows[0].triggers).toContain(
      "pull_request_target",
    );
  });

  it("does not flag safe pull_request trigger", () => {
    const content = `
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const result = scanWorkflowContent(".github/workflows/ci.yml", content);
    expect(result.dangerousWorkflows).toHaveLength(0);
  });

  it("detects workflow_run trigger", () => {
    const content = `
name: Post CI
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploying"
`;
    const result = scanWorkflowContent(
      ".github/workflows/post-ci.yml",
      content,
    );
    expect(result.dangerousWorkflows).toHaveLength(1);
    expect(result.dangerousWorkflows[0].triggers).toContain("workflow_run");
  });

  it("detects multiple dangerous triggers in single workflow", () => {
    const content = `
name: Multi-trigger
on:
  pull_request_target:
    types: [opened]
  workflow_run:
    workflows: ["CI"]
    types: [completed]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "test"
`;
    const result = scanWorkflowContent(".github/workflows/multi.yml", content);
    expect(result.dangerousWorkflows).toHaveLength(1);
    expect(result.dangerousWorkflows[0].triggers).toContain(
      "pull_request_target",
    );
    expect(result.dangerousWorkflows[0].triggers).toContain("workflow_run");
  });

  it("handles invalid YAML gracefully", () => {
    const content = "this: is: not: valid:\n  yaml: [\n";
    const result = scanWorkflowContent(".github/workflows/bad.yml", content);
    expect(result.scanErrors.length).toBeGreaterThan(0);
    expect(result.scanErrors[0]).toContain("invalid YAML");
  });

  it("handles workflow with string on: trigger", () => {
    const content = `
name: Simple
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "ok"
`;
    const result = scanWorkflowContent(".github/workflows/simple.yml", content);
    expect(result.dangerousWorkflows).toHaveLength(0);
  });

  it("handles workflow with array on: triggers", () => {
    const content = `
name: Array
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "ok"
`;
    const result = scanWorkflowContent(".github/workflows/array.yml", content);
    expect(result.dangerousWorkflows).toHaveLength(0);
  });
});

describe("scanWorkflows", () => {
  it("returns empty results for no workflow files", () => {
    const result = scanWorkflows([]);
    expect(result.dangerousWorkflows).toHaveLength(0);
    expect(result.scanErrors).toHaveLength(0);
  });

  it("aggregates results from multiple files", () => {
    const files = [
      {
        path: ".github/workflows/safe.yml",
        content:
          "name: Safe\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
      },
      {
        path: ".github/workflows/dangerous.yml",
        content:
          "name: Dangerous\non:\n  pull_request_target:\n    types: [opened]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
      },
    ];
    const result = scanWorkflows(files);
    expect(result.dangerousWorkflows).toHaveLength(1);
    expect(result.dangerousWorkflows[0].path).toBe(
      ".github/workflows/dangerous.yml",
    );
  });
});
