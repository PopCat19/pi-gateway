import { Router } from "express";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const modelsRouter = Router();

/**
 * Load models from Pi's models.json
 */
async function loadModelsFromPi() {
  const modelsPath = join(homedir(), ".pi/agent/models.json");
  
  try {
    const content = await readFile(modelsPath, "utf-8");
    const config = JSON.parse(content);
    const models = [];
    
    if (config.providers) {
      for (const [providerName, provider] of Object.entries(config.providers)) {
        if (provider.models) {
          for (const model of provider.models) {
            models.push({
              id: `${providerName}/${model.id}`,
              object: "model",
              created: Date.now(),
              owned_by: providerName,
              name: model.name || model.id,
            });
          }
        }
      }
    }
    
    return models;
  } catch (error) {
    console.error("Failed to load models from Pi:", error.message);
    return [];
  }
}

/**
 * GET /v1/models - List available models
 * Any OpenAI-compatible frontend expects this format
 */
modelsRouter.get("/", async (req, res) => {
  const { config } = req.context;
  const models = await loadModelsFromPi();
  
  // Add default model if configured and not already in list
  if (config.defaultModel && !models.find(m => m.id === config.defaultModel)) {
    const [provider, ...modelParts] = config.defaultModel.split("/");
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
 * GET /v1/models/:id - Get specific model
 */
modelsRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  const models = await loadModelsFromPi();
  const model = models.find(m => m.id === id);
  
  if (model) {
    res.json(model);
  } else {
    // Return basic model info even if not in registry
    const [provider] = id.split("/");
    res.json({
      id,
      object: "model",
      created: Date.now(),
      owned_by: provider || "pi",
    });
  }
});