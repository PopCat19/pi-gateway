import { Router } from "express";
import { v4 as uuidv4 } from "uuid";

export const completionsRouter = Router();

/**
 * OpenAI-compatible chat completions endpoint.
 * Supports both streaming and non-streaming.
 * 
 * POST /v1/chat/completions
 */
completionsRouter.post("/", async (req, res) => {
  const { paths, config } = req.context;
  const { messages, model, stream = false, tools, tool_choice, ...rest } = req.body;
  
  // Validate request
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: { message: "Missing or invalid 'messages' array", type: "invalid_request_error" },
    });
  }
  
  const modelId = model || config.defaultModel || "openai/gpt-4o";
  const conversationId = req.headers["x-conversation-id"] || uuidv4();
  
  if (stream) {
    // Handle streaming response
    await handleStreamingCompletion(req, res, {
      messages,
      model: modelId,
      conversationId,
      tools,
      config,
      paths,
    });
  } else {
    // Handle non-streaming response
    await handleNonStreamingCompletion(req, res, {
      messages,
      model: modelId,
      conversationId,
      tools,
      config,
      paths,
    });
  }
});

/**
 * Handle streaming completion with SSE.
 */
async function handleStreamingCompletion(req, res, context) {
  const { messages, model, conversationId, tools, config, paths } = context;
  
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  
  const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  
  // TODO: Integrate with Pi session.prompt() with streaming
  // For now, send a placeholder streamed response
  
  const placeholderChunks = [
    "This is a placeholder response from pi-gateway.",
    " Full integration with Pi sessions is coming soon.",
    " The gateway is running and ready to accept connections from any OpenAI-compatible frontend.",
  ];
  
  for (let i = 0; i < placeholderChunks.length; i++) {
    const chunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: { content: placeholderChunks[i] },
        finish_reason: null,
      }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    
    // Small delay to simulate streaming
    await new Promise(resolve => setTimeout(resolve, 50));
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
  };
  res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Handle non-streaming completion.
 */
async function handleNonStreamingCompletion(req, res, context) {
  const { messages, model, conversationId, tools, config, paths } = context;
  
  const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  
  // TODO: Integrate with Pi session.prompt()
  // For now, return a placeholder response
  
  // Extract system prompt and user messages
  const systemPrompt = messages.find(m => m.role === "system")?.content || "";
  const lastUserMessage = messages.filter(m => m.role === "user").pop()?.content || "";
  
  const placeholderResponse = `This is a placeholder response from pi-gateway. Full integration with Pi sessions is coming soon.

Your last message was: "${typeof lastUserMessage === "string" ? lastUserMessage.slice(0, 100) : "(complex content)"}"

The gateway is running and ready to accept connections from any OpenAI-compatible frontend.`;
  
  res.json({
    id: completionId,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: placeholderResponse,
      },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 0, // TODO: count actual tokens
      completion_tokens: 0,
      total_tokens: 0,
    },
  });
}