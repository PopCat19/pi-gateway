#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPaths } from "../lib/paths.js";
import { createDefaultConfig } from "../lib/config.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const agentDir = path.join(homedir(), ".pi", "agent");
const instancesDir = path.join(agentDir, "pi-gateway-instances");
const legacyDir = path.join(agentDir, "pi-gateway");

const COMMANDS = {
	create: { args: ["name"], desc: "Create a new instance with default config" },
	list: { args: [], desc: "List all instances" },
	start: { args: ["name"], desc: "Start an instance" },
	stop: { args: ["name"], desc: "Stop an instance" },
	restart: { args: ["name"], desc: "Restart an instance" },
	status: { args: ["name?"], desc: "Show status of instance(s)" },
	edit: { args: ["name"], desc: "Open instance config in editor" },
	remove: { args: ["name"], desc: "Remove an instance" },
	migrate: { args: ["name"], desc: "Migrate legacy instance to new location" },
};

function printUsage() {
	console.log("pi-gateway - Multi-instance OpenAI-compatible gateway\n");
	console.log("Usage: pi-gateway <command> [args]\n");
	console.log("Commands:");
	const maxCmdLen = Math.max(...Object.keys(COMMANDS).map(c => c.length));
	for (const [cmd, info] of Object.entries(COMMANDS)) {
		const args = info.args.map(a => a.endsWith("?") ? `[${a}]` : `<${a}>`).join(" ");
		const flags = cmd === "create" ? " [--needed] [--port PORT]" : "";
		console.log(`  ${cmd.padEnd(maxCmdLen + 2)} ${args}${flags}  ${info.desc}`);
	}
	console.log("\nInstances are stored in: " + instancesDir);
	console.log("\nPorts are auto-assigned starting from 8088, or use --port to specify.");
}

function getInstanceDir(name) {
	if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
		throw new Error(`Invalid instance name: ${name}. Use alphanumeric, dash, or underscore.`);
	}
	return path.join(instancesDir, name);
}

function getInstancePath(name) {
	return path.join(instancesDir, name, "workspace");
}

function ensureInstancesDir() {
	if (!existsSync(instancesDir)) {
		mkdirSync(instancesDir, { recursive: true });
	}
}

function listInstances() {
	ensureInstancesDir();
	const instances = [];

	// Check for legacy instance
	if (existsSync(legacyDir)) {
		instances.push({ name: "(legacy)", path: legacyDir, isLegacy: true });
	}

	// List new-style instances
	const dirs = readdirSync(instancesDir, { withFileTypes: true });
	for (const d of dirs) {
		if (d.isDirectory()) {
			instances.push({ name: d.name, path: path.join(instancesDir, d.name, "workspace"), isLegacy: false });
		}
	}

	return instances;
}

function readStatus(workspaceDir) {
	const paths = getPaths({ workspaceDir });
	const statusPath = paths.statusPath;
	const lockPath = paths.lockPath;
	const configPath = paths.configPath;

	const result = { running: false, pid: null, port: null, status: null };

	// Read config for port (always available)
	try {
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		result.port = config.port;
	} catch {}

	if (existsSync(lockPath)) {
		try {
			const lock = JSON.parse(readFileSync(lockPath, "utf8"));
			if (lock.pid) {
				try {
					process.kill(lock.pid, 0);
					result.running = true;
					result.pid = lock.pid;
				} catch {
					// Process not running
				}
			}
		} catch {}
	}

	if (existsSync(statusPath)) {
		try {
			result.status = JSON.parse(readFileSync(statusPath, "utf8"));
		} catch {}
	}

	return result;
}

function getUsedPorts() {
	const ports = new Set();
	for (const inst of listInstances()) {
		const workspaceDir = inst.isLegacy ? legacyDir : getInstancePath(inst.name);
		const configPath = path.join(workspaceDir, "config.json");
		try {
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			if (config.port) ports.add(config.port);
		} catch {}
	}
	return ports;
}

function findAvailablePort(startPort = 8088) {
	const usedPorts = getUsedPorts();
	let port = startPort;
	while (usedPorts.has(port) && port < 65535) {
		port++;
	}
	return port;
}

