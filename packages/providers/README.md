@budchat/providers

Unified LLM provider layer for OpenAI (Chat + Responses) and Anthropic. Exposes a common `LLMProvider` interface with typed streaming and a factory to select the right provider by model.

## What it does
- Core interfaces: `LLMProvider`, `UnifiedChatRequest/Response`, `StreamEvent`, `ProviderFeature`.
- Base classes: `BaseProvider` (shared validation + EventLog helpers), `OpenAIBaseProvider` (API key wiring, error mapping, model resolution).
- Providers:
  - `OpenAIChatProvider` – Chat Completions API with function calling streaming.
  - `OpenAIResponsesProvider` – Responses API for o‑series and gpt‑5 reasoning, MCP built‑ins.
  - `AnthropicProvider` – Messages API with tool_use/tool_result streaming.
- Utilities: Responses stream transformer (`processResponsesAPIStream`) for robust event normalization.
- Factory: `ProviderFactory.create(model)` chooses implementation via `@budchat/models` provider detection and `isReasoningModel`.

## How it connects
- Consumes `@budchat/events` for inputs and emits unified `Event`/`Segment` updates while streaming.
- Uses `@budchat/models` for model mapping and capability routing.
- API routes call `.stream()` to emit standardized events for `@budchat/streaming` consumption on the client.

## Usage
```ts
import { ProviderFactory } from '@budchat/providers'

const provider = ProviderFactory.create(config.model)
for await (const ev of provider.stream({ events, model: config.model, temperature: 0.7 })) {
  if (ev.type === 'event') /* send event_start */
  if (ev.type === 'segment') /* send segment */
}
```

## Notes
- `OpenAIResponsesProvider` overwrites final assistant text from `response.output_item.done` to avoid duplication; Chat provider self‑assembles text.
- MCP: Remote MCP tool outputs are embedded into the originating `tool_call` segment for Responses streams.

