# Chat Completions: Assistant Text Duplication (Post‑refactor)

## Summary

We’re seeing a mismatch between streamed UI (correct) and the final DB‑persisted assistant message (contains duplicated tokens) when using the OpenAI Chat Completions provider. This mirrors the prior issue we fixed for the OpenAI Responses provider, where text got assembled twice.

Key observation: The Chat Completions provider currently appends deltas directly into `currentEvent.segments` while the chat route also appends incoming deltas into `currentEvent` for persistence. That double assembly likely causes duplicated text in the DB when the stream completes and the route saves the event.

## Scope

- Provider: `packages/providers/src/unified/OpenAIChatProvider.ts`
- Route: `app/api/chat/route.ts`
- Event model: `@budchat/events` (text segments)
- Streaming utils: none specific to Chat Completions (no seq#)

## What Works

- Streamed deltas render correctly on the client.
- Anthropic provider OK (its provider does not mutate the event with text while streaming; it buffers locally and pushes a single final text segment without emitting a new segment event).
- Responses provider fixed by: (1) not appending in route; (2) overwriting final text from `response.output_item.done`.

## Repro (Typical)

1) Use an OpenAI chat model (non‑o series) with streaming enabled.
2) Observe tokens render fine during streaming.
3) The final assistant event stored in `events.segments` has repeated tokens or duplicated phrases.

## Current Pipeline (Chat Completions)

- Provider `OpenAIChatProvider.stream()`:
  - Creates `currentEvent` upfront.
  - On every delta with `content`, it:
    - Finds/creates a text segment in `currentEvent`.
    - Appends to `textSegment.text` (in‑provider mutable state).
    - Yields a `segment` with `{ type: 'text', text: delta }` for streaming.

- Route `app/api/chat/route.ts`:
  - For `segment` events of type `text`, it appends the delta again into `currentEvent` to keep an in‑memory buffer for persistence.
  - This was intentional pre‑refactor, but conflicts with providers that also self‑assemble.

## Top Hypotheses

1) Double Assembly (Most Likely)
   - Chat provider appends into `currentEvent` AND the route appends deltas again.
   - Result: Final persisted segment includes each delta twice or yields partial repetition.

2) Mixed Segment Sources
   - Provider mutates its own `currentEvent` text and route also creates a separate text segment on the fly (if none found momentarily), ending with two text segments that might be merged or saved inconsistently.

3) Out‑of‑order Delta Handling without Sequence Gating
   - Chat Completions deltas don’t carry `sequence_number`; route’s gating defaults to appending. If some deltas are replayed (SSE reconnect, buffer split) we may append duplicates.
   - Less likely given FE looks correct and we don’t see duplicate segment messages logged.

4) Placeholder Pre‑seed
   - If `currentEvent` already contains a partial text segment before the first delta is logged in the route, the route sees `existingLen > 0` at “first recv” and starts appending on top of provider‑seeded text.
   - This would match the Responses failure shape.

## Quick Code References

- Chat Completions provider appends tokens to `currentEvent`:
  - `packages/providers/src/unified/OpenAIChatProvider.ts` (stream):
    ```ts
    if (delta.content) {
      let textSegment = currentEvent.segments.find(s => s.type === 'text') as any;
      if (!textSegment) { textSegment = { type: 'text', text: '' }; currentEvent.segments.push(textSegment); }
      textSegment.text += delta.content;       // provider self‑assembles
      yield { type: 'segment', data: { segment: { type: 'text', text: delta.content }, segmentIndex: ... } };
    }
    ```

- Route appends deltas again for text segments:
  - `app/api/chat/route.ts`:
    ```ts
    if (segment.type === 'text' && segment.text) {
      // route appends delta into currentEvent for persistence
    }
    ```
  - We already special‑case OpenAI Responses to skip route assembly; Chat provider is not yet gated.

## Debug Plan

1) Confirm Dual Writes
   - Add a short‑lived log in Chat provider under `RESPONSES_DEBUG`‑style flag: on each delta append, log `prov_append` with before/after len for `currentEvent` text.
   - In the route (temporarily), log `route_recv` and `route_append` for Chat provider only (simple `provider.name === 'openai-chat'`).
   - Expect to see both firing for the same deltas.

2) Check Text Segment Cardinality
   - At `done`, log count of `text` segments in `currentEvent` for Chat runs to ensure there’s only one.

3) SSE Replay/Repeat Sanity
   - Count identical `segment.text` payloads seen in the route for Chat runs. If we see obvious repeats, inspect SSE iterator buffering again.

4) Save‑Time Snapshot
   - Right before `saveEvents`, dump `finalLen`, possibly first 100 chars of text, to compare with FE’s last render.

## Low‑Risk Fix (Recommended)

Mirror the Responses fix for Chat Completions:

- Do NOT assemble text in the route for providers that self‑assemble.
  - Introduce `isSelfAssemblingProvider = provider.name === 'openai-responses' || provider.name === 'openai-chat'` and gate route’s text appends.
  - This keeps `currentEvent` as the single source of truth for text (owned by the provider), while the route only forwards tokens to FE.

Alternative fix options:

- Provider‑side buffering: Have Chat provider keep an internal buffer and only write the final text to `currentEvent` at `done`. More invasive and less consistent with current design.
- Route‑side overwrite: At `done`, overwrite text with a locally assembled buffer (but we’d rather consolidate assembly in one place, provider‑side).

## Validation Plan

1) Manual run with Chat Completions:
   - Confirm FE streaming remains correct.
   - Confirm DB text has no duplicates after completion.

2) Regression runs:
   - Anthropic (no change expected): FE tokens OK; DB text remains correct (provider sets full text at block stop; route does not over‑append when gated by provider name).
   - Responses (already fixed): unchanged behavior.

3) Edge cases:
   - Tool calls mixed with text — ensure final text remains correct and tool segments unaffected.
   - Empty text completions — no text segment duplication.

## Next Steps

- Implement the small route gate for Chat Completions to avoid double assembly.
- Optionally add a short temporary debug to confirm no more dual appends, then remove.

