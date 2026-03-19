import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as TOML from "@iarna/toml";
import chalk from "chalk";
import { Command } from "commander";
import {
  type CLIConfig,
  getUserConfigPath,
  loadConfig,
  maskApiKey,
} from "../config.js";

export function createConfigCommand(getConfig: () => CLIConfig): Command {
  const cmd = new Command("config").description("Manage CLI configuration");

  cmd
    .command("init")
    .description("Create user config at XDG path")
    .action(() => {
      const configPath = getUserConfigPath();
      if (existsSync(configPath)) {
        console.log(chalk.yellow(`Config already exists at ${configPath}`));
        return;
      }

      const defaultConfig = {
        api_url: "http://localhost:3000",
        api_key: "",
      };

      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, TOML.stringify(defaultConfig as TOML.JsonMap));
      console.log(chalk.green(`Config created at ${configPath}`));
    });

  cmd
    .command("show")
    .description("Display resolved config (API key masked)")
    .action(() => {
      const config = getConfig();
      console.log(chalk.bold("Resolved configuration:"));
      console.log(`  API URL:  ${config.apiUrl}`);
      console.log(`  API Key:  ${maskApiKey(config.apiKey)}`);
      console.log(`  JSON:     ${config.json}`);
    });

  cmd
    .command("set")
    .description("Set a value in user config")
    .argument("<key>", "Config key (api_url, api_key)")
    .argument("<value>", "Config value")
    .action((key: string, value: string) => {
      const configPath = getUserConfigPath();
      let existing: Record<string, unknown> = {};

      if (existsSync(configPath)) {
        try {
          existing = TOML.parse(
            readFileSync(configPath, "utf8"),
          ) as unknown as Record<string, unknown>;
        } catch {
          // Start fresh if file is corrupt
        }
      } else {
        mkdirSync(dirname(configPath), { recursive: true });
      }

      existing[key] = value;
      writeFileSync(configPath, TOML.stringify(existing as TOML.JsonMap));
      console.log(chalk.green(`Set ${key} in ${configPath}`));
    });

  cmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      console.log(getUserConfigPath());
    });

  return cmd;
}
