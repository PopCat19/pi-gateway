import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs.js";

const DEFAULT_PORT = 8088;
const DEFAULT_HOST = "127.0.0.1";

/**
 * @typedef {Object} GatewayConfig
 * @property {number} port - Server port
 * @property {string} host - Server host
 * @property {string} defaultModel - Default model ID (provider/model)
 * @property {string} systemPrompt - Default system prompt
 * @property {string} defaultThinkingLevel - Thinking level for sessions
 * @property {boolean} enableTools - Allow tool use
 * @property {string[]} allowedTools - Whitelist of tools (empty = all)
 * @property {string} apiKey - Optional API key for authentication
 */

/**
 * @returns {GatewayConfig}
 */
export function createDefaultConfig() {
  return {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    defaultModel: undefined,
    systemPrompt: undefined,
    defaultThinkingLevel: "medium",
    enableTools: true,
    allowedTools: [],
    apiKey: undefined,
  };
}

/**
 * @param {ReturnType<typeof import('./paths.js').getPaths>} paths
 * @param {Record<string, unknown>} loaded
 * @returns {GatewayConfig}
 */
export function normalizeConfig(paths, loaded) {
  const fallback = createDefaultConfig();
  const input = loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
  
  return {
    port: typeof input.port === "number" ? input.port : fallback.port,
    host: typeof input.host === "string" ? input.host : fallback.host,
    defaultModel: normalizeOptionalString(input.defaultModel) ?? fallback.defaultModel,
    systemPrompt: normalizeOptionalString(input.systemPrompt) ?? fallback.systemPrompt,
    defaultThinkingLevel: normalizeThinkingLevel(input.defaultThinkingLevel) ?? fallback.defaultThinkingLevel,
    enableTools: typeof input.enableTools === "boolean" ? input.enableTools : fallback.enableTools,
    allowedTools: toStringArray(input.allowedTools),
    apiKey: normalizeOptionalString(input.apiKey) ?? fallback.apiKey,
  };
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeThinkingLevel(value) {
  const levels = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
  return typeof value === "string" && levels.has(value) ? value : undefined;
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

/**
 * @param {ReturnType<typeof import('./paths.js').getPaths>} paths
 * @returns {Promise<GatewayConfig>}
 */
export async function loadConfig(paths) {
  const loaded = await readJson(paths.configPath, {});
  return normalizeConfig(paths, loaded);
}

/**
 * @param {ReturnType<typeof import('./paths.js').getPaths>} paths
 * @param {GatewayConfig} config
 */
export async function saveConfig(paths, config) {
  await ensureDir(paths.workspaceDir);
  await writeJson(paths.configPath, normalizeConfig(paths, config));
}

/**
 * @param {GatewayConfig} config
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  
  if (config.port < 1 || config.port > 65535) {
    errors.push("`port` must be between 1 and 65535.");
  }
  
  if (config.defaultModel && !config.defaultModel.includes("/")) {
    warnings.push("`defaultModel` should look like `provider/model-id`.");
  }
  
  if (config.enableTools && config.allowedTools.length > 0) {
    warnings.push(`Tools are restricted to: ${config.allowedTools.join(", ")}`);
  }
  
  return { errors, warnings };
}