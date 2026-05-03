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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 8088 | Server port |
| `host` | string | "127.0.0.1" | Server host |
| `defaultModel` | string | "ollama/glm-5" | Default model (provider/model format) |
| `defaultThinkingLevel` | string | "medium" | Thinking level for reasoning models |

## Frontend Configuration

In your frontend (e.g., SillyTavern):
- **API type**: OpenAI-compatible
- **API URL**: `http://localhost:8088/v1`
- **API key**: leave empty or set matching config
- **Model**: any model from `/v1/models` or your configured default

## Features

### System Prompt / Character Cards

The gateway passes the system prompt (character card) from the frontend to Pi:
- Frontend's system message becomes `[SYSTEM INSTRUCTIONS]` context
- Character definitions from SillyTavern work automatically

### Conversation History

- New sessions: full history replayed as context
- Existing sessions: context maintained by Pi's session

### Thinking / Reasoning Content

For models that support thinking (Claude extended, DeepSeek R1, etc.):
- Streaming: `delta.reasoning_content` chunks
- Non-streaming: `message.reasoning_content` field
