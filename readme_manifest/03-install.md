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
