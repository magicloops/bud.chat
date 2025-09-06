# Remote MCP Pre‑Text Reasoning Rendering — Debug Hypotheses

Context
- During remote MCP/Responses streaming (multiple segments in one assistant event), we still see the full Reasoning segment UI appearing during streaming, even though the intended behavior is: overlay only before the first text token.
- Symptoms reported:
  - Full reasoning part(s) render inline during streaming (pre‑text), not just the ephemeral overlay.
  - Sometimes a duplicate reasoning item appears, showing all steps at once.

Relevant Code Paths (read)
- Renderer
  - components/EventList/SequentialSegmentRenderer.tsx (streaming branch rendering order; pre/post text filtering)
  - components/EventList/ReasoningSegment.tsx (post‑stream reasoning rendering)
  - components/EventList/StreamingReasoningSegment.tsx (streaming reasoning renderer)
- Overlay
  - components/EventList/EphemeralOverlay.tsx (overlay visuals)
  - lib/streaming/ephemeralOverlayRegistry.ts (overlay state)
  - components/EventList/EventItemSequential.tsx (decides whether to mount overlay; computes hasStreamingText)
- Streaming pipeline
  - lib/streaming/frontendEventHandler.ts (overlay gating, textStartedForCurrentEvent, reasoning/tool events)
- Legacy
  - components/EventList/EventItem.tsx (legacy renderer; verified reasoning block is behind a dead `false &&`)
  - No StepsOverlay file exists; legacy references are not active in the sequential path

Hypotheses
1) Empty text segment sets the “post‑text” boundary too early — VOID
- What: `SequentialSegmentRenderer` uses `firstTextIndex = renderSegments.findIndex(s => s.type === 'text')` without checking for non‑empty text. The EventBuilder often creates an initial empty text segment. This causes:
  - firstTextIndex >= 0 even when no content has streamed
  - The streaming branch then renders any non‑text with index > firstTextIndex, including reasoning segments that should be treated as pre‑text.
- Evidence: EventItemSequential computes `hasStreamingText` by checking non‑empty text (correct), but SequentialSegmentRenderer does not. User reports reasoning rendered pre‑text aligns with an empty text seg.
- Test:
  - Add STREAM_DEBUG logs in SequentialSegmentRenderer:
    - Dump `renderSegments` (types and a small text length summary) and computed `firstTextIndex`.
    - Confirm `firstTextIndex === 0` while the first text segment has length 0.
  - Disable rendering when text is empty: condition on `(segment.type==='text' && text.trim().length>0)` and recompute post‑text boundary accordingly.
 - Result: No targeted pre‑text reasoning render logs observed; issue persists but appears as reasoning rendering AFTER text. Therefore, pre‑text boundary error is unlikely the root cause here.

2) Reasoning should never render inline during streaming (even post‑text)
- What: Our latest spec allowed rendering “any subsequent non‑text segments” after text begins. That may be too permissive for reasoning — we likely want tools/built‑ins post‑text, but not reasoning (to avoid long, distracting dumps during streaming).
- Evidence: Report indicates a long reasoning component shows up after text. This matches a post‑text reasoning render (not pre‑text), which aligns with our current code path that renders `StreamingReasoningSegment` during streaming regardless of pre/post.
- Test:
  - Add a short-lived guard to never render reasoning during streaming in `SequentialSegmentRenderer` (return null for case 'reasoning' when isStreaming), while keeping tools/built‑ins post‑text.
  - Verify overlay shows pre‑text reasoning and no inline reasoning appears after text.

3) Duplicate/expanded reasoning caused by both streaming reasoning and post‑stream ReasoningSegment mounting
- What: The streaming component (`StreamingReasoningSegment`) and the finalized renderer (`ReasoningSegment`) might both be mounting due to a draft/store transition edge, causing duplication.
- Evidence: User saw “an additional reasoning item rendered with all steps shown.” This suggests both the streaming and post‑stream component briefly rendered together.
- Test:
  - Instrument a one-off log on `ReasoningSegment` mount during streaming to confirm it never mounts while `isStreaming` is true.
  - Ensure `ReasoningSegment` is only used in the non-streaming branch.

4) Draft vs store mismatch (still relevant)
- What: If `EventItemSequential` passes the store event at some point (e.g., draft cleared on event_complete), the renderer may switch component types mid-streaming.
- Test:
  - Log when `message_final` arrives and confirm streaming flag switches and overlay clears as expected.
  - Ensure `SequentialSegmentRenderer`'s streaming branch is only used while the conversation is marked streaming for this event id.

3) Draft vs store event mismatch during streaming
- What: EventItemSequential intends to pass the draft event (`getDraft(event.id)`) while streaming. If a stale store snapshot (with pre‑seeded text seg) is used, `firstTextIndex` may be computed from the store (including empty text), while overlay gating uses the live draft.
- Evidence: Design docs mention cases where draft isn’t used consistently.
- Test:
  - Log in EventItemSequential which event (draft vs store) is passed down for the streaming event.
  - Log the types/lengths of segments on the object being rendered.

4) Reasoning overlay updates re‑introduce a reasoning segment into the draft (timing/order race)
- What: Handler’s reasoning_* events upsert reasoning parts into the builder draft. If the draft is used and renderer’s streaming branch incorrectly considers it post‑text (via (1)), it will render the reasoning segment.
- Evidence: Our builder intentionally adds reasoning segments early (by design), but renderer must keep them hidden pre‑text.
- Test:
  - Confirm (1); if fixed, the presence of pre‑text reasoning in the draft will no longer trigger rendering since boundary is content‑based.

5) Legacy EventItem path accidentally used in some views/routes
- What: Another page might still render `components/EventList/EventItem.tsx` (legacy) which includes different streaming behavior.
- Evidence: We found EventList/index.tsx imports the sequential item. However, other pages (e.g., older routes) might differ.
- Test:
  - Grep app routes for EventList usage; confirm they all import EventItemSequential.
  - Temporarily log an identifier in both EventItem and EventItemSequential to see which component mounts during the repro.

6) Duplicate reasoning caused by both overlay and in‑event renderer competing
- What: If the overlay shows reasoning text and the streaming renderer also renders reasoning parts (due to (1)/(2)), it manifests as duplicated reasoning.
- Test:
  - Fix (1); add suppression guards to ensure streaming renderer never calls `renderSegment('reasoning')` pre‑text.
  - Confirm overlay remains sole reasoning presenter until first token.

Proposed Test Plan (no code changes yet)
- Instrument (behind STREAM_DEBUG):
  - Add a temporary guard to never render reasoning during streaming; verify the symptom disappears.
  - If fixed, conclude that reasoning should be fully suppressed during streaming (pre and post text), with overlay as the only pre‑text display.
  - If not fixed, add precise logs at the draft→store transition and `message_final` handling.
- Reproduce with remote MCP pre‑text steps:
  - Verify firstTextIndex is -1 while no text content, or switch to content‑based index.
  - Verify no reasoning render calls occur pre‑text; overlay must be visible until first text.

Likely Fix (once confirmed)
- Suppress inline reasoning entirely during streaming (both pre and post text). Use overlay pre‑text only; do not show reasoning inline until finalized.
- Continue rendering tools/built‑ins inline post‑text as before; keep pre‑text steps hidden under overlay.

Notes
- This aligns renderer behavior with overlay gating semantics already in place.
- It preserves local MCP compatibility because multi‑turn tool results remain separate events and the streaming renderer logic only affects same‑event segments.
