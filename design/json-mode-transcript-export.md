**Title:** JSON Mode & Transcript Export UX

**Context / Problem**
- Our chat UI renders the unified `Event` schema, so developers cannot inspect the exact provider payloads that were sent to/received from OpenAI or Anthropic.
- Debugging tool invocation, Anthropic block structure, or OpenAI Responses output requires reproducing the call manually or combing through backend logs.
- Teams want to lift an existing conversation into runnable sample code (TypeScript/Python, SDK vs raw HTTP), but we currently lack a developer-facing surface that reconstructs those provider payloads on demand.

**Goals**
- Add an opt-in "JSON mode" that shows every message in the timeline as provider-accurate JSON (requests + responses), including tool calls, reasoning, and metadata.
- Generate provider payloads and export snippets client-side using the existing unified event history—no new persistence or provider-specific transcript storage.
- Provide an export surface that generates ready-to-run snippets in TypeScript or Python using either provider SDKs or plain HTTP streaming.
- Keep the default chat experience unchanged and avoid introducing heavy re-render cycles in the main `EventList` view.

**Non-Goals / Constraints**
- Do not make provider transcripts editable or replayable in this iteration; read-only inspection/export only.
- Do not introduce new database tables or fields for provider transcripts; everything must be derivable from existing event data and configuration.
- No attempt to support third-party providers beyond OpenAI (Chat/Responses) and Anthropic yet.

---

**Current Architecture Notes**
- Unified events live in `packages/events/src/events.ts` and are rendered by `components/EventList/EventItemSequential.tsx` with conversation state from `state/eventChatStore.ts`.
- Provider adapters (`packages/providers/src/unified/*Provider.ts`) already expose deterministic conversion logic (e.g., `EventLog.toProviderMessages`) we can mirror on the client.
- Streaming responses are surfaced to the client through `app/api/chat/route.ts` (see streaming loop around `provider.stream` at `app/api/chat/route.ts:736`) and processed by `lib/streaming/frontendEventHandler.ts`.
- `components/CodeBlock.tsx` already handles syntax highlighting + copy/download for code snippets.

---

**Proposed UX**
- Add a "JSON mode" toggle in the conversation header (same bar rendered by `components/EventStream.tsx:70`). The toggle persists per-browser (localStorage) so developers can leave it on.
- When JSON mode is active:
  - Replace the standard `EventList` with a developer-focused `EventJsonList` component.
  - Each chat turn expands into a collapsible card: request (messages the provider would receive) on the left, response on the right. For Anthropic the response blocks include tool_use/tool_result objects; for OpenAI Responses we show output items plus reasoning summaries.
  - Highlight the provider/model badge, event timestamp, and whether the payload is reconstructed losslessly or has gaps (e.g., missing legacy data).
  - Provide per-card copy buttons to copy a single payload or the full request/response pair.
- Add an "Export" button inside JSON mode (near the toggle). Clicking opens a modal with tabs:
  1. **TypeScript SDK** (OpenAI/Anthropic as appropriate).
  2. **TypeScript HTTP** (fetch + EventSource stream example).
  3. **Python SDK**.
  4. **Python HTTP**.
  Each tab uses `CodeBlock` to render the generated snippet and allows direct download.

---

**Provider Payload Reconstruction (Client-Side)**
1. **Inputs**
   - Conversation events (`Event[]`) already available in the store (or fetched via `GET /api/conversations/[id]?include_events=true`).
   - Conversation metadata (model, tool configuration, mcp/built-in settings).
2. **Helpers**
   - Reuse or port the logic from `EventLog.toProviderMessages` (OpenAI + Anthropic) to the client (`packages/events` is already shareable).
   - Introduce a lightweight helper (e.g., `lib/exportTransforms`) that:
     - Accepts `events`, `model`, and provider-specific options.
     - Returns provider-formatted request payloads for Chat Completions, Responses, or Anthropic Messages.
     - Reconstructs a provider-style response by walking assistant `Event` segments (text, tool_call, tool_result, reasoning) and mapping them back into the provider schema.
   - For OpenAI Responses, leverage the reasoning metadata (`segments` + `response_metadata`) to build the output items array.
3. **Limitations**
   - Historical conversations that predate reasoning/tool segments may require best-effort fallbacks (e.g., text-only responses). Surface badges or warnings when fidelity is reduced.
   - Tool results that were truncated server-side remain truncated.

---

