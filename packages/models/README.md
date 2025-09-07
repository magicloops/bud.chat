@budchat/models (scaffold)

Internal workspace package that re-exports the app’s model mapping functions and capabilities.

During migration, it forwards to existing files under `lib/` to avoid broad changes. Later phases will move
implementations here and flip app imports to use this package directly.

Exports include:
- getModelsForUI, getDefaultModel
- getApiModelName, getModelProvider, isReasoningModel
- capability helpers (supportsReasoning, usesResponsesAPI, etc.)

