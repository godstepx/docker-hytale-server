#!/usr/bin/env bun
/**
 * Configuration Generator
 * Generates server configuration from environment variables using a JSON
 * template. Supports strict mode for validation.
 *
 * Usage: generate-config.ts
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";
import { logDebug, logInfo, logWarn, logError, die } from "./log-utils.ts";

// Paths
const TEMPLATE_DIR = process.env.TEMPLATE_DIR || "/opt/hytale/templates";
const TEMPLATE_FILE = resolve(TEMPLATE_DIR, "server-config.template.json");
const OUTPUT_FILE = process.env.CONFIG_OUTPUT || "/data/config.json";

// Configuration mapping interface
interface ConfigMapping {
  envVar: string;
  jsonPath: string;
  type: "string" | "number" | "boolean";
  defaultValue: string;
}

// Maps environment variables to JSON paths
// Format: ENV_VAR:json.path:type:default
const CONFIG_MAPPINGS: ConfigMapping[] = [
  { envVar: "SERVER_NAME", jsonPath: "server.name", type: "string", defaultValue: "Hytale Server" },
  { envVar: "MAX_PLAYERS", jsonPath: "server.maxPlayers", type: "number", defaultValue: "20" },
  { envVar: "VIEW_DISTANCE", jsonPath: "server.viewDistance", type: "number", defaultValue: "10" },
  { envVar: "DIFFICULTY", jsonPath: "server.difficulty", type: "string", defaultValue: "normal" },
  { envVar: "MOTD", jsonPath: "server.motd", type: "string", defaultValue: "A Hytale Server" },
  { envVar: "SEED", jsonPath: "world.seed", type: "string", defaultValue: "" },
  { envVar: "WORLD_NAME", jsonPath: "world.name", type: "string", defaultValue: "world" },
  { envVar: "ENABLE_PVP", jsonPath: "server.pvp", type: "boolean", defaultValue: "true" },
  {
    envVar: "SPAWN_PROTECTION",
    jsonPath: "server.spawnProtection",
    type: "number",
    defaultValue: "16",
  },
  { envVar: "TICK_RATE", jsonPath: "server.tickRate", type: "number", defaultValue: "20" },
  { envVar: "NETWORK_PORT", jsonPath: "network.port", type: "number", defaultValue: "5520" },
  {
    envVar: "NETWORK_COMPRESSION",
    jsonPath: "network.compression",
    type: "boolean",
    defaultValue: "true",
  },
];

/**
 * Check if template exists
 */
function checkTemplate(): void {
  if (!existsSync(TEMPLATE_FILE)) {
    die(`Template file not found: ${TEMPLATE_FILE}`);
  }
}

/**
 * Get value from environment or use default
 */
function getConfigValue(envVar: string, defaultValue: string): string {
  return process.env[envVar] || defaultValue;
}

/**
 * Set a nested property in an object using dot notation
 */
function setNestedProperty(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;

    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    current[lastPart] = value;
  }
}

/**
 * Apply configuration mappings to template
 */
function applyMappings(template: any): any {
  const config = JSON.parse(JSON.stringify(template)); // Deep clone

  for (const mapping of CONFIG_MAPPINGS) {
    const value = getConfigValue(mapping.envVar, mapping.defaultValue);

    // Skip empty values (unless they have a default)
    if (!value && !mapping.defaultValue) {
      continue;
    }

    // Convert value based on type
    let finalValue: any;
    switch (mapping.type) {
      case "number": {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue)) {
          logWarn(
            `Invalid number for ${mapping.envVar}: ${value}, using default: ${mapping.defaultValue}`
          );
          finalValue = parseInt(mapping.defaultValue, 10) || 0;
        } else {
          finalValue = numValue;
        }
        break;
      }
      case "boolean": {
        const lowerValue = value.toLowerCase();
        finalValue = lowerValue === "true" || lowerValue === "1";
        break;
      }
      case "string":
      default:
        finalValue = value;
        break;
    }

    setNestedProperty(config, mapping.jsonPath, finalValue);
    logDebug(`Set ${mapping.jsonPath} = ${finalValue}`);
  }

  return config;
}

