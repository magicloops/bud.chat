@budchat/models

Centralized model mapping and capability helpers. Defines friendly model names for the UI, maps them to provider API identifiers, detects provider, and exposes capability queries used by both UI and providers.

## What it does
- Friendly→API mapping: `MODEL_MAPPING` with `apiName`, `provider`, `displayName`, `description`.
- Provider detection: `getModelProvider(name)` → `'openai' | 'anthropic'`.
- API name resolution: `getApiModelName(name)` for provider calls.
- Reasoning detection: `isReasoningModel(name)` for Responses API routing.
- UI helpers: `getModelsForUI()` and `getDefaultModel()`.
- Capabilities: `MODEL_CAPABILITIES` and helpers like `supportsReasoning`, `supportsTemperature`, `usesResponsesAPI`, `getAvailableReasoningEfforts`, `getAvailableBuiltInTools`, etc.

## How it connects
- `@budchat/providers` uses `getModelProvider`, `getApiModelName`, and `isReasoningModel` to select implementations and route features.
- UI components render options via `getModelsForUI()` and pick defaults via `getDefaultModel()`.

## Usage
```ts
import { getModelsForUI, getDefaultModel, getApiModelName, getModelProvider, isReasoningModel } from '@budchat/models'

const options = getModelsForUI() // [{ value, label, provider }]
const model = getDefaultModel()
const apiModel = getApiModelName(model)
const provider = getModelProvider(model)
const useResponses = isReasoningModel(model)
```

## Notes
- Updating model versions or defaults happens in this package only; all dependents pick up changes automatically.
