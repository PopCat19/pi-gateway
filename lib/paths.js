import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/**
 * Resolves all package and runtime paths.
 * @param {{ agentDir?: string, workspaceDir?: string }} [options]
 */
export function getPaths(options = {}) {
  const agentDir = options.agentDir ?? path.join(homedir(), ".pi", "agent");
  const workspaceDir = options.workspaceDir ?? path.join(agentDir, "pi-gateway");
  return {
    packageRoot,
    agentDir,
    workspaceDir,
    configPath: path.join(workspaceDir, "config.json"),
    runDir: path.join(workspaceDir, "run"),
    logsDir: path.join(workspaceDir, "logs"),
    sessionsDir: path.join(workspaceDir, "sessions"),
    daemonLogPath: path.join(workspaceDir, "logs", "daemon.log"),
    statusPath: path.join(workspaceDir, "run", "status.json"),
    pidPath: path.join(workspaceDir, "run", "daemon.pid"),
    lockPath: path.join(workspaceDir, "run", "daemon.lock"),
  };
}

/**
 * Resolves per-conversation paths.
 * @param {ReturnType<typeof getPaths>} paths
 * @param {string} conversationId
 */
export function getConversationPaths(paths, conversationId) {
  const conversationDir = path.join(paths.sessionsDir, conversationId);
  return {
    conversationDir,
    sessionFile: path.join(conversationDir, "session.json"),
    memoryFile: path.join(conversationDir, "memory.md"),
  };
}