/**
 * Check for unknown HYTALE_ environment variables
 */
function checkUnknownVars(): string[] {
  const knownVars = new Set<string>();

  // Add mapped vars
  for (const mapping of CONFIG_MAPPINGS) {
    knownVars.add(mapping.envVar);
  }

  // Add known non-config vars
  const additionalKnown = [
    "HYTALE_VERSION",
    "HYTALE_STRICT_CONFIG",
    "HYTALE_CLI_URL",
    "HYTALE_PATCHLINE",
    "DOWNLOAD_MODE",
    "SERVER_URL",
    "ASSETS_URL",
    "SERVER_SHA256",
    "ASSETS_SHA256",
    "JAVA_XMS",
    "JAVA_XMX",
    "JAVA_OPTS",
    "DRY_RUN",
    "TZ",
    "LOG_LEVEL",
    "LAUNCHER_PATH",
    "FORCE_DOWNLOAD",
    "CHECK_UPDATES",
    "SERVER_PORT",
    "BIND_ADDRESS",
    "AUTH_MODE",
    "DISABLE_SENTRY",
    "ENABLE_BACKUPS",
    "BACKUP_FREQUENCY",
    "BACKUP_DIR",
    "ACCEPT_EARLY_PLUGINS",
    "ALLOW_OP",
    "DATA_DIR",
    "CONFIG_OUTPUT",
    "TEMPLATE_DIR",
  ];

  for (const v of additionalKnown) {
    knownVars.add(v);
  }

  const unknownVars: string[] = [];

  // Check all environment variables
  for (const [name] of Object.entries(process.env)) {
    // Check if this is a config-related var we should validate
    if (name.startsWith("HYTALE_") || CONFIG_MAPPINGS.some((m) => m.envVar === name)) {
      if (!knownVars.has(name)) {
        unknownVars.push(name);
      }
    }
  }

  if (unknownVars.length > 0) {
    const isStrict = process.env.HYTALE_STRICT_CONFIG === "true";

    if (isStrict) {
      logError("Unknown configuration variables (strict mode enabled):");
      for (const v of unknownVars) {
        logError(`  - ${v}`);
      }
      die("Configuration validation failed");
    } else {
      logWarn("Unknown configuration variables (will be ignored):");
      for (const v of unknownVars) {
        logWarn(`  - ${v}`);
      }
    }
  }

  return unknownVars;
}

/**
 * Generate configuration file
 */
function generateConfig(): void {
  logInfo("Generating server configuration...");

  checkTemplate();
  checkUnknownVars();

  // Read template
  const templateContent = readFileSync(TEMPLATE_FILE, "utf-8");
  const template = JSON.parse(templateContent);

  // Apply mappings
  const config = applyMappings(template);

  // Write output
  const outputContent = JSON.stringify(config, null, 2);
  writeFileSync(OUTPUT_FILE, outputContent, "utf-8");

  logInfo(`Configuration written to: ${OUTPUT_FILE}`);
}

/**
 * Main
 */
async function main(): Promise<void> {
  // Dry run mode
  if (process.env.DRY_RUN === "true") {
    logInfo("[DRY_RUN] Would generate configuration:");
    logInfo(`[DRY_RUN] Template: ${TEMPLATE_FILE}`);
    logInfo(`[DRY_RUN] Output: ${OUTPUT_FILE}`);
    return;
  }

  // Ensure output directory exists
  const outputDir = dirname(OUTPUT_FILE);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  generateConfig();
}

// Run main if executed directly
if (import.meta.main) {
  main().catch((error) => {
    logError(`Configuration generation failed: ${error}`);
    process.exit(1);
  });
}
