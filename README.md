# pi-gateway

Expose Pi as an OpenAI-compatible API gateway for any LLM frontend.

## What it does

- Creates an HTTP server with OpenAI-compatible endpoints
- Bridges external frontends to Pi's session management
- Supports streaming (SSE) and non-streaming responses
- Enables tool access via OpenAI function calling

## Compatible Frontends

Any frontend that supports OpenAI-compatible APIs:

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
| `/v1/models` | GET | List available models |
| `/v1/models/:id` | GET | Get specific model info |
| `/health` | GET | Health check |

## Install

```bash
npm install -g PopCat19/pi-gateway
```

## Quick start

Start the server:

```bash
pi-gateway-server
```

Or from within Pi:

```text
/gateway start
```

## Configuration

Config file: `~/.pi/agent/pi-gateway/config.json`

```json
{
  "port": 8001,
  "host": "127.0.0.1",
  "defaultModel": "openai/gpt-4o",
  "systemPrompt": "You are a helpful assistant.",
  "defaultThinkingLevel": "medium",
  "enableTools": true,
  "allowedTools": [],
  "apiKey": "optional-api-key"
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 8001 | Server port (avoid SillyTavern's 8000) |
| `host` | string | "127.0.0.1" | Server host |
| `defaultModel` | string | - | Default model (provider/model format) |
| `systemPrompt` | string | - | Default system prompt |
| `defaultThinkingLevel` | string | "medium" | Thinking level |
| `enableTools` | boolean | true | Allow tool use in Pi sessions |
| `allowedTools` | string[] | [] | Whitelist of tools (empty = all) |
| `apiKey` | string | - | Optional API key for authentication |

## Frontend Configuration

In your frontend of choice, set:
- **API type**: OpenAI-compatible
- **API URL**: `http://localhost:8000/v1`
- **API key**: (your apiKey if configured)
- **Model**: any model from `/v1/models` or your configured default

## Status

🚧 **Work in progress** - Basic server structure complete, Pi session integration pending.

TODO:
- [ ] Integrate with Pi's session management
- [ ] Bridge tools to OpenAI function calling
- [ ] Implement conversation persistence
- [ ] Add support for multiple conversations
- [ ] Test with various frontends

## License

MIT