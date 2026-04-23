/**
 * pi-gateway - Pi extension for OpenAI-compatible API gateway
 */

import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, validateConfig } from "./lib/config.js";
import { getPaths } from "./lib/paths.js";

const packageRoot = path.dirname(fileURLToPath(new URL("./package.json", import.meta.url)));
const daemonBin = path.join(packageRoot, "bin", "pi-gateway-server.mjs");

function sendText(pi, text) {
  pi.sendMessage({ customType: "pi-gateway", content: text, display: true });
}

function helpText(paths) {
  return [
    "`/gateway start` starts the OpenAI-compatible HTTP server (daemon).",
    "`/gateway stop` stops the daemon.",
    "`/gateway status` shows server health and port.",
    "`/gateway config` prints the current configuration.",
    "",
    "Config: " + (paths?.configPath || "~/.pi/agent/pi-gateway/config.json"),
  ].join("\n");
}

async function readStatus(paths) {
  try {
    const content = await readFile(paths.statusPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export default function (pi) {
  pi.registerCommand("gateway", {
    description: "Manage the OpenAI-compatible API gateway: /gateway start|stop|status|config",
    handler: async (input, ctx) => {
      const args = input.trim().split(/\s+/);
      const subcommand = args[0] || "help";
      
      const paths = getPaths({ agentDir: process.env.PI_AGENT_DIR || ctx?.agentDir });
      
      if (subcommand === "start") {
        const status = await readStatus(paths);
        if (status?.pid && await isProcessRunning(status.pid)) {
          sendText(pi, `Gateway daemon already running as pid ${status.pid}.\nURL: ${status.url || `http://localhost:${status.port}`}`);
          return;
        }
        
        try {
          const config = await loadConfig(paths);
          const validation = validateConfig(config);
          
          if (validation.errors.length > 0) {
            sendText(pi, `Configuration errors:\n- ${validation.errors.join("\n- ")}`);
            return;
          }
          
          // Spawn daemon as detached background process
          const child = spawn("node", [daemonBin, "--workspace", paths.workspaceDir], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env },
          });
          child.unref();
          
          // Wait briefly for daemon to start and write status
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          const newStatus = await readStatus(paths);
          if (newStatus?.phase === "running") {
            sendText(pi, [
              "Gateway daemon started.",
              `PID: ${newStatus.pid}`,
              `URL: ${newStatus.url}`,
              `Endpoints: /v1/chat/completions, /v1/models`,
            ].join("\n"));
          } else {
            sendText(pi, "Gateway daemon started. Check `/gateway status` for details.");
          }
        } catch (error) {
          sendText(pi, `Failed to start gateway: ${error.message}`);
        }
        return;
      }
      
      if (subcommand === "stop") {
        const status = await readStatus(paths);
        
        if (!status?.pid) {
          sendText(pi, "Gateway daemon is not running (no PID file).");
          return;
        }
        
        if (!(await isProcessRunning(status.pid))) {
          sendText(pi, `Gateway daemon (pid ${status.pid}) is not running.`);
          return;
        }
        
        try {
          process.kill(status.pid, "SIGTERM");
          // Wait for graceful shutdown
          let attempts = 0;
          while (attempts < 20 && await isProcessRunning(status.pid)) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
          }
          
          if (await isProcessRunning(status.pid)) {
            process.kill(status.pid, "SIGKILL");
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          
          sendText(pi, "Gateway daemon stopped.");
        } catch (error) {
          sendText(pi, `Failed to stop gateway: ${error.message}`);
        }
        return;
      }
      
      if (subcommand === "status") {
        const status = await readStatus(paths);
        
        if (!status) {
          sendText(pi, "Gateway daemon has no status file.\nConfig: " + paths.configPath);
        } else if (!status.pid || !(await isProcessRunning(status.pid))) {
          sendText(pi, [
            `Gateway daemon (pid ${status.pid || "unknown"}) is not running.`,
            `Last phase: ${status.phase}`,
            `Config: ${paths.configPath}`,
          ].join("\n"));
        } else {
          sendText(pi, [
            "Gateway daemon running.",
            `PID: ${status.pid}`,
            `Host: ${status.host || "127.0.0.1"}`,
            `Port: ${status.port}`,
            `URL: ${status.url || `http://localhost:${status.port}`}`,
            `Config: ${paths.configPath}`,
          ].join("\n"));
        }
        return;
      }
      
      if (subcommand === "config") {
        try {
          const config = await loadConfig(paths);
          sendText(pi, JSON.stringify(config, null, 2));
        } catch (error) {
          sendText(pi, `Failed to load config: ${error.message}`);
        }
        return;
      }
      
      sendText(pi, helpText(paths));
    },
  });
}