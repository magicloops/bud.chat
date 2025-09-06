# Multi‑Turn Streaming Investigation — Missing First Events + Token Shove

## Symptom Recap
- During multi‑turn streams (e.g., Anthropic + local MCP), the frontend:
  - Shows all streamed text in a single (first) assistant item, pushing tool calls to the bottom while streaming.
  - After streaming finishes, only the last assistant event is visible until refresh (earlier event(s) appear only after reload).
  - Previously: duplicate initial tokens and brief duplicate assistant render (we addressed those, but the core multi‑turn issue persists).

## Hypotheses (ordered by likelihood)

1) Provider emits `event` (start signal) too late
- AnthropicProvider.stream currently yields `event` only when `chunk.type === 'message_delta' && chunk.usage`.
- Until that late point, the server emits only `segment` tokens. The frontend doesn’t receive `event_start` early enough to delineate a new assistant event, so tokens keep flowing into the same draft.
- Evidence:
  - Logs show many `[token]` + `[flush]` entries for the same placeholder id before a late `[event_start]` appears.
  - Anthropic streaming semantics: `message_start` is sent first; we can (and should) yield our `event` as soon as we create the `currentEvent`, not at the very end.

2) Backend only emits `event_start` once per stream
- In `app/api/chat/route.ts`, the `eventStarted` boolean gates `eventStart(currentEvent)`; once `true`, subsequent assistant events may not emit a new `event_start` for each turn.
- Even though we added `event_complete` when a new `event` arrives, if `event_start` isn’t emitted for each new turn, the frontend won’t create a new builder; it clears the old builder on `event_complete`, then has no placeholder/builder for the next tokens (they either get lost or shoved into the previous draft depending on timing).
- Evidence:
  - Code uses a single `eventStarted` flag across multiple turns.
  - Logs: `[event_start]` appears late and only once in many cases.

3) Frontend commits only the last event on finalize
- We added `event_complete` handling to flush+commit the current draft to store, but if `event_start` for the next turn arrives too late (or not at all), the frontend may keep only the last event’s draft and overwrite prior turns on `message_final`.
- Evidence:
  - “Only the last event is shown after streaming finishes” suggests we replaced rather than appended/committed prior turns.

4) Store replacement logic for message_final still drops previous turns in some paths
- Existing conversations: `onMessageFinal` replaces by `finalEvent.id` or appends if missing. If we never created a separate assistant event for the first turn (due to missing early `event_start`), we have nothing to preserve.
- New conversations: temp → real merge path carefully de‑dupes by id, but could still discard early turns if they never materialized as separate entries during the live stream.
- Evidence:
  - Behavior differs between live view and after refresh (DB has both events), indicating store commit boundaries are not aligned during the stream.

## Code Pointers (likely sources)
- Backend
  - `lib/providers/unified/AnthropicProvider.ts` (stream):
    - Currently yields `event` only at the end (`message_delta` with usage). We should yield once at `message_start` (as soon as `currentEvent` is created) to send an early `event_start` to the client per turn.
  - `app/api/chat/route.ts`:
    - `eventStarted` gating: prevents emitting `event_start` for subsequent turns.
    - Should emit `event_start` for every new `event` (assistant turn), not just the first.
    - We added `event_complete` when a new `event` arrives — good — but it must be paired with a new `event_start` immediately for the next turn.

- Frontend
  - `lib/streaming/frontendEventHandler.ts`:
    - `event_complete` handler now flushes & disposes builder and commits draft to store. Good.
    - Then it clears placeholder+builder; it must receive a prompt `event_start` to begin the next turn. If `token` arrives before `event_start`, tokens are ignored (no placeholder) or mistakenly appended to the old one (if not cleared in time).
  - `components/EventList/SequentialSegmentRenderer.tsx`:
    - Streams only from draft text (baseText is empty) — this fixed early duplicate text but relies on the builder boundaries being correct.

## Why the UI is correct after refresh
- The DB has both events because the server saves the second assistant event at provider “done,” and tool results are saved incrementally. The live UI failed to present the boundary because the frontend never saw an early `event_start` for the second turn and therefore never built a second draft during streaming.

## Debug/Validation Plan
1) Backend logging (dev-only):
- In AnthropicProvider.stream, log when `message_start` occurs, and immediately yield an `event` → verify server emits `event_start` early for each turn.
- In `app/api/chat/route.ts`, log each `event_start` and `event_complete` emission with the event id and a sequence.

2) Frontend logging (dev-only):
- In `frontendEventHandler`, log the sequence of `event_start`, `event_complete`, and `token` to confirm we receive them in the expected order per turn.
- Confirm that after `event_complete`, the next `event_start` is received before subsequent `token` events.

3) Store assertions:
- Log conversation events length on each `event_complete` and `event_start` to see that each turn adds/replaces exactly one assistant event.

## Proposed Fixes (next patch after confirmation)
- Provider: Emit `event` (and thus server `event_start`) at the earliest point (`message_start`) for every assistant turn.
- Server: Remove/adjust `eventStarted` gating so that `event_start` is emitted for every `event` (per turn).
- Ensure `event_complete` is always sent before the next `event_start` (we already added this, but timing should be verified).

## Expected Outcome After Fix
- During streaming:
  - First assistant turn (text + tool_call) appears as its own event.
  - On multi-turn, when the second assistant response starts, the first turn is finalized (committed) and a new event placeholder is created immediately; tokens stream into the second event.
- After finalize:
  - The store shows all assistant events in order without requiring a refresh.

