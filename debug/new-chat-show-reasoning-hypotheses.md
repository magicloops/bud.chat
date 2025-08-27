# Debug: Missing “Show Reasoning” after first assistant reply on /chat/new

Status: Reproduced. Overlay streams correctly; the persisted “Show Reasoning” toggle disappears when the first assistant message completes and remains missing after the route swap to `/chat/[id]` (until a refresh).

## Symptom Recap
- During /chat/new:
  - Reasoning overlay (parts) streams fine; header shows “thinking…”.
  - When text starts, we show the temporary “Show Reasoning” (streaming summary) — OK.
  - As the message completes, the temporary button disappears (streaming ends), but the canonical “Show Reasoning” (from persisted segments) does not appear.
- After route swaps to `/chat/[id]`, the “Show Reasoning” is still missing for this first assistant message — it shows only after a full page refresh.

## Rendering & Data Paths (Relevant)
- UI components
  - EventStream → EventList → EventItemSequential → StepsPanel
  - Streaming: StepsPanel uses overlays (streamingBus) and hides them once local streaming ends.
  - Non‑streaming: StepsPanel renders persisted segments; “Show Reasoning” comes from the finalized assistant event having a `reasoning` segment.
- New chat flow (app/(chat)/chat/[conversationId]/page.tsx)
  - Optimistic: adds user + assistant placeholder to a temp conversation in store.
  - Streams via FrontendEventHandler (local updater disabled; overlays only).
  - onMessageFinal: should replace the placeholder in the temp conversation with the canonical assistant Event (including reasoning/tool segments).
  - On `complete`: builds the real conversation object, merges streamed text if still a text-only placeholder, sets real conversation in store, then `router.replace` to `/chat/[id]`.

## Observations From Code
- StepsPanel shows persisted reasoning only when not streaming AND the event has a `reasoning` segment.
- For /chat/new, we do not mutate store mid-stream except in onMessageFinal.
- Our server emits `message_final` in the ‘done’ case (after saving), but provider ordering can lead to `complete` reaching the client before `message_final`.
- In the `complete` handler on the client we construct the real conversation. If `message_final` has not yet been processed, we likely carry forward a text-only placeholder (no reasoning). The UI then switches to `/chat/[id]` with an assistant event that lacks `reasoning`, so the toggle is missing.

## Hypotheses
- H9: Event ordering race (probable)
  - `complete` arrives before `message_final`. We transition and build the real conversation without the canonical assistant event. The final event with reasoning never gets applied before route swap. Result: no reasoning button until refresh reloads from DB.

- H10: Placeholder replacement mismatch (possible)
  - onMessageFinal replaced by matching the wrong id (server event id vs client placeholder id). We addressed this by matching the client placeholder id; still worth validating during logs.

- H11: Dual rendering sources (events prop vs store) (possible)
  - EventStream (new chat) renders using `events={existingConversation?.events}` from the store, but the provided `localConversation` wrapper has minimal meta. If the store temp conversation doesn’t include the final event yet when streaming ends, the UI pivots to non-streaming without persisted reasoning.

- H12: Overlay-to-summary gating (possible UX timing issue)
  - We hide the streaming summary when text completes (local streaming ends), but if the canonical event hasn’t been committed yet, there is a visual gap where neither streaming summary nor persisted summary is visible.

## Proposed Fix Directions (No code yet; for review)

1) Route swap after canonical event (preferred)
   - Defer the `/chat/new → /chat/[id]` route replacement until we receive and commit `message_final` to the temp conversation. Add a short timeout fallback (e.g., 500–1000 ms) to avoid rare provider issues.
   - Pros: Simple, robust; avoids the gap and ensures real conversation always has canonical event.
   - Cons: Slightly delays the route swap in cases where `message_final` lags `complete`.

