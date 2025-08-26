# Streaming Freeze Investigation

## Symptom
- On /chat/new and occasionally /chat/[id], the UI freezes after the first tokens.
- Console shows slow, sparse token logs and text length barely grows.
- Full message appears only after refresh.

### Recent Repro Details
- Backend logs show request completes promptly and the SSE stream is closed.
- Front-end continues to log (about ~2/sec):
  - `[STREAM][fe] token { len: n, ts: ..., local: false }` (frontendEventHandler.ts ~ line 275–280)
  - `[STREAM][ui] first_text_tokens { eventId, len, ts }` (EventItemSequential.tsx ~ line 160–170)
- This implies a client-side loop continues after server close.

## Likely Root Causes (Front‑end)
- Infinite render loop / state churn:
  - Per-token setState causing Markdown re-render + auto-scroll cascade.
  - ResizeObserver + scroll handler feedback loop on each token.
  - Zustand updates on every delta (reasoning/tool) causing EventList to re-render.
- Event stream handling issues:
  - HMR breakage leading to stale closures and duplicate subscriptions.
  - Multiple streamingBus subscriptions for same event (no proper cleanup).
  - RequestAnimationFrame scheduling used incorrectly (never firing or starved).
  - Reader not cancelling properly; processStreamingResponse still dispatching events after completion.
  - Multiple FrontendEventHandler instances reading the same Response (dup handling) or a dangling handler from previous sends.
- Expensive work per delta:
  - Syntax-highlighted Markdown, layout thrash, reflow from conditional blocks.
  - Large console logging volume causing DevTools to stall.

## Hypotheses & How to Confirm
- H1: Token rendering loop
  - Add counters for StreamingTextSegment renders per second.
  - Temporarily render plain `<pre>` text instead of MarkdownRenderer.
  - Disable auto-scroll event (`streaming-content-updated`) to see if freeze stops.
- H2: Store churn from steps/reasoning
  - Log when updateStoreStateReasoning/tool is called; confirm only on completion.
  - Ensure local streaming mode (/chat/new) uses streamingBus only (no store writes).
- H3: Duplicate subscriptions / missing cleanups
  - Log subscription/unsubscription counts for streamingBus per eventId.
  - Add a unique instance id to EventItemSequential; log mount/unmount cycle.
- H3b: Duplicate/lingering FrontendEventHandler
  - Add an `instanceId` on handler construction; log lifecycle (constructor, process start, process end).
  - Ensure only one handler is active per send; cancel the previous handler on abort or completion.
- H4: SSE reader backlog
  - Log [STREAM][new][recv] timestamps per event type; ensure client receives promptly.
  - Compare with [STREAM][api] emit logs to rule out server buffering.
- H4b: Reader not closed/cancelled
  - In `processStreamingResponse`, log when `done===true` and after loop exits.
  - Ensure `reader.releaseLock()` and/or `reader.cancel()` is called in finally.
  - Add an AbortController path for explicit cancellation.
- H5: Rendering spikes from logs
  - Toggle NEXT_PUBLIC_STREAM_DEBUG and confirm lag disappears when off.

## Triage Steps
1) Disable heavy features and add back incrementally:
   - Replace MarkdownRenderer with plain text → if freeze disappears, focus on Markdown.
   - Disable Steps overlay/dropdown temporarily → see if rendering stabilizes.
   - Disable auto-scroll (ResizeObserver + custom events) → verify improvement.
2) Verify subscription lifecycles:
   - Confirm StreamingTextSegment unsubscribes on eventId change/unmount.
   - Ensure only one `streamingBus.subscribe(eventId, ...)` per active assistant event.
   - Confirm `streamingBus` isn’t appended to after completion (add a guard in `updateStoreStateToken`).
3) Validate store updates:
   - For /chat/new: no store writes on deltas (only at optimistic pair + completion merge).
   - For /chat/[id]: writes only at step completion; no per-delta writes.
4) Network sanity:
   - Check SSE chunk sizes and cadence in Network tab; confirm client receives steadily.
   - Confirm no additional hidden long-poll/keep-alive connection is open.

5) Handler lifecycle & guards:
   - Ensure `FrontendEventHandler.processStreamingResponse` resolves after completion.
   - Add internal `isActive` flag on handler; ignore late events when false.
   - Clear `assistantPlaceholder` on complete to prevent further bus appends.
   - Ensure one handler per send; cancel previous before starting new.

## Logging Plan
- Gate with `NEXT_PUBLIC_STREAM_DEBUG=true`:
  - [fe] token {len, ts, local}
  - [fe] reasoning_delta {idx, seq, len, ts, local}
  - [ui] first_text_tokens {eventId, len, ts}
  - [ui] overlay_show {eventId, hasReasoning, hasCode, hasWebSearch, hasMcp, ts}
  - [new][recv] {type, ts} for each SSE line
- Add counters (optional): renders per second for:
  - StreamingTextSegment
  - EventItemSequential
  - EventList container
  - FrontendEventHandler instance lifecycle (constructed/started/ended)

## Potential Fixes (after confirming)
- Throttle token rendering (optional):
  - Use RAF or 30–60fps throttle, but verify it doesn’t starve updates.
- Coalesce auto-scroll:
  - Only dispatch `streaming-content-updated` on visible growth or at a fixed cadence.
  - Guard ResizeObserver from recursive layout updates.
- Minimize Markdown work:
  - Render plain text while streaming; switch to Markdown after completion.
  - Or stream into a `<pre>` and re-render Markdown at chunk intervals.
- Subscription hygiene:
  - Ensure all bus subscriptions are cleaned up.
  - Avoid multiple instances of the same renderer for the active event.
  - Add `streamingBus` sanity: prevent appending after `complete` (guard by `isActive` flag in handler).
- Store writes:
  - Keep reasoning/tool per-delta writes disabled.
  - Persist only on completion; defer to idle callback if needed.

## Relevant Files & Focus Points
- lib/streaming/frontendEventHandler.ts
  - `processStreamingResponse` (reader loop; break on `done`; ensure release/cancel; add `isActive` guard)
  - `handleTokenEvent` (source of `[STREAM][fe] token` logs)
  - `updateStoreStateToken` (only appends to streamingBus; confirm not called after `complete`)
  - Completion handlers: ensure setting a `finished` state
- components/EventList/EventItemSequential.tsx
  - `useEffect` subscribing to `streamingBus` (source of `[STREAM][ui] first_text_tokens`)
  - Keep `sawReasoning` sticky; check we don’t resubscribe endlessly
- components/EventList/StreamingTextSegment.tsx
  - Subscription/unsub path; verify one active subscription per assistant event
- app/(chat)/chat/[conversationId]/page.tsx and components/EventStream.tsx
  - New chat SSE loop vs existing chat handler path; ensure only one stream reader per request
  - Confirm no duplicate handler per send; no retries spawning new handlers
- components/EventList/index.tsx (EventList)
  - ResizeObserver + custom `streaming-content-updated` handling; test disabling to rule out scroll loops

## Next Actions
- Reproduce freeze with logs OFF (to rule out log overhead), then ON.
- Run with plain text streaming (no Markdown) to isolate rendering costs.
- Temporarily disable auto-scroll to test ResizeObserver loop hypothesis.
- Add render counters for streaming components.
- If Markdown cost is confirmed, implement progressive enhancement (plain while streaming → Markdown on completion).
