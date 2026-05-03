# AGENTS.md

## Project overview

OpenAI-compatible API gateway for Pi. Bridges external LLM frontends (SillyTavern, Open WebUI) to Pi's session management. Multi-instance support with auto port assignment.

Read `README.md` for the human-facing overview.

## Setup commands

```bash
npm install
pi install git:github.com/PopCat19/pi-gateway
```

## README workflow

Edit `readme_manifest/*.md`, then run `bash tools/generate-readme.sh`.

## Code style

- Node.js / JavaScript
- OpenAI-compatible API format
- Follows dev-mini conventions where applicable
