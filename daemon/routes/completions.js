import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getSession, deleteSession } from "../session-manager.js";

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
 * Extract text content from assistant message.
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
    const session = await getSession({
      conversationId,
      model: modelId,
      agentDir: paths?.agentDir,
      signal: req.signal,
    });
    
    if (stream) {
      await handleStreamingCompletion(req, res, { session, messages, model: modelId, conversationId, config });
    } else {
      await handleNonStreamingCompletion(req, res, { session, messages, model: modelId, conversationId, config });
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
async function handleStreamingCompletion(req, res, { session, messages, model, conversationId, config }) {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders?.();
  
  const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  
  let fullContent = "";
  let isComplete = false;
  let promptTokens = 0;
  let completionTokens = 0;
  
  // Subscribe to session events
  const unsubscribe = session.subscribe((event) => {
    try {
      switch (event.type) {
        case "message_start":
          // New message starting
          if (event.message?.role === "assistant") {
            // Could send initial chunk here if needed
          }
          break;
          
        case "message_update":
          // Streaming update
          if (event.message?.role === "assistant") {
            const content = extractText(event.message);
            const newContent = content.slice(fullContent.length);
            
            if (newContent) {
              fullContent = content;
              
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: { content: newContent },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }
          break;
          
        case "message_end":
          if (event.message?.role === "assistant") {
            // Update usage info
            if (event.message.usage) {
              promptTokens = event.message.usage.input || 0;
              completionTokens = event.message.usage.output || 0;
            }
          }
          break;
          
        case "turn_end":
          // Turn complete
          isComplete = true;
          break;
          
        case "agent_end":
          // Agent finished
          isComplete = true;
          break;
      }
    } catch (err) {
      console.error("Stream event error:", err);
    }
  });
  
  try {
    // Convert messages and send prompt
    const { messages: piMessages, systemPrompt } = convertMessages(messages);
    
    // Build prompt text from messages (simplified - full impl would use session properly)
    const lastUserMessage = piMessages.filter(m => m.role === "user").pop();
    const userText = lastUserMessage?.content 
      ? (typeof lastUserMessage.content === "string" 
          ? lastUserMessage.content 
          : lastUserMessage.content.filter(c => c.type === "text").map(c => c.text).join("\n"))
      : "";
    
    // Send the prompt
    await session.prompt(userText, { 
      expandPromptTemplates: false,
      source: "rpc",
    });
    
    // Wait for completion (with timeout)
    const maxWait = 300000; // 5 minutes
    const startWait = Date.now();
    while (!isComplete && Date.now() - startWait < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Send final chunk
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
    
    // Send error chunk
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
async function handleNonStreamingCompletion(req, res, { session, messages, model, conversationId, config }) {
  const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  
  let fullContent = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let isComplete = false;
  
  // Subscribe to session events
  const unsubscribe = session.subscribe((event) => {
    try {
      switch (event.type) {
        case "message_end":
          if (event.message?.role === "assistant") {
            fullContent = extractText(event.message);
            if (event.message.usage) {
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
    // Convert messages and send prompt
    const { messages: piMessages, systemPrompt } = convertMessages(messages);
    
    // Build prompt text from messages
    const lastUserMessage = piMessages.filter(m => m.role === "user").pop();
    const userText = lastUserMessage?.content 
      ? (typeof lastUserMessage.content === "string" 
          ? lastUserMessage.content 
          : lastUserMessage.content.filter(c => c.type === "text").map(c => c.text).join("\n"))
      : "";
    
    // Send the prompt
    await session.prompt(userText, { 
      expandPromptTemplates: false,
      source: "rpc",
    });
    
    // Wait for completion (with timeout)
    const maxWait = 300000; // 5 minutes
    const startWait = Date.now();
    while (!isComplete && Date.now() - startWait < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    res.json({
      id: completionId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: fullContent,
        },
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