**JSON Mode Rendering Flow**
1. When JSON mode toggles on, memoize `providerContext = resolveProviderFromModel(conversation.meta)`.
2. For each assistant turn, run `buildProviderPayloads(event, precedingEvents, providerContext)` to derive:
   - `requestPayload`: full provider request body the API would see if replayed from scratch.
   - `responsePayload`: reconstructed provider response (final message, tool calls, reasoning summaries, completion usage).
3. Render payloads as prettified JSON via `CodeBlock`, with copy/download controls.
4. For user/system/tool events, optionally display the raw JSON event for completeness (or basic metadata) to keep context visible.

---

**Export Generation**
- Create `lib/exports/providerTranscripts.ts` with helpers to normalize reconstructed payloads into provider-agnostic steps.
- Implement language-specific generators under `lib/exports/generators/` (TypeScript + Python). Each generator receives `{ conversationMeta, events, buildProviderPayloads }` and returns `{ label, language, code }` for the modal.
  - **SDK variants:** Use OpenAI/Anthropic official clients, embed reconstructed request payload, and show streaming handler skeleton wired to tool calls when present.
  - **HTTP variants:** Emit raw REST examples using `fetch` (TS) or `requests`/`sseclient` (Python). Include headers, SSE loop, and notes for tool calls.
  - Support swapping providers regardless of original run: developers can choose OpenAI Chat, OpenAI Responses, or Anthropic tabs; generators transform the unified events accordingly.
- Use reconstructed stream metadata (reasoning segments, tool results) to illustrate SSE handling; fall back to simple completion polling if reasoning data is unavailable.

---

**Implementation Steps (High Level)**
1. Payload reconstruction utilities
   - Expose a browser-safe version of `EventLog.toProviderMessages` and add complementary helpers to convert assistant `Event` segments back into provider response JSON.
   - Create `buildProviderPayloads` that orchestrates request/response reconstruction per provider + API type.
2. Frontend UI
   - Add JSON mode toggle + state persistence.
   - Build `EventJsonList` view + per-event cards using the new helpers.
   - Implement export modal with tabbed code previews and provider selection.
3. Generators & validation
   - Implement TypeScript/Python (SDK + HTTP) generators using reconstructed payloads.
   - Add CI-friendly tests to snapshot generator output for representative conversations.
4. Polish & guardrails
   - Handle large payload truncation with expandable sections.
   - Show fidelity badges/warnings when reconstruction drops data (e.g., missing reasoning metadata).
   - Feature-flag JSON mode (e.g., workspace setting) if needed before general release.

---

**Open Questions**
- How should we surface gaps in reconstruction (e.g., missing legacy tool metadata) so developers trust what they see?
- Do we need provider-specific toggles in the export modal, or can we auto-select based on the conversation’s model with optional overrides?
- Should we memoize reconstruction results in React Query or rely on cheap recalculation per view (considering large conversations)?
- Are there edge cases (e.g., partial streaming failures) where events cannot map cleanly back to provider payloads, and how should the UI communicate that?

**Risks / Follow-Ups**
- Reconstruction accuracy must stay in sync with provider evolution; changes to provider schemas require updates to our helpers.
- Export snippets must track provider SDK versions; consider centralizing version constants.
- Additional providers (Azure OpenAI, Gemini) will require extending reconstruction helpers; keep abstractions flexible.

---

**Helper Architecture Draft**
- **Entry point:** `lib/exports/providerTranscripts/buildProviderTranscript.ts` returns `ProviderTranscript` describing an ordered list of provider call steps derived purely from events + conversation meta.
- **Types:**
  - `TargetProvider = 'openai-chat' | 'openai-responses' | 'anthropic-messages'`.
  - `ProviderCallStep { assistantEventId; request: JsonValue; response: JsonValue; streamPreview?: JsonValue[]; warnings?: string[]; }`.
  - `TranscriptContext { model: string; events: Event[]; temperature?: number; maxTokens?: number; mcpConfig?: MCPBudConfig; builtInToolsConfig?: BuiltInToolsConfig; }`.
