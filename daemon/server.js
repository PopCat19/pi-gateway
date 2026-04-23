import express from "express";
import { createServer as createHttpServer } from "node:http";
import { completionsRouter } from "./routes/completions.js";
import { modelsRouter } from "./routes/models.js";

/**
 * Create the OpenAI-compatible HTTP server.
 * @param {{ paths: ReturnType<typeof import("../lib/paths.js").getPaths>, config: import("../lib/config.js").GatewayConfig }} options
 */
export async function createServer({ paths, config }) {
  const app = express();
  
  // Middleware
  app.use(express.json({ limit: "10mb" }));
  
  // CORS for any frontend
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  
  // Optional API key auth
  if (config.apiKey) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${config.apiKey}`) {
        return res.status(401).json({ error: { message: "Unauthorized", type: "invalid_request_error" } });
      }
      next();
    });
  }
  
  // Request context
  app.use((req, res, next) => {
    req.context = { paths, config };
    next();
  });
  
  // Routes
  app.use("/v1/chat/completions", completionsRouter);
  app.use("/v1/models", modelsRouter);
  
  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  
  // Error handler
  app.use((err, req, res, next) => {
    console.error("Error:", err);
    res.status(500).json({
      error: {
        message: err.message || "Internal server error",
        type: "server_error",
      },
    });
  });
  
  const server = createHttpServer(app);
  
  await new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${config.port} is already in use. Change the port in config or stop the conflicting service.`));
      } else {
        reject(err);
      }
    });
    server.listen(config.port, config.host, () => resolve());
  });
  
  return server;
}