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
pi-gateway create my-api
pi-gateway edit my-api # Configure port, model, etc.
pi-gateway start my-api
```

**Auto port assignment:** Ports are automatically assigned starting from 8088. Multiple instances get 8089, 8090, etc.

**Migrating from legacy:**

```bash
pi-gateway stop legacy
pi-gateway migrate my-api
pi-gateway start my-api
```
