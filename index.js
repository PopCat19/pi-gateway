/**
 * pi-gateway - Pi extension for OpenAI-compatible API gateway
 */

import { createServer } from "./daemon/server.js";
import { loadConfig, validateConfig } from "./lib/config.js";
import { getPaths } from "./lib/paths.js";

let server = null;
let paths = null;
let config = null;

function sendText(pi, text) {
  pi.sendMessage({ customType: "pi-gateway", content: text, display: true });
}

function helpText() {
  return [
    "`/gateway start` starts the OpenAI-compatible HTTP server.",
    "`/gateway stop` stops the server.",
    "`/gateway status` shows server health and port.",
    "`/gateway config` prints the current configuration.",
    "",
    "Config: " + (paths?.configPath || "~/.pi/agent/pi-gateway/config.json"),
  ].join("\n");
}

export default function (pi) {
  pi.registerCommand("gateway", {
    description: "Manage the OpenAI-compatible API gateway: /gateway start|stop|status|config",
    handler: async (input, ctx) => {
      const args = input.trim().split(/\s+/);
      const subcommand = args[0] || "help";
      
      paths = getPaths({ agentDir: process.env.PI_AGENT_DIR || ctx?.agentDir });
      
      if (subcommand === "start") {
        if (server) {
          sendText(pi, "Gateway server is already running.");
          return;
        }
        
        try {
          config = await loadConfig(paths);
          const validation = validateConfig(config);
          
          if (validation.errors.length > 0) {
            sendText(pi, `Configuration errors:\n- ${validation.errors.join("\n- ")}`);
            return;
          }
          
          if (validation.warnings.length > 0) {
            for (const warning of validation.warnings) {
              pi.logger?.warn?.("gateway-config", warning);
            }
          }
          
          server = await createServer({ paths, config });
          const address = server.address();
          sendText(pi, `Gateway server started.\nURL: http://localhost:${address.port}\nEndpoints: /v1/chat/completions, /v1/models`);
        } catch (error) {
          sendText(pi, `Failed to start gateway: ${error.message}`);
        }
        return;
      }
      
      if (subcommand === "stop") {
        if (!server) {
          sendText(pi, "Gateway server is not running.");
          return;
        }
        
        await new Promise((resolve) => server.close(resolve));
        server = null;
        sendText(pi, "Gateway server stopped.");
        return;
      }
      
      if (subcommand === "status") {
        if (!server) {
          sendText(pi, "Gateway server is not running.\nConfig: " + paths?.configPath);
        } else {
          const address = server.address();
          sendText(pi, [
            "Gateway server running.",
            `Host: ${config?.host || "127.0.0.1"}`,
            `Port: ${address.port}`,
            `URL: http://localhost:${address.port}`,
            `Config: ${paths?.configPath}`,
          ].join("\n"));
        }
        return;
      }
      
      if (subcommand === "config") {
        if (!config) {
          sendText(pi, "No configuration loaded. Run /gateway start first.");
        } else {
          sendText(pi, JSON.stringify(config, null, 2));
        }
        return;
      }
      
      sendText(pi, helpText());
    },
  });
}