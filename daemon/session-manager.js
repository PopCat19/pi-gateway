/**
 * Session manager for pi-gateway.
 * Manages Pi sessions for incoming requests.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// In-memory session cache
const sessions = new Map();

/**
 * Get or create a Pi session for a conversation.
 * @param {object} options
 * @param {string} options.conversationId - Unique conversation identifier
 * @param {string} options.model - Model to use (provider/model format)
 * @param {string} options.agentDir - Pi agent directory
 * @param {AbortSignal} options.signal - Abort signal
 * @param {import("@earendil-works/pi-coding-agent").ModelRegistry} [options.modelRegistry] - Shared registry
 * @returns {Promise<{session: import("@earendil-works/pi-coding-agent").AgentSession, isNew: boolean}>}
 */
export async function getSession({ conversationId, model, agentDir, signal, modelRegistry: sharedRegistry, enableTools }) {
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
		return { session: existing, isNew: false };
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

	// Always create authStorage (needed for createAgentSession)
	const authStorage = await AuthStorage.create(join(piAgentDir, "auth.json"));

	// Use shared registry or create a standalone one
	let modelRegistry = sharedRegistry || null;
	if (!modelRegistry) {
		modelRegistry = await ModelRegistry.create(authStorage, join(piAgentDir, "models.json"));
	}

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
		noTools: enableTools ? undefined : "all",
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

	return { session, isNew: true };
}

/**
 * Build context from conversation history.
 * Returns a formatted context string for the model.
 * Includes both text content and reasoning_content (where available).
 * @param {Array} messages - Pi/OpenAI format messages
 * @returns {string} Context string
 */
export function buildHistoryContext(messages) {
	const parts = [];

	for (const msg of messages) {
		const text = extractTextFromMessage(msg);
		const reasoning = extractReasoningFromMessage(msg);

		if (msg.role === "user") {
			if (text || reasoning) {
				const label = msg.name ? `User (${msg.name})` : "User";
				parts.push(`${label}: ${text || reasoning}`);
			}
		} else if (msg.role === "assistant") {
			if (text || reasoning) {
				const label = msg.name ? `Assistant (${msg.name})` : "Assistant";
				if (reasoning && text) {
					parts.push(`${label}: ${reasoning}\n\n${text}`);
				} else if (reasoning) {
					parts.push(`${label}: ${reasoning}`);
				} else if (text) {
					parts.push(`${label}: ${text}`);
				}
			}
		} else if (msg.role === "toolResult") {
			if (text) {
				parts.push(`Tool (${msg.toolName || "unknown"}): ${text}`);
			}
		}
	}

	if (parts.length === 0) return "";

	return `[Conversation history — continue from here, responding ONLY as the assistant:]\n\n${parts.join("\n\n")}`;
}

/**
 * Convert a Pi-format message into a proper AgentMessage for seeding session state.
 * @param {object} msg - Message from convertMessages()
 * @param {object} model - Resolved model object
 * @returns {import("@earendil-works/pi-coding-agent").AgentMessage | null}
 */
export function convertToAgentMessage(msg, model) {
	if (!msg) return null;

	if (msg.role === "user") {
		return {
			role: "user",
			content: msg.content,
			timestamp: msg.timestamp || Date.now(),
		};
	}

	if (msg.role === "assistant") {
		const content = [];

		// Convert reasoning_content to Pi thinking block
		if (msg.reasoning_content) {
			content.push({ type: "thinking", thinking: msg.reasoning_content });
		}

		// Add text blocks
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "text") {
					content.push(block);
				}
			}
		}

		return {
			role: "assistant",
			content,
			api: model?.api || "unknown",
			provider: model?.provider || "unknown",
			model: model?.id || "unknown",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: msg.timestamp || Date.now(),
		};
	}

	if (msg.role === "toolResult") {
		return {
			role: "toolResult",
			toolCallId: msg.toolCallId,
			toolName: msg.toolName,
			content: msg.content,
			isError: msg.isError || false,
			timestamp: msg.timestamp || Date.now(),
		};
	}

	return null;
}

/**
 * Extract text content from a message.
 * Handles both string content and array content formats.
 */
function extractTextFromMessage(msg) {
	if (!msg?.content) return "";

	// String content
	if (typeof msg.content === "string") return msg.content;

	// Array content - extract text blocks
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter((c) => c?.type === "text")
			.map((c) => c.text)
			.join("\n");
	}

	return "";
}

/**
 * Extract reasoning content from a message.
 * Handles multiple formats:
 * - OpenAI: message.reasoning_content field
 * - OpenAI: content array with type: "reasoning"
 * - Anthropic: content array with type: "thinking"
 */
function extractReasoningFromMessage(msg) {
	// Direct reasoning_content field (OpenAI streaming format)
	if (msg.reasoning_content) {
		return msg.reasoning_content;
	}

	// Content array with reasoning block
	if (Array.isArray(msg?.content)) {
		const reasoningParts = msg.content
			.filter((c) => c.type === "reasoning" || c.type === "thinking")
			.map((c) => c.thinking || c.text || c.reasoning || "")
			.filter(Boolean);

		if (reasoningParts.length > 0) {
			return reasoningParts.join("\n");
		}

		// Also check for text blocks that might contain tool markers
		// (when frontend sends tool output as regular text)
		const toolMarkers = msg.content.filter((c) => c.type === "text" && isToolMarker(c.text)).map((c) => c.text);

		if (toolMarkers.length > 0) {
			return toolMarkers.join("\n");
		}
	}

	return "";
}

/**
 * Check if text contains tool execution markers.
 */
function isToolMarker(text) {
	if (!text) return false;
	// Match patterns like [bash], [read], [tool (Xs, exit Y)]
	return /^\s*\[(bash|read|write|edit|tool_[\w]+)\]/m.test(text) || /\[(bash|read|write|edit|tool_[\w]+)\s*\([^)]+\)\]/m.test(text);
}

/**
 * Extract text content from assistant message.
 */
function extractText(message) {
	if (!message?.content) return "";
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return message.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("");
	}
	return "";
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
