import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { buildHistoryContext, getSession } from "../session-manager.js";

export const completionsRouter = Router();

/**
 * Convert OpenAI messages format to Pi message format.
 */
function convertMessages(openaiMessages) {
	const messages = [];
	let systemPrompt = "";

	for (const msg of openaiMessages) {
		switch (msg.role) {
			case "system":
				systemPrompt = typeof msg.content === "string" ? msg.content : "";
				break;

			case "user":
				messages.push({
					role: "user",
					content:
						typeof msg.content === "string"
							? msg.content
							: msg.content
									.map((c) => {
										if (c.type === "text")
											return { type: "text", text: c.text };
										if (c.type === "image_url") {
											const url = c.image_url?.url || "";
											// Handle base64 data URLs
											if (url.startsWith("data:")) {
												const match = url.match(/^data:([^;]+);base64,(.+)$/);
												if (match) {
													return {
														type: "image",
														mimeType: match[1],
														data: match[2],
													};
												}
											}
											// For external URLs, we'd need to fetch - skip for now
											return null;
										}
										return null;
									})
									.filter(Boolean),
					timestamp: Date.now(),
				});
				break;

			case "assistant": {
				const content = typeof msg.content === "string" ? msg.content : "";
				const assistantMsg = {
					role: "assistant",
					content: [{ type: "text", text: content }],
					timestamp: Date.now(),
				};
				// Preserve reasoning_content from frontend (tool calls, thinking)
				if (msg.reasoning_content) {
					assistantMsg.reasoning_content = msg.reasoning_content;
				}
				messages.push(assistantMsg);
				break;
			}

			case "tool":
			case "function":
				// Handle tool/function results
				messages.push({
					role: "toolResult",
					toolCallId: msg.tool_call_id || uuidv4(),
					toolName: msg.name || "unknown",
					content: [
						{
							type: "text",
							text:
								typeof msg.content === "string"
									? msg.content
									: JSON.stringify(msg.content),
						},
					],
					isError: false,
					timestamp: Date.now(),
				});
				break;
		}
	}

	return { messages, systemPrompt };
}

/**
 * Extract text content from message.
 */
function extractText(message) {
	if (!message?.content) return "";
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		// Find the last tool_use or toolCall block position
		let lastToolIndex = -1;
		for (let i = 0; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type === "tool_use" || block.type === "toolCall") {
				lastToolIndex = i;
			}
		}

		// Only extract text blocks after the last tool block
		// If no tool blocks, include all text blocks
		const startIndex = lastToolIndex >= 0 ? lastToolIndex + 1 : 0;
		const parts = [];

		for (let i = startIndex; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type === "text") {
				const text = block.text || "";
				if (parts.length > 0) {
					// Add newline between text blocks for readability
					parts.push("\n", text);
				} else {
					parts.push(text);
				}
			}
		}

		return parts.join("");
	}
	return "";
}

/**
 * Extract thinking/reasoning content from message.
 */
function extractThinking(message) {
	if (!message?.content || !Array.isArray(message.content)) return "";
	const parts = [];

	for (const block of message.content) {
		if (block.type === "thinking") {
			const text = block.thinking || "";
			if (parts.length > 0) {
				// Add newline between thinking blocks for readability
				parts.push("\n", text);
			} else {
				parts.push(text);
			}
		}
	}

	return parts.join("");
}

/**
 * OpenAI-compatible chat completions endpoint.
 * Supports both streaming and non-streaming.
 *
 * POST /v1/chat/completions
 */