function cmdCreate(name, options = {}) {
	ensureInstancesDir();
	const instanceDir = getInstanceDir(name);
	const workspaceDir = path.join(instanceDir, "workspace");
	const configFile = path.join(workspaceDir, "config.json");

	if (existsSync(instanceDir)) {
		if (options.needed) {
			console.log(`Instance "${name}" already exists at ${instanceDir}`);
			return;
		}
		console.error(`Instance "${name}" already exists at ${instanceDir}`);
		process.exit(1);
	}

	mkdirSync(workspaceDir, { recursive: true });

	const config = createDefaultConfig();
	
	// Auto-assign port (explicit --port overrides auto-assignment)
	if (options.port) {
		config.port = options.port;
	} else {
		config.port = findAvailablePort();
	}

	writeFileSync(configFile, JSON.stringify(config, null, "\t"));
	console.log(`Created instance "${name}" at ${instanceDir}`);
	console.log(`Port: ${config.port}`);
	console.log(`\nEdit the config to set model and other options:`);
	console.log(`  ${configFile}`);
}

function cmdList() {
	ensureInstancesDir();
	const instances = listInstances();

	if (instances.length === 0) {
		console.log("No instances found. Create one with: pi-gateway create <name>");
		return;
	}

	console.log("Instances:\n");
	for (const inst of instances) {
		const name = inst.isLegacy ? "(legacy)" : inst.name;
		const workspaceDir = inst.isLegacy ? legacyDir : getInstancePath(inst.name);
		const { running, pid, port } = readStatus(workspaceDir);
		const state = running ? `running (pid ${pid})` : "stopped";
		console.log(`  ${name}`);
		console.log(`    Status: ${state}`);
		if (port) console.log(`    Port: ${port}`);
		if (inst.isLegacy) {
			console.log(`    Note: Legacy instance, migrate with: pi-gateway migrate <name>`);
		}
		console.log();
	}
}

