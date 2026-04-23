#!/usr/bin/env node
import { loadConfig, validateConfig } from "../lib/config.js";
import { getPaths } from "../lib/paths.js";
import { PiGatewayDaemon } from "../daemon/runtime.js";

function parseArgs(argv) {
  let workspace;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace" && argv[i + 1]) {
      workspace = argv[i + 1];
      i++;
    }
  }
  return { workspace };
}

const args = parseArgs(process.argv.slice(2));
const paths = getPaths({ workspaceDir: args.workspace });
const config = await loadConfig(paths);
const validation = validateConfig(config);

if (validation.errors.length > 0) {
  console.error(`Invalid pi-gateway config:\n- ${validation.errors.join("\n- ")}`);
  process.exit(1);
}

if (validation.warnings.length > 0) {
  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }
}

const daemon = new PiGatewayDaemon({ paths, config });

const shutdown = async (exitCode = 0) => {
  await daemon.stop().catch(() => undefined);
  process.exit(exitCode);
};

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});
process.on("uncaughtException", (error) => {
  console.error(error);
  void shutdown(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  void shutdown(1);
});

try {
  await daemon.start();
  const address = daemon.server.address();
  console.log(`pi-gateway daemon listening on http://localhost:${address.port}`);
  console.log(`PID: ${process.pid}`);
  console.log(`OpenAI-compatible endpoints:`);
  console.log(`  POST /v1/chat/completions`);
  console.log(`  GET  /v1/models`);
} catch (error) {
  console.error(error);
  await daemon.stop().catch(() => undefined);
  process.exit(1);
}