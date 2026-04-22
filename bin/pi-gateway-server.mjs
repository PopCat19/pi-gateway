#!/usr/bin/env node
import { createServer } from "../daemon/server.js";
import { loadConfig } from "../lib/config.js";
import { getPaths } from "../lib/paths.js";

const args = parseArgs(process.argv.slice(2));
const paths = getPaths({ workspaceDir: args.workspace });
const config = await loadConfig(paths);

const server = await createServer({ paths, config });
const address = server.address();

console.log(`pi-gateway server listening on http://localhost:${address.port}`);
console.log(`OpenAI-compatible endpoints:`);
console.log(`  POST /v1/chat/completions`);
console.log(`  GET  /v1/models`);

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