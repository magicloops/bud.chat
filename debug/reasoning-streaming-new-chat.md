# Debug: Reasoning Streaming Broken on /chat/new

Status: Investigating + applied targeted fixes

## Symptom
- Reasoning streaming works for existing conversations (/chat/[id]) but not for new chats (/chat/new).
- Observed behavior on /chat/new: reasoning overlay does not appear or shows empty while the model streams text; steps only become visible after finalization.

## Repro Steps
1) Navigate to `/chat/new?bud=<some-bud-id>`.
2) Send a prompt that triggers reasoning steps (model with reasoning summary support enabled).
3) Observe: Live reasoning overlay either doesn’t show or shows empty until text begins, whereas on existing chats it streams per-part correctly.

## Flow Comparison (New vs Existing)
- Existing (/chat/[id]):
  - The store adds a user event + assistant placeholder immediately.
  - `streamingSessionManager.start()` is called with the assistant placeholder id before any stream events arrive.
  - `FrontendEventHandler` routes reasoning events into the per‑part overlay buffers.

- New (/chat/new):
  - Local component state (useEventChat) builds events optimistically.
  - Previously, `streamingSessionManager.start()` was called before the assistant placeholder was created, so there was no valid `assistantEventId` for overlay buffers.
  - `StreamingSessionManager.apply()` appended reasoning to a combined buffer, while our overlay reads per‑part buffers.

## Hypotheses
1) Placeholder timing bug (HIGH confidence)
   - In `hooks/useEventChat.ts`, we called `streamingSessionManager.start()` before creating the assistant placeholder. This meant the session had no `assistantEventId`, so overlay updates could not be keyed correctly.

2) Per‑part overlay vs combined buffer mismatch (HIGH confidence)
   - The overlay now reads per‑part buffers (`streamingBus.getReasoningParts(eventId)`), but `StreamingSessionManager.apply()` still appended to the old combined reasoning buffer. On `/chat/new` we rely on `apply()` directly, so no per‑part data made it to the overlay.

3) Early overlay render with no content (MEDIUM)
   - If we render the overlay when no active part text exists yet (e.g., between part_added and first delta), it can appear empty. We adjusted the overlay to only render when the active part has content, and StepsPanel hides the overlay once text starts and shows the collapsible instead.

4) Backend events parity (LOW)
   - The unified backend already emits `reasoning_summary_*` and `message_final` for both new and existing flows. Not likely to differ by mode.

## Changes Applied
- Fix 1: Create assistant placeholder before starting streaming session
  - File: `hooks/useEventChat.ts`
  - Moved creation of `assistantEvent` and `streamingEventId` before calling `streamingSessionManager.start()`.

- Fix 2: Route reasoning events to per‑part buffers in session manager
  - File: `lib/streaming/StreamingSessionManager.ts`
  - Updated `apply()` logic:
    - `reasoning_summary_part_added` → `startReasoningPart(...)` (+ append initial text if provided)
    - `reasoning_summary_text_delta`/`reasoning_summary_delta` → `appendReasoningPart(...)`
    - `reasoning_summary_part_done` → `completeReasoningPart(...)`
  - This mirrors what `FrontendEventHandler` already did, so both flows behave the same.

- UX polish (previously landed, relevant):
  - `StreamingReasoningSegment` only renders the active in‑progress part, and only when it has content.
  - `StepsPanel` hides the reasoning overlay once text starts streaming, and shows the collapsible “Show Reasoning” summary instead.

## Remaining Risks / Considerations
- Double buffering in `/chat/new` hook: we still call `streamingBus.appendReasoning(...)` for legacy combined text in `reasoning_summary_*` cases. This is now unused by the UI but harmless; we can remove for cleanliness.
- Ensure backend consistently emits `reasoning_summary_part_*` for all providers. We’ve aligned our OpenAI Responses mapping and segment fallback in `app/api/chat/route.ts`.
- Verify that `message_final` always fires and that the client replaces overlays with the final event, including reasoning parts and text.

## Verification Plan
1) `/chat/new`:
   - Trigger a model with reasoning summary.
   - Expect: live overlay shows a single active reasoning part; header shows “thinking…”.
   - When text begins: overlay hides; “Show Reasoning” appears (collapsed). Header shows “typing…”.
   - After finalize: overlay fully gone; opening “Show Reasoning” shows all parts with increased spacing.

2) `/chat/[id]` (existing):
   - Repeat; behavior should match the new chat flow.

3) Tools involved:
   - While tool is in progress, header shows “using tools…”. Reasoning overlay rules unchanged.

## Potential Future Cleanups
- Remove legacy combined reasoning buffer writes in `/chat/new` hook.
- Consolidate the new and existing conversation streaming to always use `FrontendEventHandler` for consistency.
- Add a lightweight diagnostic log or dev-only overlay to show `assistantEventId` and stream status on `/chat/new` for faster debugging.

---

## New Observations + Hypotheses (post-fix)

