import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";

export interface CLIConfig {
  readonly apiUrl: string;
  readonly apiKey: string | undefined;
  readonly json: boolean;
}

interface TOMLConfig {
  readonly api_url?: string;
  readonly api_key?: string;
}

function getXdgConfigHome(): string {
  return (
    process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "~", ".config")
  );
}

function getUserConfigPath(): string {
  return join(getXdgConfigHome(), "software-factory", "config.toml");
}

function getProjectConfigPath(): string {
  return join(process.cwd(), ".factory", "config.toml");
}

function readTomlFile(path: string): TOMLConfig | undefined {
  try {
    const content = readFileSync(path, "utf8");
    return TOML.parse(content) as unknown as TOMLConfig;
  } catch {
    return undefined;
  }
}

/**
 * 5-tier config precedence (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Project config (.factory/config.toml)
 * 4. User config (~/.config/software-factory/config.toml)
 * 5. Built-in defaults
 */
export function loadConfig(flags: Partial<CLIConfig>): CLIConfig {
  const userConfig = readTomlFile(getUserConfigPath());
  const projectConfig = readTomlFile(getProjectConfigPath());

  const apiUrl =
    flags.apiUrl ||
    process.env.FACTORY_API_URL ||
    projectConfig?.api_url ||
    userConfig?.api_url ||
    "http://localhost:3000";

  const apiKey =
    flags.apiKey ||
    process.env.FACTORY_API_KEY ||
    projectConfig?.api_key ||
    userConfig?.api_key ||
    undefined;

  const json = flags.json ?? false;

  return { apiUrl, apiKey, json };
}

export function maskApiKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}${"*".repeat(key.length - 4)}`;
}

export { getUserConfigPath, getProjectConfigPath, getXdgConfigHome };