completionsRouter.post("/", async (req, res) => {
	const { paths, config } = req.context;
	const {
		messages,
		model,
		stream = false,
		max_tokens,
		temperature,
		...rest
	} = req.body;

	// Validate request
	if (!messages || !Array.isArray(messages) || messages.length === 0) {
		return res.status(400).json({
			error: {
				message: "Missing or invalid 'messages' array",
				type: "invalid_request_error",
			},
		});
	}

	const modelId = model || config.defaultModel || "ollama/glm-5";
	const conversationId =
		req.headers["x-conversation-id"] ||
		req.body.metadata?.conversation_id ||
		uuidv4();

	try {
		// Get or create Pi session
		const { session, isNew } = await getSession({
			conversationId,
			model: modelId,
			agentDir: paths?.agentDir,
			signal: req.signal,
		});

		// Convert messages to Pi format
		const { messages: piMessages, systemPrompt: frontendSystemPrompt } =
			convertMessages(messages);

		// Build prompt text
		let promptText = "";

		// Determine system prompt source
		// useThreadPersona: true = let thread history define persona (no injected system prompt)
		// useThreadPersona: false = use config systemPrompt as fallback
		const systemPrompt =
			frontendSystemPrompt ||
			(config.useThreadPersona ? undefined : config.systemPrompt);

		// Include system prompt if available
		if (systemPrompt) {
			promptText = `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n[/SYSTEM]\n\n`;
		}

		// For new sessions with history, prepend context
		if (isNew && piMessages.length > 1) {
			// Get all but last user message (that's the new prompt)
			const historyMessages = piMessages.slice(0, -1);
			if (historyMessages.length > 0) {
				const historyContext = buildHistoryContext(historyMessages);
				if (historyContext) {
					promptText += `[Previous conversation]\n${historyContext}\n\n`;
				}
			}
		}

		// Add the last user message (the actual prompt)
		const lastUserMessage = piMessages.filter((m) => m.role === "user").pop();
		if (lastUserMessage) {
			const userText = extractText(lastUserMessage);
			promptText += `[USER]\n${userText}\n[END USER]`;
		}

		if (stream) {
			await handleStreamingCompletion(req, res, {
				session,
				promptText,
				model: modelId,
				conversationId,
			});
		} else {
			await handleNonStreamingCompletion(req, res, {
				session,
				promptText,
				model: modelId,
				conversationId,
			});
		}
	} catch (error) {
		console.error("Completion error:", error);

		if (!res.headersSent) {
			res.status(500).json({
				error: {
					message: error.message || "Internal server error",
					type: "server_error",
				},
			});
		}
	}
});

/**
 * Handle streaming completion with SSE.
 */
