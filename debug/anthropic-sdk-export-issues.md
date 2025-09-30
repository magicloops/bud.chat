# Anthropic SDK Export – Potential Issues

## Current flow snapshot
- Export pipeline builds a provider transcript from raw events via `buildProviderTranscript` before code generation (`lib/exports/providerTranscripts/buildProviderTranscript.ts:611`).
- Anthropic request payloads are reconstructed from the history passed into each assistant turn, using `eventsToAnthropicMessages` from the shared events package (`lib/exports/providerTranscripts/buildProviderTranscript.ts:636-672`, `packages/events/src/transforms/anthropic.ts:14-17`).
- The Python SDK snippet is assembled step-by-step inside `generateAnthropicSdk`, emitting a `client.messages.create({...})` call per assistant turn (`lib/exports/generators/anthropicSdk.ts:6-56`).
- Front-end JSON mode feeds the transcript with conversation metadata gathered at render time, assuming overrides like `max_tokens` are available in `conversation.meta` (`components/EventJsonMode/EventJsonMode.tsx:35-47`).

## Potential pain points spotted
- `max_tokens` is only forwarded when `conversation.meta.model_config_overrides.max_tokens` exists, but Anthropic treats it as required; missing overrides would yield generated scripts without `max_tokens` (`lib/exports/providerTranscripts/buildProviderTranscript.ts:656-657`).
- The `model` value passed through the UI may be the friendly slug rather than the API identifier, which would break SDK calls unless upstream code already mapped it (`components/EventJsonMode/EventJsonMode.tsx:35-38`).
- Tool schema reconstruction infers `input_schema` from previous calls and applies a generic description, which may diverge from the real schema when arguments were partial or when optional fields never appeared (`lib/exports/providerTranscripts/buildProviderTranscript.ts:660-664`).
- `serializeAnthropicToolChoice` maps `tool_choice="required"` to `{ type: 'any' }`, which might not match the latest Anthropic contract and could cause validation errors when users explicitly forced a tool (`lib/exports/providerTranscripts/buildProviderTranscript.ts:430-438`).
- `eventsToAnthropicMessages` serialises tool results as JSON strings; if the SDK now expects structured `content` arrays (per recent docs), this stringification could lead to duplicated escaping or provider rejections (`packages/events/src/transforms/anthropic.ts:62-73`).
- Generated scripts access the API key via `os.environ["ANTHROPIC_API_KEY"]`, raising `KeyError` when the variable is unset, while Anthropic's examples default to `.get` (`lib/exports/generators/anthropicSdk.ts:19`).
- Each exported step prints the raw message object but does not persist the response into subsequent payloads; we rely entirely on recorded history instead of the freshly returned content, so reruns after model drift may desynchronise quickly (`lib/exports/generators/anthropicSdk.ts:23-39`).

## Hypotheses to validate
1. Generated payloads without `max_tokens` are failing immediately when replayed through the SDK; ensure we always include either the recorded value or a safe fallback (e.g., conversation defaults).
2. Friendly model identifiers (e.g., `claude-3-5-sonnet`) slip into exports when the UI context was not pre-mapped, causing 404s from the SDK—need confirmation that export mode receives API model ids.
3. Tool result serialisation as JSON strings is triggering duplicated text blocks or schema mismatches when Anthropic rehydrates the conversation; investigate whether we should emit structured `content` arrays instead.
4. The `tool_choice` mapping is out of date (e.g., should send `{ "type": "any" }` vs `{ "type": "auto" }`), leading to `tool_choice` validation errors on replay.
5. Reconstructed `tools` definitions omit nested types or optional fields when original calls supplied partial arguments, so subsequent replays choke on validation when the assistant reuses those tools; consider augmenting inference with stored bud/tool metadata.
6. Because we replay history without incorporating new responses, any divergence in streaming persistence (like duplicated text segments) yields doubled assistant content in exports—verify event deduplication before generation.
