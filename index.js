/**
 * pi-gateway - Pi extension for OpenAI-compatible API gateway
 * 
 * This extension exposes Pi as an OpenAI-compatible backend,
 * allowing any frontend (SillyTavern, Open WebUI, LibreChat, etc.) to connect.
 * 
 * Pi commands:
 *   /gateway start    - Start the OpenAI-compatible server
 *   /gateway stop     - Stop the server
 *   /gateway status   - Check server status
 *   /gateway config   - Show current configuration
 */

import { createServer } from "./daemon/server.js";
import { loadConfig, validateConfig } from "./lib/config.js";
import { getPaths } from "./lib/paths.js";

/** @type {import("node:http").Server | null} */
let server = null;

/** @type {ReturnType<typeof getPaths> | null} */
let paths = null;

/** @type {import("./lib/config.js").GatewayConfig | null} */
let config = null;

/**
 * Start the gateway server.
 * @param {{ context: import("@mariozechner/pi-coding-agent").ExtensionContext }} options
 */
export async function startServer({ context }) {
  if (server) {
    return { success: false, message: "Server is already running." };
  }
  
  paths = getPaths({ workspaceDir: context.agentDir });
  config = await loadConfig(paths);
  
  const validation = validateConfig(config);
  if (validation.errors.length > 0) {
    return {
      success: false,
      message: `Invalid configuration:\n- ${validation.errors.join("\n- ")}`,
    };
  }
  
  if (validation.warnings.length > 0) {
    context.logger.warn("gateway-config-warnings", validation.warnings.join("\n"));
  }
  
  server = await createServer({ paths, config });
  
  const address = server.address();
  return {
    success: true,
    message: `Gateway server started on http://${config.host}:${address.port}`,
    url: `http://localhost:${address.port}`,
  };
}

/**
 * Stop the gateway server.
 */
export async function stopServer() {
  if (!server) {
    return { success: false, message: "Server is not running." };
  }
  
  await new Promise((resolve) => server.close(resolve));
  server = null;
  
  return { success: true, message: "Gateway server stopped." };
}

/**
 * Get server status.
 */
export function getStatus() {
  if (!server) {
    return { running: false };
  }
  
  const address = server.address();
  return {
    running: true,
    host: config?.host,
    port: address.port,
    url: `http://localhost:${address.port}`,
  };
}

/**
 * Extension factory - creates the gateway extension.
 * @param {{ logger: import("@mariozechner/pi-coding-agent").Logger }} options
 */
export default function createGatewayExtension({ logger }) {
  return {
    name: "pi-gateway",
    
    commands: {
      "gateway": {
        description: "Manage OpenAI-compatible API gateway",
        subcommands: {
          start: {
            description: "Start the gateway server",
            handler: async () => {
              const result = await startServer({ context: { agentDir: process.env.PI_AGENT_DIR, logger } });
              return result.message;
            },
          },
          stop: {
            description: "Stop the gateway server",
            handler: async () => {
              const result = await stopServer();
              return result.message;
            },
          },
          status: {
            description: "Check gateway status",
            handler: () => {
              const status = getStatus();
              return status.running
                ? `Gateway running on ${status.url}`
                : "Gateway is not running.";
            },
          },
          config: {
            description: "Show current configuration",
            handler: () => {
              if (!config) {
                return "Gateway not initialized. Run /gateway start first.";
              }
              return JSON.stringify(config, null, 2);
            },
          },
        },
      },
    },
  };
}