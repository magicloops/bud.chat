# Reasoning Streaming UX (v2) — Spec

## Summary

Define a clear, low‑lag streaming experience for “reasoning steps” and tool activity that:

- Streams non‑text segments (reasoning parts, tool calls/results, built‑in tools) as a temporary overlay during generation.
- Hides the collapsible “Show Reasoning” component while streaming; it appears only after streaming ends (or on page load with persisted events).
- Avoids mid‑stream store writes; a single canonical `message_final` event commits the final event with all segments.
- Unifies rendering so streamed and persisted messages look identical post‑stream.

This spec focuses on the two reasoning components, streaming event shapes, UI rules, and integration points for front‑end and back‑end.

## Goals

- Clean separation of live streaming vs. persisted view.
- Show live reasoning parts as they arrive, in sequence, without mutating the store.
- Expose a concise “Show Reasoning” collapsible that only renders post‑stream (or on SSR/refresh) and defaults to closed.
- Support streaming of tools/built‑ins alongside reasoning parts in the same overlay.
- Retain a single back‑end endpoint (`/api/chat`) and finalize with `message_final` containing the canonical event.

## Non‑Goals

- Persisting intermediate reasoning/tool fragments in the DB.
- Rendering live overlays after a page refresh without an active stream session.
- Reintroducing legacy endpoints like `/api/chat-events`.

## UX Behavior

State split:

1) Streaming (live generation):
   - Display a temporary overlay that streams each non‑text segment in real time:
     - Reasoning parts (chunked by part/summary_index)
     - Tool calls and statuses (built‑in and user tools)
   - Do not render the “Show Reasoning” collapsible (to prevent duplicate or shifting UI). 
   - Token streaming for the assistant text appears below the overlay once text begins.

2) Post‑stream (finalized):
   - Hide the streaming overlay.
   - Render the final assistant event from store.
   - Show the “Show Reasoning” collapsible component, default collapsed, revealing the full reasoning parts when opened.

Fresh page render (no active stream):
- Render only the persisted event view.
- If the event contains a reasoning segment, show the “Show Reasoning” collapsible (closed by default).

Interaction details:
- While streaming: users cannot toggle a collapsed/expanded reasoning panel; they only see the live overlay.
- After streaming: users toggle “Show Reasoning” to inspect the final, ordered parts. The collapse/expand state is per‑event, local UI state.

Spacing/visual:
- Overlay renders above assistant text to avoid layout jumps.
- Once finalized, the persisted segments take the same space (no outer step count row). “Show Reasoning” sits closest to content.

## Components

- Streaming overlay layer:
  - `StreamingReasoningOverlay` (temporary): shows incremental reasoning parts in order, with per‑part spinners until completed.
  - `StreamingToolsOverlay` (existing): shows active tool calls, progress, and results as they stream.
  - Displayed only when an assistant message is the active streaming placeholder.

- Persisted view layer:
  - `ReasoningSegment` (collapsible): rendered only post‑stream or on SSR. Shows all reasoning parts with stable ordering and optional metadata (effort level, token counts).
  - `ToolCallSegment` / `BuiltInToolSegment`: the persisted non‑text segments rendered inline in order above text content.

- Container/orchestration:
  - `StepsPanel`: decides which layer to render based on streaming state. During streaming, renders only overlays; after finalization, renders persisted non‑text segments (including `ReasoningSegment`).

## Event Model (Back‑end Streaming Contract)

Transport: SSE or fetch with text/event-stream semantics from `/api/chat`.

Canonical finalization:
- `message_final`: always sent after we save the assistant event; includes the complete event JSON (segments fully populated). The UI commits this to the store and hides overlays.

Reasoning part streaming (live overlay only):

- `reasoning_part_started`
  - fields:
    - `event_id` (assistant event placeholder id)
    - `segment_id` (stable id for the final reasoning segment)
    - `summary_index` (0‑based index of the part)
    - `sequence_number` (relative order between non‑text segments)
    - `created_at` (ms)

- `reasoning_part_delta`
  - fields:
    - `event_id`, `segment_id`, `summary_index`
    - `text_delta` (string)

- `reasoning_part_completed`
  - fields:
    - `event_id`, `segment_id`, `summary_index`
    - `is_complete: true`
    - optional: `final_text` (for integrity)

Optional segment‑wide:
- `reasoning_segment_meta` (optional, anytime before final)
  - `event_id`, `segment_id`
  - `effort_level`, `reasoning_tokens`, etc.

Text streaming:
- `text_delta` as usual, associated with `event_id` (and `output_index` if multi‑output models).

