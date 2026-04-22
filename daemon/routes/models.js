import { Router } from "express";

export const modelsRouter = Router();

/**
 * GET /v1/models - List available models
 * Any OpenAI-compatible frontend expects this format
 */
modelsRouter.get("/", async (req, res) => {
  const { config } = req.context;
  
  // TODO: Integrate with Pi's model registry
  // For now, return a basic list based on config.defaultModel
  const models = [];
  
  // Add default model if configured
  if (config.defaultModel) {
    const [provider, ...modelParts] = config.defaultModel.split("/");
    const modelId = modelParts.join("/");
    models.push({
      id: config.defaultModel,
      object: "model",
      created: Date.now(),
      owned_by: provider || "pi",
    });
  }
  
  // Add common models as examples
  // In production, this would query Pi's model registry
  const exampleModels = [
    { id: "openai/gpt-4o", owned_by: "openai" },
    { id: "anthropic/claude-sonnet-4", owned_by: "anthropic" },
    { id: "ollama/llama3.2", owned_by: "ollama" },
  ];
  
  for (const model of exampleModels) {
    if (!models.find(m => m.id === model.id)) {
      models.push({
        id: model.id,
        object: "model",
        created: Date.now(),
        owned_by: model.owned_by,
      });
    }
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
  const { config } = req.context;
  
  // TODO: Integrate with Pi's model registry
  const [provider, ...modelParts] = id.split("/");
  
  res.json({
    id,
    object: "model",
    created: Date.now(),
    owned_by: provider || "pi",
  });
});