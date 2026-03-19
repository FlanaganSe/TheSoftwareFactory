#!/usr/bin/env node
import { Command } from "commander";
import { createApproveCommand } from "./commands/approve.js";
import { createChangesCommand } from "./commands/changes.js";
import { createConfigCommand } from "./commands/config.js";
import { createEvidenceCommand } from "./commands/evidence.js";
import { createHealthCommand } from "./commands/health.js";
import { createRejectCommand } from "./commands/reject.js";
import { createReviewCommand } from "./commands/review.js";
import { createStatusCommand } from "./commands/status.js";
import { type CLIConfig, loadConfig } from "./config.js";

const program = new Command()
  .name("factory")
  .description("Software Factory Control Plane CLI")
  .version("0.1.0");

// Global options
program
  .option("--json", "Output as JSON")
  .option("--no-color", "Disable colors")
  .option("--api-url <url>", "API server URL")
  .option("--api-key <key>", "API key");

// Resolve config lazily so global options are parsed first
function getConfig(): CLIConfig {
  const opts = program.opts<{
    json?: boolean;
    apiUrl?: string;
    apiKey?: string;
  }>();
  return loadConfig({
    json: opts.json,
    apiUrl: opts.apiUrl,
    apiKey: opts.apiKey,
  });
}

// Register commands
program.addCommand(createStatusCommand(getConfig));
program.addCommand(createEvidenceCommand(getConfig));
program.addCommand(createApproveCommand(getConfig));
program.addCommand(createRejectCommand(getConfig));
program.addCommand(createChangesCommand(getConfig));
program.addCommand(createReviewCommand(getConfig));
program.addCommand(createConfigCommand(getConfig));
program.addCommand(createHealthCommand(getConfig));

program.parse();
