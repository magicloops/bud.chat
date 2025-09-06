# Frontend Rendering Pipeline — Overview, Findings, and Hypotheses

This document summarizes the current streaming/rendering pipeline, component hierarchy, where reasoning/tool/text segments flow, and hypotheses for why the first reasoning segment’s text is not visible despite builder updates.

## Pipeline Overview

- Network SSE
  - `/api/chat` streams unified events (SSE):
    - `event_start`, `segment`, `event_complete`, `message_final`, `complete`, plus transport‑level items (`reasoning_*`, `mcp_tool_*`, `progress_*`).
  - We recently added a bridge that also emits reasoning as unified `segment` updates so the frontend can consume them uniformly.

- FrontendEventHandler (lib/streaming/frontendEventHandler.ts)
  - Parses SSE lines and dispatches to handlers.
  - For `event_start`: creates/renames assistant placeholder and instantiates EventBuilder.
  - For `segment`:
    - `text`: appended via EventBuilder.appendTextDelta (indirectly by StreamingFormat consumer)
    - `tool_call/result`: builder.startToolCall/finalize/complete
    - `reasoning`: builder.upsertReasoningPart (appends text; creates on demand)
  - Also listens to reasoning_* events for provider‑specific paths, but the unified `segment` path is preferred now.
  - Maintains progress in draft (no store churn during streaming).
  - On `message_final`: copies ephemeral timings from draft to final event; finalizes.

- Draft Registry (lib/streaming/eventBuilderRegistry.ts)
  - Holds Event drafts keyed by assistant event id so renderers can consume draft while streaming.

- EventList → EventItemSequential → SequentialSegmentRenderer
  - EventItemSequential decides if the event is actively streaming (`conversation.streamingEventId === event.id`). If yes, it provides the draft (`getDraft(event.id)`) to the renderer; otherwise uses the store event.
  - SequentialSegmentRenderer:
    - Normalizes segments via `getRenderableSegments(event, allEvents)`
    - Derives ephemeral steps via `deriveSteps(event)` to decide which non‑text step to render live during streaming.
    - Renders:
      - Streaming: only the current non‑text step + text segments in order
      - Post‑stream: either collapse multiple steps into a summary or render single/zero step inline
  - StreamingReasoningSegment reads the draft and displays latest part text; shows a “Thinking…” placeholder if no text yet.

## Findings (current behavior)

- Server emits abundant reasoning deltas (verified via [Chat API][reasoning_text_delta] logs).
- Frontend occasionally shows no `sse_in_reasoning_segment` (unified segment path), but we do see `reasoning_update_from_segment` (builder state changed) — which means either:
  - The unified segment arrived but got filtered/missed by frontend logging in that session, or
  - The unified segment was not emitted for that turn; builder updated due to provider‑specific path (e.g., reasoning_summary_* handlers), which we recently wired to seed parts even when empty.
- For the first reasoning segment, we see builder parts’ length grow (e.g., len: 434), but the renderer does not show the overlay. The second reasoning (post‑tool) does show.

## Hypotheses

1) Active step selection misses first reasoning
- Condition: `deriveSteps(event)` yields `currentStepIndex === null` during the first reasoning window.
- Effect: SequentialSegmentRenderer hides reasoning (it only renders current step).
- We added a fallback (prefer first reasoning step with started_at and no completed_at). Validate with logs.

2) Draft vs store mismatch for the streaming event id
- Condition: SequentialSegmentRenderer receives the store snapshot (no draft) for the active streaming event.
- Effect: Reasoning overlay doesn’t mount because store event lacks streaming parts.
- Validate: Log `event.id`, `conversation.streamingEventId`, and whether `getDraft(event.id)` exists.

3) Render gating hides reasoning while tool starts
- Condition: Tool step starts quickly after reasoning; ephemeral design switches to tool overlay immediately.
- Effect: User perceives “first reasoning doesn’t show” if the switch is too fast.
- Validate: Add a short grace window (optional) to keep reasoning visible for a minimum time (e.g., 300ms) before switching to tool.

4) Unified segment update not emitted for first reasoning in some turns
- Condition: Our bridge didn’t run (code path ordering or missing data) for that first turn.
- Effect: Frontend only updated via provider‑specific path; overlay may still mount late.
- Validate: Server logs show `[Chat API][reasoning_text_delta]`. Also confirm `streamingFormat.segmentUpdate(reasoning)` is called at those moments.

5) StreamingReasoningSegment overlay conditions still too strict
- Condition: Overlay hides when parts exist but the component memo state lags behind.
- Effect: Small timing windows where overlay doesn’t repaint.
- Validate: Instrument StreamingReasoningSegment with part count and text length on each interval tick and compare with `reasoning_update_from_segment` timestamps.

## Instrumentation Plan

- FrontendEventHandler
  - Confirm draft existence and active id on event_start:
    - Log `conv.streamingEventId`, `serverId`, `placeholderId`, presence of draft.
  - Log unified “segment” reasoning arrivals explicitly (already added): `sse_in_reasoning_segment`.
  - After builder.upsertReasoningPart (in both segment and reasoning_* handlers):
    - Log parts summary with text length, and timestamp delta between logs (to detect batch vs lag).

- Renderer (EventItemSequential / SequentialSegmentRenderer)
  - Before rendering streaming event: log
    - `event.id`, `conversation.streamingEventId`, `isStreamingActive` boolean
    - Whether `displayEvent` was draft or store
    - `deriveSteps(event).currentStepIndex`, steps types and started_at/completed_at
  - In StreamingReasoningSegment: each tick, log `parts.length` and latest text length delta.

- Server
  - Already logging `[Chat API][reasoning_text_delta]`. Also log when the unified segment bridge fires to emit `segmentUpdate(reasoning)`. Confirm one-to-one with deltas.

## Likely Minimal Fixes (after validation)

- If current step selection is still null during first reasoning:
  - Keep the fallback; if still null, force `currentStepIndex = indexOf(first reasoning with parts length > 0)`.

- If renderer uses store instead of draft for streaming event:
  - Ensure EventItemSequential computes `isStreamingActive` correctly and calls `getDraft(event.id)`. Inline log shows which path is used.

- If unified segment bridge is not firing for first reasoning:
  - Adjust server bridge placement to run before any early returns and emit for every delta.

- Optional grace window to keep first reasoning visible before switching to tool to improve perceived streaming.

---

Once we capture logs with the above plan for a single turn (no tools, then with tools), we can implement the smallest targeted fix.
