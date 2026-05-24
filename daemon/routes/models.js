import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";

export const modelsRouter = Router();

/**
 * Convert a Pi model registry entry to an OpenAI model object.
 */
function toOpenAIModel(model) {
  return {
    id: `${model.provider}/${model.id}`,
    object: "model",
    created: Date.now(),
    owned_by: model.provider,
    name: `${model.provider}/${model.name || model.id}`,
  };
}

/**
 * Load runtime models written by the gateway extension (includes extension-registered providers).
 */
function loadRuntimeModels(workspaceDir) {
  const runtimePath = join(workspaceDir, "runtime-models.json");
  if (!existsSync(runtimePath)) return [];
  try {
    return JSON.parse(readFileSync(runtimePath, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Collect all models: runtime-first (extension-provided, always included),
 * then registry models whose providers have configured auth.
 * Runtime models replace registry models with the same provider+id.
 */
function collectModels(modelRegistry, runtimeModels) {
  const seen = new Set();
  const models = [];

  // Runtime models always included (extension-registered, auth verified by Pi)
  for (const m of runtimeModels) {
    if (m.provider && m.id) {
      const key = `${m.provider}/${m.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        models.push(toOpenAIModel(m));
      }
    }
  }

  // Registry models: only include from configured providers
  if (modelRegistry?.models) {
    for (const m of modelRegistry.models) {
      if (m.provider && m.id) {
        const key = `${m.provider}/${m.id}`;
        if (!seen.has(key) && modelRegistry.hasConfiguredAuth(m)) {
          seen.add(key);
          models.push(toOpenAIModel(m));
        }
      }
    }
  }

  return models;
}

/**
 * GET /v1/models - List all models (extension registrations + built-in + custom).
 */
modelsRouter.get("/", (req, res) => {
  const { config, modelRegistry, paths } = req.context;
  const workspaceDir = paths?.workspaceDir || "";
  const runtimeModels = loadRuntimeModels(workspaceDir);
  const models = collectModels(modelRegistry, runtimeModels);

  // Ensure default model is present
  if (config.defaultModel && !models.find(m => m.id === config.defaultModel)) {
    const [provider] = config.defaultModel.split("/");
    models.push({
      id: config.defaultModel,
      object: "model",
      created: Date.now(),
      owned_by: provider || "pi",
    });
  }

  res.json({
    object: "list",
    data: models,
  });
});

/**
 * GET /v1/models/:id - Get a specific model.
 */
modelsRouter.get("/:id(*)", (req, res) => {
  const { modelRegistry, paths } = req.context;
  const workspaceDir = paths?.workspaceDir || "";
  const runtimeModels = loadRuntimeModels(workspaceDir);
  const models = collectModels(modelRegistry, runtimeModels);
  const { id } = req.params;
  const model = models.find(m => m.id === id);

  if (model) {
    return res.json(model);
  }

  const [provider] = id.split("/");
  res.json({
    id,
    object: "model",
    created: Date.now(),
    owned_by: provider || "pi",
  });
});