- **Workflow per step:**
  1. Split conversation into segments ending with each assistant event (helpers walk the event array once).
  2. Build provider-specific request body using the slice of history up to the assistant event.
     - Reuse shared conversion helpers extracted from the provider adapters (see action items below).
     - Wrap messages into the provider payload shape (`{ model, messages, ... }` for Chat Completions, `{ input: [...] }` for Responses, `{ messages, system }` for Anthropic).
     - Inject tool definitions derived from `mcpConfig/builtInToolsConfig` when the history includes tool calls.
  3. Reconstruct provider response by mapping the assistant event’s segments back into the provider schema.
     - Text segments → `content` or `output_text` blocks.
     - Tool calls → `tool_calls` / `tool_use` / `mcp_call` entries.
     - Tool results following the assistant event are folded in when the provider would have seen them (OpenAI tool role, Anthropic tool_result blocks).
     - Reasoning segments → Responses `reasoning` items or Anthropic `thinking` JSON; for Chat Completions we flatten into a comment or omit with a warning.
  4. Capture `response_metadata` (tokens, reasoning stats) when available to populate usage fields.
  5. Surface warnings (e.g., missing reasoning data, truncated tool result) for the UI to badge.
- **Shared utilities:**
  - `collectHistoryForAssistant(events: Event[], assistantIndex: number)` returns `[historyEvents, trailingToolResults]`.
  - `deriveToolDefinitions(events, context)` inspects tool_call segments to build OpenAI tool descriptors (`functions`) and Anthropic tool schemas.
  - `mapReasoningToResponses(segment)` extracts summary text + effort for Responses API.
- **Client safety:** Helpers avoid importing provider SDKs; output types use plain JSON structures. Any ID generation relies on deterministic data (`event.id`, `segment.id`).

**Shared Conversion Strategy**
- The provider adapters already contain deterministic conversions (e.g., Responses `convertEventsToInputItems`, tool-call/result mappers, reasoning serialization). To avoid drift between backend and export logic, extract these into a platform-neutral module (e.g., `packages/events/transforms/providerAdapters.ts`).
- Backend `@budchat/providers` classes import the shared module and add SDK/network concerns on top; the module remains Node-safe but free of SDK imports.
- Frontend transcript helpers import the same shared transforms to rebuild provider payloads, ensuring identical behavior even as provider formats evolve.
- Action items:
  1. Identify conversion functions inside `packages/providers/src/unified/*` and move them into the shared module (pure data utilities only).
  2. Update provider classes to import the new helpers.
  3. Refactor `lib/exports/providerTranscripts` to use the shared helpers instead of bespoke transformations.
  4. Add regression tests around the shared module so backend and frontend stay in sync.

---

**Export Generator Strategy**
- **Module layout:**
  - `lib/exports/generators/index.ts` orchestrates generator selection.
  - Per-target files (`openaiChatSdk.ts`, `openaiChatHttp.ts`, `openaiResponsesSdk.ts`, `openaiResponsesHttp.ts`, `anthropicSdk.ts`, `anthropicHttp.ts`).
  - Shared template helpers (`renderHeader`, `renderStepComment`, `formatJSONLiterals`).
- **Generator input:** `ProviderTranscript` + `GeneratorOptions { includeStreaming?: boolean; packageVersions?: Record<string,string>; }`.
- **Output shape:** `{ label: string; language: 'typescript' | 'python'; code: string; warnings?: string[]; }` consumed by the export modal.
- **Templates:**
  - SDK generators output idiomatic client construction, loop through transcript steps, and interpolate request JSON via `JSON.stringify(step.request, null, 2)` with proper indentation.
  - HTTP generators show `fetch` / `requests` POST examples and SSE handlers seeded with `step.streamPreview` when available (fallback to simple `.text()` parsing if not).
  - Comments explain where to plug secrets, workspace IDs, tool registration, etc.
- **Cross-provider support:**
  - UI can pass any `TargetProvider`; generators do not validate against the conversation’s original provider.
  - When transcript helpers emit warnings (e.g., feature unsupported on target provider), generators echo them as inline comments (`// TODO: Review tool output ...`).
- **Testing:** Snapshot tests compare generator output for canned conversations covering text-only, tool call, and reasoning cases. Mock `ProviderTranscript` fixtures live under `lib/exports/__tests__/fixtures/`.

---

**Next Steps (Helpers & Generators)**
1. ✅ Implement helper scaffolding + types (shared provider transforms extracted to `packages/events/src/transforms/*`).
2. ✅ Port provider-specific build functions (OpenAI Chat/Responses + Anthropic now in shared module; providers consume them).
3. ✅ Add transcript fixtures + unit tests ensuring deterministic output (`packages/events/__tests__/transforms/*`, `lib/exports/__tests__/providerTranscripts.test.ts`).
4. ⏳ Layer generator templates atop the transcript helpers and backfill snapshot/code-output tests.
5. ⏳ After helpers/generators stabilize, wire JSON mode UI to consume them.
