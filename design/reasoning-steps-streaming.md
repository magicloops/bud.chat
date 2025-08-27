**Title:** Streaming Reasoning Steps and Tool Calls Above Assistant Text

**Goal**
- Keep focus on the assistant’s final text while still providing live visibility into progress (reasoning + tool use) as it streams.
- Before text begins: show streamed non-text segments (reasoning + tool calls) at the top of the assistant message.
- Once text starts: collapse the steps area and show a “Show steps” expander that reveals all non-text segments collected for that message.
- Support both live streams and already-persisted messages (segments from DB).

**Current Behavior (Summary)**
- SSE streaming over the unified `/api/chat` endpoint.
- Front-end processes stream in `lib/streaming/frontendEventHandler.ts` and stores data in `state/eventChatStore.ts`.
- Events support multiple segment types, but UI currently interleaves them inline with text.

**Proposed UX**
- Pre-text phase: display a vertical list of “steps” at the top of the assistant message. Steps = every segment where `segment.type !== 'text'` (reasoning, tool_call, tool_result, etc.). Stream them as they arrive.
- Text phase: when the first text token arrives, auto-collapse the steps area and show a compact header with a “Show steps” button and a badge indicating total steps. Clicking expands to reveal all steps accumulated so far.
- Persisted messages: when rendering from DB without streaming, if message has at least one text segment, render steps collapsed with the “Show steps” control; otherwise render steps area (pre-text style).

**Data/Contract Changes**
- No DB schema change required. We will rely on existing `events` with `segments` and `response_metadata`.
- Back end should emit additional lightweight markers (recommended) to make the front-end simpler and more robust:
  - `message_started`: announces an assistant message with an `event_id` and optional `segment_total_estimate`.
  - `segment`: streams each segment with `segment_index`, `segment_type`, and payload.
  - `message_finalized`: announces the final `segment_total` and that no more segments will arrive for this message.
  - These are logical SSE payload types (not SSE event names) carried via `data: { type: '...' }` in SSE.
- Alternatively (fallback), the front-end can infer start/finalization from existing stream types and a terminal `complete` event, but the explicit markers reduce edge cases.

**Back-End Changes**
- In `/api/chat` streaming flow:
  - Emit `message_started` once per assistant turn with fields:
    - `message_id` (string), `segment_total_estimate?` (number).
  - Emit each non-text step as a `segment` payload, e.g.:
    - `{ type: 'segment', message_id, segment_index, segment_type: 'reasoning' | 'tool_call' | 'tool_result', payload }`.
  - When text begins, continue to emit `token`/text deltas as today. Optionally include `hideProgress: true` on the first text token so the UI collapses steps automatically.
  - Emit `message_finalized` at the end with fields:
    - `message_id`, `segment_total` (number). This is useful for rendering counts and for reconciling with DB once persisted.
  - Map provider-specific events to unified segments using existing `eventBuilder.ts` and provider adapters; do not change storage format.
- Persisting:
  - Continue storing unified `events` with `segments[]` of mixed types. No schema change.
  - Optionally set `response_metadata.segment_total` on finalize so the front-end can show step counts even when reloading from DB.

**Front-End Changes**
- Store (state/eventChatStore):
  - Per assistant message, track:
    - `stepsSegments`: array of non-text segments in arrival order.
    - `textStarted`: boolean (set on first text token, or true if any text segment exists when loading from DB).
    - `isStepsCollapsed`: boolean UI state (default false pre-text; switch to true when text starts; toggled by user).
    - `segmentTotal?`: optional final count for UI badges (from `message_finalized` or `response_metadata.segment_total`).
  - Provide idempotent “upsert-segment” helpers to merge streamed segments with any preloaded DB segments.

- Streaming handler (lib/streaming/frontendEventHandler.ts):
  - Handle new payload types:
    - `message_started`: create/ensure message scaffold in store, reset steps collection.
    - `segment` (non-text): push into `stepsSegments` for the matching message; keep displaying live in the steps area.
    - First `token` with `hideProgress: true`: set `textStarted = true` and `isStepsCollapsed = true` in the store so UI collapses automatically.
    - `message_finalized`: store `segmentTotal` for badges; do not alter text/steps contents.
  - Backward compatibility: if `message_started`/`message_finalized` don’t arrive, infer `textStarted` upon first token; compute `segmentTotal` as `stepsSegments.length` on finalize.

