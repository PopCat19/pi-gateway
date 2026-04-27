# pi-gateway

Expose Pi as an OpenAI-compatible API gateway for any LLM frontend.

> **⚠️ Experimental: Multi-instance support**
> 
> The `pi-gateway` CLI now supports multiple gateway instances. This is a new feature.
> Legacy installations at `~/.pi/agent/pi-gateway/` continue to work but can be migrated:
> 
> ```
> pi-gateway migrate my-gateway
> ```
> 
> New instances are stored in `~/.pi/agent/pi-gateway-instances/`.

## Directory Layout

```
Source repository (your dev fork):
  ~/pi-gateway/                # git repo, package.json, source code

Instance directories (runtime data):
  ~/.pi/agent/pi-gateway-instances/
    ├── main/workspace/         # config.json (port 8088)
    └── dev/workspace/          # config.json (port 8089, auto-assigned)

Legacy (pre-multi-instance):
  ~/.pi/agent/pi-gateway/      # still works, shown as "(legacy)" in CLI
```

When you `pi install git:github.com/PopCat19/pi-gateway`, pi clones the source repo.
The `pi-gateway` CLI creates instance directories at runtime.

## What it does

- Creates an HTTP server with OpenAI-compatible endpoints
- Bridges external frontends to Pi's session management
- Supports streaming (SSE) and non-streaming responses
- Streams thinking/reasoning content for compatible models
- Passes character cards and conversation history from frontends

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
| `/v1/models` | GET | List available models from Pi |
| `/v1/models/:id` | GET | Get specific model info |
| `/health` | GET | Health check |

## Install

```bash
pi install git:github.com/PopCat19/pi-gateway
```

Or clone and link:

```bash
git clone https://github.com/PopCat19/pi-gateway
cd pi-gateway
npm install
npm link
```

## Multi-instance CLI

> **Experimental** - New feature, see notice above.

The `pi-gateway` CLI manages multiple gateway instances:

```
pi-gateway create <name> [--needed]  Create new instance
pi-gateway list                 List all instances
pi-gateway start <name>        Start an instance
pi-gateway stop <name>         Stop an instance
pi-gateway restart <name>      Restart an instance
pi-gateway status [name]       Show instance status
pi-gateway edit <name>         Open config in $EDITOR
pi-gateway remove <name>       Delete an instance
pi-gateway migrate <name>      Migrate legacy instance
```

**Instance storage:**
- New instances: `~/.pi/agent/pi-gateway-instances/<name>/workspace/`
- Legacy: `~/.pi/agent/pi-gateway/` (detected automatically)

**Quick start:**

```bash
# Create a new gateway instance
pi-gateway create my-api
pi-gateway edit my-api # Configure port, model, etc.
pi-gateway start my-api
```

**Auto port assignment:** Ports are automatically assigned starting from 8088. If you create multiple instances, each gets the next available port (8089, 8090, etc.).

**Migrating from legacy:**

```bash
pi-gateway stop legacy
pi-gateway migrate my-api
pi-gateway start my-api
```

## Quick start

From within Pi:

```text
/gateway start
```

Or run directly:

```bash
pi-gateway-server
```

Server starts on `http://127.0.0.1:8088` by default.

## Configuration

Config file: `~/.pi/agent/pi-gateway/config.json`

```json
{
  "port": 8088,
  "host": "127.0.0.1",
  "defaultModel": "ollama/glm-5",
  "defaultThinkingLevel": "medium"
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 8088 | Server port |
| `host` | string | "127.0.0.1" | Server host |
| `defaultModel` | string | "ollama/glm-5" | Default model (provider/model format) |
| `defaultThinkingLevel` | string | "medium" | Thinking level for reasoning models |

## Frontend Configuration

In your frontend (e.g., SillyTavern), set:
- **API type**: OpenAI-compatible
- **API URL**: `http://localhost:8088/v1`
- **API key**: (leave empty or set matching config)
- **Model**: any model from `/v1/models` or your configured default

## Features

### System Prompt / Character Cards

The gateway passes the system prompt (character card) from the frontend to Pi:
- Frontend's system message becomes `[SYSTEM INSTRUCTIONS]` context
- Character definitions from SillyTavern work automatically

### Conversation History

- New sessions: Full history replayed as context
- Existing sessions: Context maintained by Pi's session

### Thinking / Reasoning Content

For models that support thinking (Claude extended, DeepSeek R1, etc.):
- Streaming: `delta.reasoning_content` chunks
- Non-streaming: `message.reasoning_content` field

## Status

✓ Working — tested with SillyTavern

Completed:
- [x] OpenAI-compatible `/v1/chat/completions` endpoint
- [x] Model listing from Pi's models.json
- [x] Streaming SSE responses
- [x] Non-streaming responses
- [x] System prompt (character card) injection
- [x] Conversation history context
- [x] Thinking/reasoning content streaming

TODO:
- [ ] Bridge OpenAI tools to Pi's tool system
- [ ] API key authentication
- [ ] Multi-conversation session management
- [ ] Image input support

## License

MIT