Tool streaming:
- `tool_call_started` { event_id, call_id, name, args_preview, sequence_number, created_at }
- `tool_call_update` { event_id, call_id, status, progress, logs_delta? }
- `tool_result` { event_id, call_id, result, error? }
- Built‑ins mirror the same pattern with `web_search_call_*`, `code_interpreter_call_*` typed events.

Error/cancelation:
- `message_error` { event_id, message }
- `message_cancelled` { event_id }

Final commit:
- `message_final` { event: <canonical assistant event object> }

Final event example (persisted):
```json
[
  {
    "id": "rs_68ae526f16dc81909d710ce7d1fc1ea4",
    "type": "reasoning",
    "parts": [
      {
        "text": "**Providing historical facts**\n\nI'm noting that the 18th President ...",
        "type": "summary_text",
        "created_at": 1756254831851,
        "is_complete": true,
        "summary_index": 0,
        "sequence_number": 3
      }
    ],
    "streaming": false,
    "output_index": 0,
    "combined_text": "**Providing historical facts**\n\nI'm noting ...",
    "sequence_number": 2
  },
  {
    "id": "msg_68ae52729cdc8190b7acba8cbb3d42ec",
    "text": "Ulysses S. Grant, serving from 1869 to 1877.",
    "type": "text"
  }
]
```

Notes:
- `segment_id` is stable across stream and finalization.
- `summary_index` ties streaming parts to final `parts[]` entries.
- `sequence_number` orders non‑text segments relative to each other.

## Front‑end Architecture

Streaming boundary:
- `StreamingSessionManager` tracks the active assistant `event_id` and whether streaming is ongoing.
- `streamingBus` holds ephemeral buffers for:
  - reasoning per `(event_id, segment_id, summary_index)`
  - tool overlays per `call_id`
  - text deltas per `event_id`
  - pub/sub signals for components to re-render efficiently.

Rendering logic (`EventItemSequential` + `StepsPanel`):
- If current assistant event is streaming:
  - Render `StreamingReasoningOverlay` and `StreamingToolsOverlay` above the text stream.
  - Do not render `ReasoningSegment` collapsible.
- On `message_final`:
  - Commit event to store, clear overlay buffers for that `event_id`.
  - Replace overlay with persisted segments.
  - Show `ReasoningSegment` (collapsed by default).

Reasoning components:
- `StreamingReasoningOverlay`
  - Subscribes to `streamingBus` reasoning updates.
  - Renders each in‑flight part in order of `summary_index`; shows spinner until `reasoning_part_completed`.
  - No user controls; ephemeral only.
- `ReasoningSegment` (collapsible)
  - Renders only with finalized event.
  - Displays all parts, ordered by `summary_index`. Defaults closed; “Show Reasoning” toggle always present.

Store policy:
- No mid‑stream writes for reasoning/tool segments.
- Only `message_final` updates the store with the complete event.

## Event Flow (Sequence)

1) Client sends prompt to `/api/chat`; UI creates assistant placeholder and starts session.
2) Server streams:
   - zero or more `reasoning_part_started`/`reasoning_part_delta`/`reasoning_part_completed`
   - zero or more tool events
   - zero or more `text_delta`
3) Client renders overlays (reasoning, tools) + streaming text below.
4) Server persists final assistant event and emits `message_final` with canonical event.
5) Client replaces overlays with persisted segments; shows “Show Reasoning” toggle (collapsed).

## Back‑end Implementation Notes

- Ensure `segment_id` for reasoning is known up‑front (or deterministically assigned) so the stream correlates with the final event.
- Guarantee `message_final` is always emitted—even on short‑circuit completions (no reasoning).
- Preserve `summary_index` order; ensure deduplication on reconnect if needed.
- If the provider only emits a single block of reasoning, map it to part `summary_index: 0`.

## Edge Cases

- No reasoning present: do not render “Show Reasoning”.
- Multiple reasoning parts: overlay must stream parts independently and in order.
- Multiple non‑text segments: `sequence_number` dictates ordering in both overlay and final.
- Cancellation/error: hide overlay and show error state; no collapsible reasoning unless `message_final` contains it.
- Refresh during stream: treated as non‑streaming view (no overlay) unless we add reconnect protocol (out of scope for v2).

## Acceptance Criteria

- During streaming, users see live reasoning/tool overlays; “Show Reasoning” is hidden.
- After finalization, overlays disappear and the collapsible reasoning segment appears, default collapsed.
- No mid‑stream store mutations; only one commit with `message_final`.
- Final view matches overlay content semantically (no missing steps).

## Open Questions

- Do we want a dedicated `message_started` for analytics/timing?
- Should the overlay include a minimal header (icon + “Thinking…”), or be completely silent until first part arrives?
- Minimum granularity for `sequence_number` on interleaved reasoning/tool steps?

