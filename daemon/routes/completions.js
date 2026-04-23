import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getSession, buildHistoryContext } from "../session-manager.js";

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
          content: typeof msg.content === "string" 
            ? msg.content 
            : msg.content.map(c => {
                if (c.type === "text") return { type: "text", text: c.text };
                if (c.type === "image_url") {
                  const url = c.image_url?.url || "";
                  // Handle base64 data URLs
                  if (url.startsWith("data:")) {
                    const match = url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                      return { type: "image", mimeType: match[1], data: match[2] };
                    }
                  }
                  // For external URLs, we'd need to fetch - skip for now
                  return null;
                }
                return null;
              }).filter(Boolean),
          timestamp: Date.now(),
        });
        break;
      
      case "assistant":
        const content = typeof msg.content === "string" ? msg.content : "";
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: content }],
          timestamp: Date.now(),
        });
        break;
      
      case "tool":
      case "function":
        // Handle tool/function results
        messages.push({
          role: "toolResult",
          toolCallId: msg.tool_call_id || uuidv4(),
          toolName: msg.name || "unknown",
          content: [{ type: "text", text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }],
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
    return message.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("");
  }
  return "";
}

/**
 * Extract thinking/reasoning content from message.
 */
function extractThinking(message) {
  if (!message?.content || !Array.isArray(message.content)) return "";
  return message.content
    .filter(c => c.type === "thinking")
    .map(c => c.thinking || "")
    .join("");
}

/**
 * OpenAI-compatible chat completions endpoint.
 * Supports both streaming and non-streaming.
 * 
 * POST /v1/chat/completions
 */
completionsRouter.post("/", async (req, res) => {
  const { paths, config } = req.context;
  const { messages, model, stream = false, max_tokens, temperature, ...rest } = req.body;
  
  // Validate request
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: { message: "Missing or invalid 'messages' array", type: "invalid_request_error" },
    });
  }
  
  const modelId = model || config.defaultModel || "ollama/glm-5";
  const conversationId = req.headers["x-conversation-id"] || req.body.metadata?.conversation_id || uuidv4();
  
  try {
    // Get or create Pi session
    const { session, isNew } = await getSession({
      conversationId,
      model: modelId,
      agentDir: paths?.agentDir,
      signal: req.signal,
    });
    
    // Convert messages to Pi format
    const { messages: piMessages, systemPrompt: frontendSystemPrompt } = convertMessages(messages);
    
    // Build prompt text
    let promptText = "";
    
    // Determine system prompt source
    // useThreadPersona: true = let thread history define persona (no injected system prompt)
    // useThreadPersona: false = use config systemPrompt as fallback
    const systemPrompt = frontendSystemPrompt 
      || (config.useThreadPersona ? undefined : config.systemPrompt);
    
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
    const lastUserMessage = piMessages.filter(m => m.role === "user").pop();
    if (lastUserMessage) {
      const userText = extractText(lastUserMessage);
      promptText += `[USER]\n${userText}\n[END USER]`;
    }
    
    if (stream) {
      await handleStreamingCompletion(req, res, { session, promptText, model: modelId, conversationId });
    } else {
      await handleNonStreamingCompletion(req, res, { session, promptText, model: modelId, conversationId });
    }
  } catch (error) {
    console.error("Completion error:", error);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: error.message || "Internal server error", type: "server_error" },
      });
    }
  }
});

/**
 * Handle streaming completion with SSE.
 */
async function handleStreamingCompletion(req, res, { session, promptText, model, conversationId }) {
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
            // Extract text content
            const fullContent = extractText(event.message);
            responseContent = fullContent;
            
            // Extract thinking content
            const fullThinking = extractThinking(event.message);
            thinkingContent = fullThinking;
            
            // Send thinking content updates
            const newThinking = fullThinking.slice(sentThinking.length);
            if (newThinking) {
              // Buffer and send complete lines for thinking
              const thinkingLines = newThinking.split("\n");
              const completeThinkingLines = thinkingLines.slice(0, -1);
              
              if (completeThinkingLines.length > 0) {
                const thinkingToSend = completeThinkingLines.join("\n") + "\n";
                sentThinking += thinkingToSend;
                
                const thinkingChunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: { reasoning_content: thinkingToSend },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(thinkingChunk)}\n\n`);
              }
            }
            
            // Send text content updates
            const newContent = fullContent.slice(sentContent.length);
            if (newContent) {
              // Buffer and send only complete lines
              const lines = newContent.split("\n");
              const completeLines = lines.slice(0, -1);
              
              if (completeLines.length > 0) {
                const textToSend = completeLines.join("\n") + "\n";
                sentContent += textToSend;
                
                const chunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: { content: textToSend },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            }
          }
          break;
          
        case "message_end":
          if (event.message?.role === "assistant") {
            // Send any remaining thinking content
            const remainingThinking = thinkingContent.slice(sentThinking.length);
            if (remainingThinking) {
              sentThinking += remainingThinking;
              const thinkingChunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: { reasoning_content: remainingThinking },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(thinkingChunk)}\n\n`);
            }
            
            // Send any remaining text content
            const remaining = responseContent.slice(sentContent.length);
            if (remaining) {
              sentContent += remaining;
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: { content: remaining },
                  finish_reason: null,
                }],
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
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Final chunk
    const finalChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop",
      }],
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
      choices: [{
        index: 0,
        delta: { content: `\n\n[Error: ${error.message}]` },
        finish_reason: "stop",
      }],
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
async function handleNonStreamingCompletion(req, res, { session, promptText, model, conversationId }) {
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
      await new Promise(resolve => setTimeout(resolve, 100));
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
      choices: [{
        index: 0,
        message,
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
    
  } catch (error) {
    console.error("Completion error:", error);
    res.status(500).json({
      error: { message: error.message || "Internal server error", type: "server_error" },
    });
  } finally {
    unsubscribe();
  }
}