- Rendering (components/chat/*):
  - ChatMessage (assistant):
    - Header area for steps: when `!textStarted`, render steps list as items streaming in.
    - When `textStarted`, render a compact bar with:
      - “Show steps” button toggling `isStepsCollapsed`.
      - Badge “Steps: N” (N = `segmentTotal` or `stepsSegments.length`).
    - On expand, show the full steps list above the text.
  - Steps presentation:
    - Reasoning segments: render as concise bullet text; stream in order.
    - Tool calls: show name + args preview; stream status (in progress/complete). Truncate long payloads with “Expand”.
    - Tool results: show short summary; expandable details.
  - Text area: unchanged except for not interleaving step segments. Text tokens stream as today.

- Initial render from DB:
  - On conversation load, split message segments into `stepsSegments` (all non-text) and text content.
  - Set `textStarted = true` if any text is present; default `isStepsCollapsed = true` in that case.
  - If no text, render in pre-text streaming style (even when not actively streaming).

**Event Examples (SSE data payloads)**
- `message_started`: `{ type: 'message_started', message_id, segment_total_estimate: 3 }`
- `segment` reasoning: `{ type: 'segment', message_id, segment_index: 0, segment_type: 'reasoning', payload: { parts: [...] } }`
- `segment` tool call: `{ type: 'segment', message_id, segment_index: 1, segment_type: 'tool_call', payload: { id, name, args } }`
- `segment` tool result: `{ type: 'segment', message_id, segment_index: 2, segment_type: 'tool_result', payload: { id, output } }`
- First text token: `{ type: 'token', content: 'T', hideProgress: true }`
- `message_finalized`: `{ type: 'message_finalized', message_id, segment_total: 3 }`

**Edge Cases**
- Tool calls after text started: still collect them into `stepsSegments` and keep them hidden behind “Show steps”; update the steps count badge live.
- Partial/incomplete tool results: show streaming state and finalize entry when `tool_complete` is received.
- Long outputs in tool results: truncate and allow expand to view all.
- Missing markers (backwards compatibility): infer phases from tokens and use length as segment count.

**Rollout Plan**
1. Front-end: add store fields and ChatMessage UI for steps area + collapse logic; ensure DB-only renders split segments correctly.
2. Front-end: update `frontendEventHandler` to handle `message_started`, `segment`, `message_finalized`, and `hideProgress` on first token.
3. Back-end: emit `message_started` and `message_finalized`; convert provider events into unified `segment` payloads for non-text segments before text begins; include `hideProgress: true` flag with the first text token.
4. Optional: set `response_metadata.segment_total` in DB on finalize for faster counts at reload.
5. QA: verify streaming, collapse behavior, persisted reloads, and long tool result truncation.

**Open Questions**
- Do we want a compact “live progress” indicator (spinner + latest step) in the collapsed bar once text starts? Default proposal: no; collapse to a simple “Show steps (N)” unless we see a UX need.
- Should we show step categories (Reasoning vs Tool) with icons? Proposal: yes, minimal icons to aid scanning.
- Do we need segment-level timestamps in UI? Proposal: keep in metadata only; avoid visual clutter by default.

**Affected Files (High-Level)**
- Front-end:
  - `lib/streaming/frontendEventHandler.ts` (new handlers + flags)
  - `state/eventChatStore.ts` (per-message fields and helpers)
  - `components/chat/*` (ChatMessage rendering for steps area + collapse)
- Back-end:
  - `app/api/chat-events/route.ts` (stream markers + segments)
  - `app/api/chat-responses/route.ts` (same for Responses API flows)
  - `lib/streaming/eventBuilder.ts` (ensure unified segment emission order)

This plan keeps storage unchanged, improves streaming UX, and remains backward compatible if new markers are not yet emitted.
