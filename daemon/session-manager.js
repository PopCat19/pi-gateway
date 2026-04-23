/**
 * Session manager for pi-gateway.
 * Manages Pi sessions for incoming requests.
 */

import { createAgentSession, ModelRegistry, AuthStorage, SettingsManager, SessionManager } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// In-memory session cache
const sessions = new Map();

/**
 * Get or create a Pi session for a conversation.
 * @param {object} options
 * @param {string} options.conversationId - Unique conversation identifier
 * @param {string} options.model - Model to use (provider/model format)
 * @param {string} options.agentDir - Pi agent directory
 * @param {AbortSignal} options.signal - Abort signal
 * @returns {Promise<import("@mariozechner/pi-coding-agent").AgentSession>}
 */
export async function getSession({ conversationId, model, agentDir, signal }) {
  // Check for existing session
  const existing = sessions.get(conversationId);
  if (existing && !signal?.aborted) {
    // Update model if changed
    if (model && existing.model) {
      const [provider, ...modelParts] = model.split("/");
      const modelId = modelParts.join("/");
      const registryModel = existing.modelRegistry.find(provider, modelId);
      if (registryModel && registryModel.id !== existing.model?.id) {
        await existing.setModel(registryModel);
      }
    }
    return existing;
  }
  
  // Create agent directory if needed
  const piAgentDir = agentDir || join(homedir(), ".pi/agent");
  const gatewayDir = join(piAgentDir, "pi-gateway");
  const sessionsDir = join(gatewayDir, "sessions");
  
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
  
  // Resolve model
  const [provider, ...modelParts] = (model || "").split("/");
  const modelId = modelParts.join("/");
  
  // Create auth storage
  const authStorage = await AuthStorage.create(join(piAgentDir, "auth.json"));
  
  // Create model registry
  const modelRegistry = await ModelRegistry.create(authStorage, join(piAgentDir, "models.json"));
  
  // Find the model
  let resolvedModel = null;
  if (provider && modelId) {
    resolvedModel = modelRegistry.find(provider, modelId);
  }
  
  // Create settings manager
  const settingsManager = await SettingsManager.create(process.cwd(), piAgentDir);
  
  // Create session manager (in-memory for now, could use file persistence)
  const sessionManager = SessionManager.inMemory();
  
  // Create agent session
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir: piAgentDir,
    authStorage,
    modelRegistry,
    model: resolvedModel,
    sessionManager,
    settingsManager,
  });
  
  // Cache the session
  sessions.set(conversationId, session);
  
  // Cleanup on abort
  if (signal) {
    signal.addEventListener("abort", () => {
      sessions.delete(conversationId);
      session.dispose();
    });
  }
  
  return session;
}

/**
 * Delete a session from cache.
 * @param {string} conversationId 
 */
export function deleteSession(conversationId) {
  const session = sessions.get(conversationId);
  if (session) {
    session.dispose();
    sessions.delete(conversationId);
  }
}

/**
 * List all active sessions.
 */
export function listSessions() {
  return Array.from(sessions.keys());
}

/**
 * Cleanup all sessions.
 */
export function cleanup() {
  for (const session of sessions.values()) {
    session.dispose();
  }
  sessions.clear();
}