function cmdStart(name) {
	let workspaceDir;
	try {
		workspaceDir = resolveWorkspace(name);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}

	const { running, pid } = readStatus(workspaceDir);
	if (running) {
		console.log(`Instance "${name}" is already running (pid ${pid})`);
		return;
	}

	console.log(`Starting instance "${name}"...`);
	const serverPath = path.join(packageRoot, "bin", "pi-gateway-server.mjs");
	const child = spawn("node", [serverPath, "--workspace", workspaceDir], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	console.log(`Started instance "${name}" (pid ${child.pid})`);
}

function cmdStop(name) {
	let workspaceDir;
	try {
		workspaceDir = resolveWorkspace(name);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}

	const { running, pid } = readStatus(workspaceDir);
	if (!running) {
		console.log(`Instance "${name}" is not running.`);
		return;
	}

	try {
		process.kill(pid, "SIGTERM");
		console.log(`Stopped instance "${name}" (pid ${pid})`);
	} catch (err) {
		console.error(`Failed to stop instance "${name}": ${err.message}`);
	}
}

function cmdRestart(name) {
	let workspaceDir;
	try {
		workspaceDir = resolveWorkspace(name);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}

	const { running, pid } = readStatus(workspaceDir);

	if (running) {
		console.log(`Stopping instance "${name}"...`);
		try {
			process.kill(pid, "SIGTERM");
			let attempts = 0;
			while (attempts < 10) {
				try {
					process.kill(pid, 0);
					attempts++;
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
				} catch {
					break;
				}
			}
		} catch {}
	}

	cmdStart(name);
}

function cmdStatus(name) {
	if (name) {
		let workspaceDir;
		try {
			workspaceDir = resolveWorkspace(name);
		} catch (err) {
			console.error(err.message);
			process.exit(1);
		}
		const { running, pid, port, status } = readStatus(workspaceDir);
		console.log(`Instance: ${name}`);
		console.log(`  Running: ${running}`);
		if (running) {
			console.log(`  PID: ${pid}`);
		}
		if (port) console.log(`  Port: ${port}`);
		if (status) console.log(`  Status: ${JSON.stringify(status, null, 2)}`);
	} else {
		cmdList();
	}
}

function cmdEdit(name) {
	let workspaceDir;
	try {
		workspaceDir = resolveWorkspace(name);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
	const paths = getPaths({ workspaceDir });
	const editor = process.env.EDITOR || process.env.VISUAL || "nano";
	const configFile = paths.configPath;

	if (!existsSync(configFile)) {
		console.error(`Instance "${name}" config not found.`);
		process.exit(1);
	}

	spawn(editor, [configFile], { stdio: "inherit" });
}

function cmdRemove(name) {
	if (name === "legacy" || name === "(legacy)") {
		console.error("Cannot remove legacy instance. Use 'pi-gateway migrate <name>' instead.");
		process.exit(1);
	}

	const instanceDir = getInstanceDir(name);
	if (!existsSync(instanceDir)) {
		console.error(`Instance "${name}" not found.`);
		process.exit(1);
	}

	const { running } = readStatus(getInstancePath(name));
	if (running) {
		console.error(`Instance "${name}" is running. Stop it first.`);
		process.exit(1);
	}

	console.log(`Removing instance "${name}"...`);
	rmSync(instanceDir, { recursive: true });
	console.log(`Removed.`);
}

function cmdMigrate(name) {
	if (!existsSync(legacyDir)) {
		console.error("No legacy instance found at ~/.pi/agent/pi-gateway/");
		process.exit(1);
	}

	if (!name) {
		console.error("Please specify a name for the migrated instance:");
		console.error("  pi-gateway migrate <name>");
		console.error("\nExample: pi-gateway migrate my-gateway");
		process.exit(1);
	}

	const targetDir = getInstanceDir(name);

	if (existsSync(targetDir)) {
		console.error(`Instance "${name}" already exists at ${targetDir}`);
		process.exit(1);
	}

	const { running } = readStatus(legacyDir);
	if (running) {
		console.error("Legacy instance is running. Stop it first.");
		process.exit(1);
	}

	console.log(`Migrating legacy instance to "${name}"...`);
	ensureInstancesDir();

	const workspaceDir = path.join(targetDir, "workspace");
	mkdirSync(targetDir, { recursive: true });

	const fs = require("fs");
	fs.cpSync(legacyDir, workspaceDir, { recursive: true });

	console.log(`Migrated to ${targetDir}`);
	console.log("\nOriginal files preserved at: " + legacyDir);
	console.log("To start the new instance:");
	console.log(`  pi-gateway start ${name}`);
	console.log("\nOnce verified, you can remove the legacy directory:");
	console.log(`  rm -rf ${legacyDir}`);
}

function resolveWorkspace(name) {
	// Handle legacy instance
	if (name === "legacy" || name === "(legacy)") {
		if (!existsSync(legacyDir)) {
			throw new Error("Legacy instance not found.");
		}
		return legacyDir;
	}

	const workspaceDir = getInstancePath(name);
	if (!existsSync(workspaceDir)) {
		throw new Error(`Instance "${name}" not found. Create it first with: pi-gateway create ${name}`);
	}
	return workspaceDir;
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printUsage();
		process.exit(args.length === 0 ? 1 : 0);
	}

	// Parse flags
	const flags = { needed: false, port: null };
	let i = 0;
	const filteredArgs = [];
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--needed") {
			flags.needed = true;
			i++;
		} else if (arg === "--port") {
			const portValue = args[i + 1];
			if (portValue && /^\d+$/.test(portValue)) {
				flags.port = parseInt(portValue, 10);
				i += 2;
			} else {
				console.error("--port requires a valid port number");
				process.exit(1);
			}
		} else if (arg.startsWith("--port=")) {
			const portValue = arg.slice(7);
			if (/^\d+$/.test(portValue)) {
				flags.port = parseInt(portValue, 10);
				i++;
			} else {
				console.error("--port requires a valid port number");
				process.exit(1);
			}
		} else {
			filteredArgs.push(arg);
			i++;
		}
	}

	const [cmd, ...cmdArgs] = filteredArgs;

	if (!COMMANDS[cmd]) {
		console.error(`Unknown command: ${cmd}`);
		printUsage();
		process.exit(1);
	}

	const { args: expected } = COMMANDS[cmd];
	const required = expected.filter(a => !a.endsWith("?"));
	if (cmdArgs.length < required.length) {
		console.error(`Usage: pi-gateway ${cmd} ${expected.map(a => a.endsWith("?") ? `[${a}]` : `<${a}>`).join(" ")}`);
		process.exit(1);
	}

	switch (cmd) {
		case "create":
			cmdCreate(cmdArgs[0], flags);
			break;
		case "list":
			cmdList();
			break;
		case "start":
			cmdStart(cmdArgs[0]);
			break;
		case "stop":
			cmdStop(cmdArgs[0]);
			break;
		case "restart":
			cmdRestart(cmdArgs[0]);
			break;
		case "status":
			cmdStatus(cmdArgs[0]);
			break;
		case "edit":
			cmdEdit(cmdArgs[0]);
			break;
		case "remove":
			cmdRemove(cmdArgs[0]);
			break;
		case "migrate":
			cmdMigrate(cmdArgs[0]);
			break;
	}
}

main().catch(err => {
	console.error(err.message);
	process.exit(1);
});