2) Canonical-first real conversation assembly
   - During streaming, cache the last canonical assistant event (`lastFinalEvent`) from `onMessageFinal`.
   - On `complete`, if `lastFinalEvent` exists, always use it to replace the placeholder in the real conversation object before setting it in the store. If it does not exist yet, (a) delay a tick (microtask or small timeout) to capture `message_final`, or (b) fetch the final event via a one-shot GET as a fallback.
   - Pros: Preserves the current timing of the route swap; resilient to out-of-order events.
   - Cons: Slight extra code to coordinate fallback.

3) Keep streaming summary visible until canonical commit
   - In StepsPanel (new chat only), don’t hide the streaming summary when text completes; hide it only after `message_final` has been committed to the temp conversation (or a boolean “hasFinalEvent” is true).
   - Pros: Eliminates the visual gap even if the canonical event lags.
   - Cons: Slightly more UI logic; still need to ensure the real conversation is built with canonical data.

4) Server ordering guarantee (complementary)
   - Ensure the backend always emits `message_final` before `complete` (or immediately after DB save and before closing the stream). Audit that the client’s read loop won’t process `complete` earlier than `message_final`.
   - Pros: Simplifies client logic.
   - Cons: Provider libraries and buffering can still reorder; need robust client-side handling anyway.

5) One-shot canonical fetch on route swap (fallback)
   - After route replacement, if the first assistant event lacks `reasoning`, immediately fetch the conversation with `include_events=true` and replace the assistant event in store.
   - Pros: Bulletproof fallback; corrects any ordering mishaps.
   - Cons: Extra network roundtrip; minor delay.

## Suggested Plan
- Step 1: Implement option (1) or (2) to ensure the real conversation always carries the canonical assistant event before/at the moment of route swap.
- Step 2: Optionally apply (3) to remove any UI gap while waiting for the canonical commit.
- Step 3: Keep (5) as a safety net if (1)/(2) still hit edge cases in the wild.

## Validation Checklist
- /chat/new flows:
  - Overlay appears; header shows “thinking…”.
  - After text begins: temporary “Show Reasoning” appears (streaming summary).
  - When text completes but before route swap: the temporary “Show Reasoning” remains visible until canonical event is committed (no gap).
  - After route swap: the real conversation shows the persisted “Show Reasoning” (from `reasoning` segment) without refresh.
- /chat/[id] flows remain unchanged.

---

## Log Analysis (from latest run)

Client (page.tsx):
- “[STREAM][new] Completing stream … → Merge applied → Setting real conversation → Replacing route to real conversation”
- After that: “[STREAM][new] message_final (page loop) { eventId }” and “[FE] message_final received { eventId }”

Server (route.ts):
- “emitting complete to client” then “emitting message_final to client { eventId }” (complete precedes message_final)

Interpretation:
- Confirms H9 (event ordering race): complete is processed and route swap happens before message_final is handled on the client.
- Our current onMessageFinal for /chat/new updates the temp conversation only. By the time message_final arrives, we have already set the real conversation and likely scheduled removal of the temp conversation, so the canonical event (with reasoning) is not present in the real conversation. Hence the missing “Show Reasoning” until refresh.

Refined Action Plan:
1) Defer route swap until message_final processed (preferred):
   - Gate `router.replace()` on having received and committed message_final to either temp or real conversation store entry. Add a short timeout fallback (e.g., 750ms) to avoid deadlocks if message_final is delayed or dropped.
2) Or, canonical-first assembly at complete time:
   - Cache `lastFinalEvent`. On complete, before setting the real conversation, replace the assistant placeholder with `lastFinalEvent` if available. If not yet available, wait briefly (microtask/timeout) for message_final; if it still doesn’t arrive, proceed and immediately kick a one-shot fetch for the canonical event to patch the real conversation.
3) UI continuity:
   - Keep the streaming “Show Reasoning” summary visible until we have confirmed the canonical event is present in the conversation that will render after swap. This prevents the toggle from disappearing during the handoff.

Success Criteria:
- With logs, we should see `[FE] message_final received` before `router.replace`, or see that the real conversation is built with the canonical event when `complete` fires (using `lastFinalEvent`). The “Show Reasoning” button should remain visible from the moment text begins and persist after the route swap without refresh.
