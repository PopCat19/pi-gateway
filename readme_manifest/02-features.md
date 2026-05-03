## What it does

- Creates an HTTP server with OpenAI-compatible endpoints
- Bridges external frontends to Pi's session management
- Supports streaming (SSE) and non-streaming responses
- Streams thinking/reasoning content for compatible models
- Passes character cards and conversation history from frontends

## Compatible Frontends

| Frontend | Works |
|----------|-------|
| SillyTavern | ✓ |
| Open WebUI | ✓ |
| AnythingLLM | ✓ |
| LibreChat | ✓ |
| Continue.dev | ✓ |
| Chatbox | ✓ |
| LobeChat | ✓ |
| Custom scripts | ✓ |

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (OpenAI-compatible) |
| `/v1/models` | GET | List available models from Pi |
| `/v1/models/:id` | GET | Get specific model info |
| `/health` | GET | Health check |
