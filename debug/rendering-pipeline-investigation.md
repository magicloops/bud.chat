# Rendering Pipeline Investigation — Reasoning Not Visible, Role Flip, Text OK, Tools OK

## Symptom Recap
- During streaming (Responses API in particular):
  - Reasoning events are logged but the first reasoning segment does not render; sometimes a second reasoning segment appears.
  - Tool use streams and mostly works.
  - Assistant text streams correctly.
  - After text finishes, the event flips to a user event in the UI (post‑finalize), until refresh.

## Current Rendering Pipeline (Frontend)
1) SSE → FrontendEventHandler.handleStreamEvent
   - Receives: `event_start`, `token`, `segment`, `reasoning_*`, `mcp_tool_*`, `message_final`, `complete`, etc.
2) FrontendEventHandler → EventBuilder (draft)
   - `event_start` → create/rename current assistant draft and create builder
   - `token` → builder.appendTextDelta
   - `reasoning_start/part_added/delta/part_done/complete` → builder.upsertReasoningPart (append), mark complete
   - `mcp_tool_*` → builder.startToolCall/finalizeToolArgs/completeTool
   - `event_complete` → flush + commit draft to store (inter‑turn)
   - `message_final` → finalize canonical event (store), end streaming
   - Progress → stored on draft (for indicator)
3) EventList → EventItemSequential (per event)
   - For active streaming assistant event, it uses `getDraft(event.id)` as the event source; otherwise uses store event.
4) EventItemSequential → SequentialSegmentRenderer
   - Input: the (possibly draft) event + allEvents, and `isStreaming` boolean
   - Calls `getRenderableSegments(event, allEvents)` to normalize:
     - Preserves order
     - Resolves tool_result under tool_call (inline or from other events)
     - Removes standalone tool_result from rendering
   - Renders by type: Reasoning (overlay), Tools, Text

## Hypotheses
1) Draft not used by renderer for the streaming event
- Cause: `isStreamingActive`/`streamingEventId` mismatch, so `getDraft(event.id)` is not used.
- Expected: EventItemSequential should pass the draft (not the store snapshot) to renderer for the current streaming assistant event.
- Debug: Verify the eventId used in renderer matches builder’s draft id after `event_start`/rename.

2) Reasoning overlay hidden due to part selection
- Cause: Reasoning parts are marked done quickly (no deltas), and `StreamingReasoningSegment` hides if there’s no active (incomplete) part.
- Expected: Container should still render during streaming even without deltas.
- Debug: Log parts length, `is_complete`, and visibility decision.

3) Reasoning segment not present in draft at render time
- Cause: Builder not seeded on `reasoning_start` early enough, or draft not returned by registry yet.
- Expected: After `reasoning_start`, `getDraft(eventId)` should contain a reasoning segment with at least one part.
- Debug: Log draft.segment types immediately after `reasoning_start` and before renderer map.

4) Role flip at finalize
- Cause A: Server sends `message_final` with wrong role.
- Cause B: Store replacement path overwrites role from a stale event or wrong merge order.
- Expected: Final role must remain `assistant`.
- Debug: Log `message_final.event.role` when received, and the role used in store set.

5) Interleaving text/tools reorders segments unexpectedly
- Cause: Client-side sorting or fallback ordering was reordering segments.
- Expected: Preserve original order; builder appends in place only.
- Debug: Log segment type order at key transitions: after `event_start`, after first reasoning event, after first tool call, after text tokens.

## Minimal Targeted Debug Logs
Enable with `NEXT_PUBLIC_STREAM_DEBUG=true`.

A) Handler (FrontendEventHandler)
- On `event_start`:
  - Log `{ where: 'event_start', serverId, placeholderId, draftExists: !!getDraft(serverId) }`
- On `reasoning_start`:
  - After seeding, log `{ where: 'reasoning_start', eventId, segTypes: draft.segments.map(s=>s.type), partsCount: reasoning.parts.length }`
- On `reasoning_summary_part_added` / `reasoning_complete`:
  - Log `{ where: 'reasoning_update', eventId, parts: reasoning.parts.map(({summary_index,is_complete,text})=>({summary_index,is_complete,len:text.length})) }`
- On `token` (first token only per event):
  - Log `{ where: 'first_token', eventId }` once
- On `message_final`:
  - Log `{ where: 'message_final', id, role, segTypes: event.segments.map(s=>s.type) }`
- On store commit (inside onMessageFinal callback):
  - Log `{ where: 'store_commit', id, role, eventsCount }`

B) Renderer (SequentialSegmentRenderer)
- When receiving `event` prop:
  - Log `{ where: 'renderer_in', eventId: event.id, isStreaming, segTypes: event.segments.map(s=>s.type) }`
- Right before render map (after `getRenderableSegments`):
  - Log `{ where: 'render_segments', eventId: event.id, segTypes: renderSegments.map(s=>s.type) }`
- Reasoning overlay decision (in StreamingReasoningSegment):
  - Log `{ where: 'reasoning_overlay', eventId, hasAnyPart, activePartExists: !!activePart }`

C) Draft registry (optional)
- When `renameDraft(oldId,newId)` runs, log old/new id.
- On `setDraft(eventId, draft)`, log segment count and types occasionally (throttle).

## What We’ll Confirm with Logs
- That the draft the renderer sees contains a reasoning segment after `reasoning_start`.
- That the renderer is using draft (not stale store) for the streaming event id.
- That `message_final` arrives with role `assistant`, and the final store commit preserves that role.
- That segment order is preserved end‑to‑end across builder → renderer.

## Narrow Fixes Likely Needed (after verification)
- If reasoning segment exists in draft but overlay still hides:
  - Keep overlay visible when any `reasoning` segment exists during streaming (regardless of `activePart`).
- If renderer sees store event instead of draft:
  - Fix `isStreamingActive` computation or `streamingEventId` propagation.
- If role flips on finalize despite assistant in `message_final`:
  - Audit any other code writing to the event list after finalize; ensure our guarded `assistant` replacement wins last.

---

Use these logs to capture one full streaming turn (Responses API), then we’ll implement the smallest fixes exactly where the mismatch is observed.
