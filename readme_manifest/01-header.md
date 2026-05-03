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