async function handleStreamingCompletion(
	req,
	res,
	{ session, promptText, model, conversationId },
) {
	// Set SSE headers
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
	res.flushHeaders?.();

	const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
	const created = Math.floor(Date.now() / 1000);

	let sentContent = "";
	let sentThinking = "";
	let isComplete = false;
	let hasStartedStreaming = false; // Track if we've sent any content (for separator logic)
	const toolStartTimes = new Map(); // Track tool call start times for duration
	let pendingToolCalls = 0; // Track how many tools are currently running
	let hasSeenToolCalls = false; // Track if we've had any tool calls this turn
	let promptTokens = 0;
	let completionTokens = 0;
	let responseContent = "";
	let thinkingContent = "";

	// Subscribe to session events
	const unsubscribe = session.subscribe((event) => {
		try {
			switch (event.type) {
				case "message_update":
					// Streaming update
					if (event.message?.role === "assistant") {
						// Track if we've seen tool calls
						const hasToolCallsInMessage =
							Array.isArray(event.message?.content) &&
							event.message.content.some(
								(b) => b.type === "tool_use" || b.type === "toolCall",
							);
						if (hasToolCallsInMessage) {
							hasSeenToolCalls = true;
						}

						// Extract thinking content (always goes to reasoning)
						const fullThinking = extractThinking(event.message);
						if (sentThinking && !fullThinking.startsWith(sentThinking)) {
							sentThinking = "";
						}
						thinkingContent = fullThinking;

						const newThinking = fullThinking.slice(sentThinking.length);
						if (newThinking) {
							const thinkingLines = newThinking.split("\n");
							const completeThinkingLines = thinkingLines.slice(0, -1);
							if (completeThinkingLines.length > 0) {
								const thinkingToSend = completeThinkingLines.join("\n") + "\n";
								sentThinking += thinkingToSend;
								hasStartedStreaming = true;
								const thinkingChunk = {
									id: completionId,
									object: "chat.completion.chunk",
									created,
									model,
									choices: [
										{
											index: 0,
											delta: { reasoning_content: thinkingToSend },
											finish_reason: null,
										},
									],
								};
								res.write(`data: ${JSON.stringify(thinkingChunk)}\n\n`);
							}
						}

						// Extract text content (always goes to content, including during tools)
						const fullContent = extractText(event.message);
						if (sentContent && !fullContent.startsWith(sentContent)) {
							sentContent = "";
						}
						responseContent = fullContent;

						const newContent = fullContent.slice(sentContent.length);
						if (newContent) {
							const lines = newContent.split("\n");
							const completeLines = lines.slice(0, -1);
							if (completeLines.length > 0) {
								const textToSend = completeLines.join("\n") + "\n";
								sentContent += textToSend;
								hasStartedStreaming = true;
								const chunk = {
									id: completionId,
									object: "chat.completion.chunk",
									created,
									model,
									choices: [
										{
											index: 0,
											delta: { content: textToSend },
											finish_reason: null,
										},
									],
								};
								res.write(`data: ${JSON.stringify(chunk)}\n\n`);
							}
						}
					}
					break;

				case "message_end":
					if (event.message?.role === "assistant") {
						// Always extract final content from message_end to ensure we have everything
						const finalContent = extractText(event.message);
						const finalThinking = extractThinking(event.message);

						// Check content continuity before slicing (handles tool call resets)
						if (sentContent && !finalContent.startsWith(sentContent)) {
							sentContent = "";
						}
						if (sentThinking && !finalThinking.startsWith(sentThinking)) {
							sentThinking = "";
						}

						// Update our tracking variables if message_end has more content
						if (finalContent && finalContent !== responseContent) {
							responseContent = finalContent;
						}
						if (finalThinking && finalThinking !== thinkingContent) {
							thinkingContent = finalThinking;
						}

						// Send any remaining thinking content
						const remainingThinking = thinkingContent.slice(
							sentThinking.length,
						);
						if (remainingThinking) {
							sentThinking += remainingThinking;
							hasStartedStreaming = true;
							const thinkingChunk = {
								id: completionId,
								object: "chat.completion.chunk",
								created,
								model,
								choices: [
									{
										index: 0,
										delta: { reasoning_content: remainingThinking },
										finish_reason: null,
									},
								],
							};
							res.write(`data: ${JSON.stringify(thinkingChunk)}\n\n`);
						}

						// Send any remaining text content
						// Final text (after tools) goes to content, intermediate goes to reasoning
						const remaining = responseContent.slice(sentContent.length);
						if (remaining) {
							sentContent += remaining;
							hasStartedStreaming = true;
							// After tools, remaining text is final - send to content
							const targetField = hasSeenToolCalls ? "content" : "content";
							const chunk = {
								id: completionId,
								object: "chat.completion.chunk",
								created,
								model,
								choices: [
									{
										index: 0,
										delta: { [targetField]: remaining },
										finish_reason: null,
									},
								],
							};
							res.write(`data: ${JSON.stringify(chunk)}\n\n`);
						}

						// Update usage
						if (event.message?.usage) {
							promptTokens = event.message.usage.input || 0;
							completionTokens = event.message.usage.output || 0;
						}
					}
					break;

				case "tool_execution_start":
					// Tool is starting - track state
					pendingToolCalls++;
					hasSeenToolCalls = true;
					toolStartTimes.set(event.toolCallId, Date.now());

					if (event.toolName) {
						// Format args - show full input
						let argsDisplay = "";
						if (event.args) {
							try {
								const args =
									typeof event.args === "string"
										? JSON.parse(event.args)
										: event.args;
								if (event.toolName === "bash" && args.command) {
									argsDisplay = args.command;
								} else if (event.toolName === "read" && args.path) {
									argsDisplay = args.path;
								} else if (event.toolName === "write" && args.path) {
									argsDisplay = `${args.path}\n${args.content || ""}`;
								} else {
									const parts = [];
									for (const [key, val] of Object.entries(args)) {
										if (val !== undefined && val !== null) {
											parts.push(
												`${key}: ${typeof val === "string" ? val : JSON.stringify(val)}`,
											);
										}
									}
									argsDisplay = parts.join("\n");
								}
							} catch {
								argsDisplay = JSON.stringify(event.args);
							}
						}

						const startMarker = `

[${event.toolName}]
${argsDisplay}
[pending...]
`;
						const startChunk = {
							id: completionId,
							object: "chat.completion.chunk",
							created,
							model,
							choices: [
								{
									index: 0,
									delta: { reasoning_content: startMarker },
									finish_reason: null,
								},
							],
						};
						res.write(`data: ${JSON.stringify(startChunk)}\n\n`);
					}
					break;

				case "tool_execution_update":
					// Tool execution in progress - could show partial results
					break;

				case "tool_execution_end":
					// Tool finished - track state
					pendingToolCalls--;

					if (event.toolName) {
						const startTime = toolStartTimes.get(event.toolCallId);
						const duration = startTime
							? ((Date.now() - startTime) / 1000).toFixed(1)
							: null;
						toolStartTimes.delete(event.toolCallId);

						// Extract text content from result
						let resultText = "";
						if (event.result !== undefined && event.result !== null) {
							try {
								const result = event.result;
								if (result.content && Array.isArray(result.content)) {
									resultText = result.content
										.filter((c) => c.type === "text")
										.map((c) => c.text || "")
										.join("\n");
								} else if (typeof result === "string") {
									resultText = result;
								} else if (result.message) {
									resultText = result.message;
								} else if (
									result.stdout !== undefined ||
									result.stderr !== undefined
								) {
									resultText =
										[result.stdout, result.stderr].filter(Boolean).join("\n") ||
										"(no output)";
								} else {
									resultText = JSON.stringify(result, null, 2);
								}
							} catch {
								resultText = String(event.result);
							}
						}

						// Truncate to 30 lines
						const lines = resultText.split("\n");
						const truncated =
							lines.length > 30
								? lines.slice(0, 30).join("\n") +
									`\n... (${lines.length - 30} more lines)`
								: resultText;

						// Detect language for code block
						let codeLang = "";
						if (event.toolName === "bash") {
							codeLang = ""; // No language for bash output (plain text)
						} else if (
							event.toolName === "read" ||
							event.toolName === "write"
						) {
							try {
								const args =
									typeof event.args === "string"
										? JSON.parse(event.args)
										: event.args;
								if (args?.path) {
									const ext = args.path.split(".").pop()?.toLowerCase();
									const langMap = {
										js: "javascript",
										ts: "typescript",
										py: "python",
										rs: "rust",
										json: "json",
										md: "markdown",
										sh: "bash",
										yaml: "yaml",
										yml: "yaml",
										nix: "nix",
									};
									codeLang = langMap[ext] || "";
								}
							} catch {}
						}

						const exitCode = event.isError ? (event.result?.exitCode ?? 1) : 0;
						const durationStr = duration !== null ? `${duration}s` : "?s";

						// Format: [pending...]\n```lang\n<output>\n```\n[tool (duration, exit X)]\n\n
						const endMarker = `\`\`\`${codeLang}\n${truncated}\n\`\`\`\n[${event.toolName} (${durationStr}, exit ${exitCode})]\n\n`;
						const endChunk = {
							id: completionId,
							object: "chat.completion.chunk",
							created,
							model,
							choices: [
								{
									index: 0,
									delta: { reasoning_content: endMarker },
									finish_reason: null,
								},
							],
						};
						res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
					}
					break;

				case "turn_end":
				case "agent_end":
					isComplete = true;
					break;
			}
		} catch (err) {
			console.error("Stream event error:", err);
		}
	});

	try {
		// Send the prompt
		await session.prompt(promptText, {
			expandPromptTemplates: false,
			source: "rpc",
		});

		// Wait for completion
		const maxWait = 300000; // 5 minutes
		const startWait = Date.now();
		while (!isComplete && Date.now() - startWait < maxWait) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Final chunk
		const finalChunk = {
			id: completionId,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		};
		res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
		res.write("data: [DONE]\n\n");
	} catch (error) {
		console.error("Stream error:", error);
		const errorChunk = {
			id: completionId,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [
				{
					index: 0,
					delta: { content: `\n\n[Error: ${error.message}]` },
					finish_reason: "stop",
				},
			],
		};
		res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
		res.write("data: [DONE]\n\n");
	} finally {
		unsubscribe();
		res.end();
	}
}

