# Streaming Segment Unification — Frontend Simplification Plan

## Goals
- Single, straightforward rendering model for assistant events during streaming and after refresh.
- Unify “segments” between backend and frontend: the same Event + Segment structures drive both.
- Keep streaming transport message types separate from Event/Segment types.
- Support three primary visual categories in order-aware fashion:
  1) Thinking (Reasoning)
  2) Tools (Calls + Results)
  3) Text (Natural language output)
- Minimize special cases per provider (Anthropic vs OpenAI Responses). Normalize differences in the EventBuilder.

## Current Pain Points (Observed)
- Reasoning overlay: first segment sometimes never shows; deltas replace instead of append; final parts arrive without visible accumulation.
- Multi-turn boundaries: missing early `event_start` yields shoving; fixed for Anthropic, still tricky for Responses.
- Tools stream vs finalize: live tool events were missing until finalize; fixed with builder upserts, but path was inconsistent.
- Role/merge confusion: message_final sometimes appears with mismatched rendering (UI thinks user; data shows assistant).
- Fragmented logic: renderer depends on a mix of live draft, optimistic local state, and store snapshots.

## Key Simplifications
1) Canonical Event/Segment on the frontend
- Use the same unified Event + Segment types as the backend. No “frontend-only” segment shapes.
- EventBuilder is the sole place that translates streaming transport messages into Event/Segments.

2) Clear separation of concerns
- Streaming transport messages (SSE) are provider/transport-specific and typed separately.
- EventBuilder consumes streaming messages, ignores non-structural ones (progress, traces), and mutates a single in-memory Event draft.
- Renderers consume only Events/Segments (from draft during streaming; from store/DB after).

3) Three visual segment families
- Thinking (Reasoning):
  - One segment per assistant event (`type: 'reasoning'`) with ordered `parts`.
  - During streaming: show overlay that accumulates text per-part; on complete, collapse behind “Show Reasoning”.
- Tools:
  - `tool_call` and `tool_result` segments. For Responses: `tool_call` may carry `output` directly; for Anthropic: `tool_result` may be a separate event. Builder ensures the currently-streaming assistant event can “see” results by adding synthetic tool_result segments or caching references, so the Tool UI has data.
- Text:
  - `text` segments streamed as deltas; builder appends.
  - Preserve order relative to reasoning and tools.

4) Ordering and merging
- Maintain event.segments as an ordered list matching the logical sequence (reasoning → tools → text; but allow text interleaving when providers do that, e.g., Responses+MCP).
- EventBuilder enforces stable positions: existing segments update in-place; new ones are appended where appropriate.

5) One streaming flag in the renderer
- Renderers accept `isStreaming: boolean` and adapt:
  - Reasoning: overlay visible and live when streaming; collapsed summary post-stream.
  - Tools: show spinners/args deltas during streaming; result dropdown when complete.
  - Text: stream tokens into the first/active text segment; show full text after stream.

## Data Model (unchanged, reaffirmed)
- Event
  - `id`, `role: 'assistant'|'user'|'system'|'tool'`, `segments: Segment[]`, `ts`
- Segment (subset relevant to UI)
  - `reasoning`: `{ id, output_index, sequence_number, parts: ReasoningPart[], streaming?: boolean, streaming_part_index?: number }`
  - `tool_call`: `{ id, name, args, output? , error?, server_label?, display_name?, server_type?, sequence_number?, output_index? }`
  - `tool_result`: `{ id, output, error? }`
  - `text`: `{ text, id?, sequence_number?, output_index? }`

## Streaming Transport Messages (SSE)
- Examples: `event_start`, `segment`, `event_complete`, `token`, `reasoning_*`, `mcp_tool_*`, `progress_*`, `message_final`, `complete`, `error`.
- These are NOT segments; they are instructions/signals to update the in-flight Event draft.
- The EventBuilder is the only consumer that decides how to transform them.

## EventBuilder Responsibilities (frontend)
- Lifecycle:
  - On `event_start`: create or switch the current assistant Event draft; seed known segments (e.g., empty reasoning on `reasoning_start`).
  - On `event_complete`: flush and finalize draft; hand off to store component.
  - On `message_final`: accept canonical final event; reconcile with draft if needed; prefer server truth on finalize.
- Append/merge rules:
  - Text tokens append to the active text segment.
  - Reasoning parts append deltas by `summary_index`; ensure a `reasoning` segment exists early.
  - Tool flow:
    - Start: add `tool_call` (args empty initially).
    - Args delta/finalize: update the `args` of the `tool_call`.
    - Completion:
      - If Responses: attach `output` onto `tool_call`.
      - If Anthropic: emit/attach a `tool_result` segment (builder may add synthetic `tool_result` in-draft so UI can render it live).

## Rendering Contract
- Renderer input: an Event and `isStreaming` flag.
- Renderer output: ordered UI blocks by walking `event.segments`:
  - If `reasoning`: show StreamingReasoningSegment (overlay) when `isStreaming`; ReasoningSegment collapsed when not.
  - If `tool_call`: show ToolCallSegment; if `tool_result` exists or output on `tool_call` is present, show result indicator + dropdown.
  - If `text`: show streamed or final text segment.
- Unknown segment types: render as preformatted JSON or markdown as a fallback (developer-friendly until a dedicated component exists).

## Store and Draft Sources
- During streaming: prefer draft from EventBuilder for the active assistant event; other events read from store.
- After finalize: renderer uses store/DB only.
- Progress: stored in draft (and optionally in local state during stream) to drive a consistent progress indicator.

## Provider Normalization (Builder-side)
- Anthropic: map `message_start` → `event_start`, text deltas → text segment, tool use → `tool_call` + separate `tool_result` (synthetic in draft if needed), finalize → `event_complete`.
- OpenAI Responses: map `response.output_text.delta` → text tokens; `mcp_tool_*` events → tool_call lifecycle; `reasoning_*` → reasoning parts; ensure early `event_start` based on first output or reasoning signal.

## Error and Progress Signals
- Progress: transient; not materialized as segments — stored on draft for UI.
- Errors: surfaced as a toast/log and materialized only if represented by a tool_result with `error`.

## Incremental Plan
1) Builder refactor (limited surface)
- Ensure all streaming messages are funneled into the Builder.
- Remove renderer-specific ad hoc logic — renderer consumes segments only.

2) Renderer consolidation
- Sequential renderer renders segments by type in order.
- Reasoning overlay: always seeded on reasoning_start; append on deltas; collapse on complete.

3) Store/draft boundary cleanup
- Single source of truth per assistant turn: draft during stream, store after finalize.
- Ensure `event_start`/`event_complete` are always paired per turn.

4) Provider parity testing
- Anthropic: multi-turn + tools + text edge cases.
- Responses: MCP tools + reasoning without deltas + interleaved text cases.

## Acceptance Checklist
- Reasoning overlay appears on first `reasoning_start`, grows cumulatively, collapses post-stream.
- Tools appear during streaming; results show without refresh.
- Text segments stream and render in sequence, including interleaved cases.
- After finalize, the event looks identical to DB reloaded state.
- No role-flip issues; final event role remains assistant.

## Open Questions
- Should synthetic `tool_result` segments be persisted or only in-draft? Current plan: only in-draft; DB has canonical tool_result events when applicable.
- Do we expose a simple dev toggle to visualize raw streaming messages vs segments for debugging?
- Any provider-specific quirks (e.g., batched reasoning parts) we want to normalize even further at the Builder layer?

