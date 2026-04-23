/* PiGatewayDaemon Runtime
 *
 * Purpose: Manage gateway HTTP server with lockfile/PID tracking for background persistence
 */

import { open, readFile, writeFile } from "node:fs/promises";
import { ensureDir, removeIfExists } from "../lib/fs.js";
import { createServer } from "./server.js";

export class PiGatewayDaemon {
  constructor({ paths, config }) {
    this.paths = paths;
    this.config = config;
    this.server = null;
    this.stopping = false;
    this.status = { phase: "initialized" };
  }

  async writeStatus(extra = {}) {
    this.status = { ...this.status, ...extra };
    await writeFile(this.paths.statusPath, JSON.stringify(this.status, null, 2));
  }

  async acquireLock() {
    await ensureDir(this.paths.runDir);
    let lockHandle;
    try {
      lockHandle = await open(this.paths.lockPath, "wx");
    } catch (error) {
      if (error?.code === "EEXIST") {
        let existing;
        try {
          existing = JSON.parse(await readFile(this.paths.lockPath, "utf8"));
        } catch {
          existing = undefined;
        }

        if (existing?.pid) {
          try {
            process.kill(existing.pid, 0);
            throw new Error(`Gateway daemon already running as pid ${existing.pid}`);
          } catch (pidError) {
            if (pidError?.code !== "ESRCH") throw pidError;
          }
        }

        await removeIfExists(this.paths.lockPath);
        lockHandle = await open(this.paths.lockPath, "wx");
      } else {
        throw error;
      }
    }
    await lockHandle.writeFile(JSON.stringify({ pid: process.pid }));
    await lockHandle.close();
  }

  async releaseLock() {
    await removeIfExists(this.paths.pidPath);
    await removeIfExists(this.paths.lockPath);
  }

  async start() {
    await this.acquireLock();
    await this.writeStatus({ phase: "starting", pid: process.pid });

    this.server = await createServer({ paths: this.paths, config: this.config });

    const address = this.server.address();
    await this.writeStatus({
      phase: "running",
      pid: process.pid,
      host: this.config.host || "127.0.0.1",
      port: address.port,
      url: `http://localhost:${address.port}`,
    });

    return this.server;
  }

  async stop() {
    this.stopping = true;
    await this.writeStatus({ phase: "stopping" });

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    await this.releaseLock();
    await this.writeStatus({ phase: "stopped" });
  }
}