- Works after refresh: Persisted event includes reasoning; UI shows summary correctly after reload. So backend payload and persistence look good. The issue is purely the live streaming view on `/chat/new`.

H5) Text tokens arrive before reasoning parts (HIGH)
- Our current StepsPanel logic hides the reasoning overlay as soon as any text token arrives (`textStarted = true`) and shows the collapsible summary instead. However, during `/chat/new`, we do not mutate store mid-stream, so the collapsible (persisted segments) will be empty until `message_final` arrives. Net effect: no reasoning visible during live stream if text leads reasoning.
- Why it differs from `/chat/[id]`: Existing chat may receive reasoning part events before the first text token more often (provider timing), or the visibility is masked by slower text start.

H6) Session/ID mismatch in `/chat/new` rendering path (MEDIUM)
- `EventItemSequential` decides streaming state using `streamingSessionManager.getState().assistantEventId === event.id`. If `/chat/new` creates the assistant placeholder, then reorders or re-renders the list quickly, there could be a brief mismatch leading to the overlay not mounting early enough.

H7) Overlay gating too strict (MEDIUM)
- StreamingReasoningSegment only renders when an active part has content; if a provider sends `reasoning_summary_part_added` without initial text and the text delta lags, the overlay could flicker or never appear—especially if text tokens start and our StepsPanel immediately hides the overlay.

H8) Different handler paths (MEDIUM)
- `/chat/new` uses the inline fetch/reader loop and `streamingSessionManager.apply`, while `/chat/[id]` can also use `FrontendEventHandler`. Even though we aligned `apply()` for per-part buffers, subtle differences (e.g., missing event types, ordering) could affect mount timing.

## Proposed Diagnostic Logging (review before code changes)

Objective: Confirm ordering and visibility decisions in real time without changing behavior.

Add dev-only logs (guarded by `process.env.NODE_ENV !== 'production'`) at these points:

1) hooks/useEventChat.ts
- After creating `assistantEvent`: log event id and timestamp: `console.log('[NEWCHAT] assistant placeholder', assistantEvent.id)`.
- After calling `streamingSessionManager.start`: log session state and ids.
- Inside the read loop for events of interest:
  - `token` → log first arrival time and a small snippet length: `console.log('[NEWCHAT] token Δ', data.content?.length)`.
  - `reasoning_summary_part_added` → log `{ item_id, summary_index }`.
  - `reasoning_summary_text_delta`/`reasoning_summary_delta` → log `{ summary_index, len: text.length }`.
  - `reasoning_summary_part_done` → log `{ summary_index }`.
  - `message_final` → log when received.

2) lib/streaming/StreamingSessionManager.ts
- In `apply()` per-part handlers, log which event id and part index are updated and current part text length: `console.log('[SESSION] start/append/complete', { eventId, summaryIndex, len })`.

3) components/EventList/EventItemSequential.tsx
- When computing header status, log transitions: `thinking → using-tools → typing` with the event id: `console.log('[UI][header]', event.id, '→', headerStatus)`.
- Log `isStreamingActive` mount for each assistant event row.

4) components/EventList/StepsPanel.tsx
- Log `textStarted` transitions and the count of active reasoning parts from `streamingBus.getReasoningParts(event.id)`: `console.log('[UI][StepsPanel]', { textStarted, parts: parts.length })`.

5) components/EventList/StreamingReasoningSegment.tsx
- Log when it renders and which `activePart.summary_index` is shown and the text length: `console.log('[UI][ReasoningOverlay]', { activeSummaryIndex, len })`.

6) app/api/chat/route.ts (optional if needed)
- Log when emitting reasoning events on the server for `/chat/new`: `{ type, item_id, summary_index }` to ensure the sequence is present.

## Expected Debug Signals
- If H5 is correct: We will see `token` arrive before any `reasoning_summary_*` logs, and StepsPanel will flip `textStarted` before overlay ever gets content.
- If H6 is at play: We may see the overlay logs target a different `event.id` than the row currently mounted as the streaming placeholder.
- If H7 is true: We will see `reasoning_summary_part_added` with no initial text, followed by a long delay before `reasoning_summary_text_delta`—and likely `textStarted: true` flips in between.
- If H8: The event mix in `/chat/new` differs (missing `reasoning_summary_*` until after tokens) whereas `/chat/[id]` sees them earlier.

## Potential Fix Directions (pending your review)
- F1: Overlay persistence rule — keep reasoning overlay visible until all in‑progress parts complete, even if text has started. This preserves visibility if tokens lead reasoning.
- F2: Grace period — delay hiding the overlay for N ms after first text token to allow initial reasoning parts to surface.
- F3: Dual render (minimal) — allow overlay + text concurrently until `reasoning_complete`, then collapse to the summary.
- F4: Ensure uniform handler path — use `FrontendEventHandler` in `/chat/new` as well, to reduce divergence.

Once you approve a direction, I’ll instrument the logs and/or implement the selected fix.