/**
 * Handle non-streaming completion.
 */
async function handleNonStreamingCompletion(
	req,
	res,
	{ session, promptText, model, conversationId },
) {
	const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
	const created = Math.floor(Date.now() / 1000);

	let responseContent = "";
	let thinkingContent = "";
	let promptTokens = 0;
	let completionTokens = 0;
	let isComplete = false;

	// Subscribe to session events
	const unsubscribe = session.subscribe((event) => {
		try {
			switch (event.type) {
				case "message_end":
					if (event.message?.role === "assistant") {
						responseContent = extractText(event.message);
						thinkingContent = extractThinking(event.message);
						if (event.message?.usage) {
							promptTokens = event.message.usage.input || 0;
							completionTokens = event.message.usage.output || 0;
						}
					}
					break;

				case "tool_execution_start":
				case "tool_execution_update":
				case "tool_execution_end":
					// Tool execution in progress - continue waiting
					break;

				case "turn_end":
				case "agent_end":
					isComplete = true;
					break;
			}
		} catch (err) {
			console.error("Event error:", err);
		}
	});

	try {
		// Send the prompt
		await session.prompt(promptText, {
			expandPromptTemplates: false,
			source: "rpc",
		});

		// Wait for completion
		const maxWait = 300000;
		const startWait = Date.now();
		while (!isComplete && Date.now() - startWait < maxWait) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Build response with optional reasoning content
		const message = {
			role: "assistant",
			content: responseContent,
		};

		// Include reasoning if present (for models with thinking)
		if (thinkingContent) {
			message.reasoning_content = thinkingContent;
		}

		res.json({
			id: completionId,
			object: "chat.completion",
			created,
			model,
			choices: [
				{
					index: 0,
					message,
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		});
	} catch (error) {
		console.error("Completion error:", error);
		res.status(500).json({
			error: {
				message: error.message || "Internal server error",
				type: "server_error",
			},
		});
	} finally {
		unsubscribe();
	}
}
