# Responses API Streaming Investigation — Reasoning/UI Mismatch

## Symptom Recap
- During OpenAI Responses API streaming (o-series):
  - Reasoning overlay flickers, showing only a single token at a time (previous text disappears) rather than accumulating.
  - Tool calls do not appear until the message finishes.
  - The streaming assistant message sometimes appears as a user/no-assistant entry until refresh; after refresh, it looks correct.

## Working Theory (High-Level)
1) Missing `event_start` for Responses streams means the frontend never establishes a streaming assistant event (placeholder/builder), so:
   - `mcp_tool_*` events are ignored by the handler (it requires an active assistant placeholder) → tool calls render only after the final, persisted event is loaded.
   - Text/segments aren’t attached to a visible assistant draft, so the UI shows the last user event only until refresh.

2) Reasoning deltas are applied as replace, not append, in the EventBuilder path:
   - The frontend handler sends only the delta text into `EventBuilder.upsertReasoningPart`, which overwrites the prior text rather than appending cumulatively → overlay shows just the latest token, causing a rapid “switching” effect.

## Code Pointers
- Provider (Responses API): `lib/providers/unified/OpenAIResponsesProvider.ts`
  - `async *stream(...)` yields many event types (token, reasoning_start, mcp_tool_*), but never yields a unified `{ type: 'event', data: { event } }` at the start of the assistant turn.
  - Without a yielded `event`, the API route never emits `event_start` SSE.

- API Route: `app/api/chat/route.ts`
  - Emits `event_start` only when it receives a provider `streamEvent` with `type: 'event'`.
  - For Responses API, route receives only `segment`, reasoning events, and `mcp_*` events. No `event` → no `event_start` → frontend has no streaming placeholder/builder set for this turn.

- Frontend Handler: `lib/streaming/frontendEventHandler.ts`
  - Tool handling (`handleMCPToolStartEvent`, `handleToolStartEvent`, `handleToolResultEvent`, etc.) requires an active `assistantPlaceholder`/builder. If `event_start` is missing, early tool events are ignored → tools appear only after final commit/refresh.
  - Reasoning streaming:
    - `handleReasoningSummaryTextDelta` builds cumulative text in `reasoningData` (local map), but calls `builder.upsertReasoningPart` with only the delta text. In `EventBuilder.upsertReasoningPart`, the part is replaced with the provided text, not appended → prior part text is lost each token.

## Evidence In Code
- No `yield { type: 'event', data: { event } }` in Responses provider stream.
- Route’s `case 'event':` is the only place that triggers `streamingFormat.eventStart(...)` SSE; Responses never hits this case.
- Frontend `handleMCPToolStartEvent`: exits early without a placeholder → explains missing tool call UI during stream.
- `EventBuilder.upsertReasoningPart` replaces the part object on each call; if only the delta is passed, we get the “single token” overlay.

## Hypotheses (Ordered)
1) Provider: Emit an `event` early for Responses streams
   - On first assistant output signal (e.g., `message_start` or the first `token`/`reasoning_start`), provider should yield:
     ```ts
     yield { type: 'event', data: { event: currentEvent } }
     ```
   - This lets the route send an `event_start` SSE promptly, so the frontend creates/renames the assistant builder and accepts subsequent tokens, reasoning, and tool events.

2) Frontend Reasoning: Append instead of replace in builder
   - Option A (handler): In `handleReasoningSummaryTextDelta`, pass the cumulative text (from `reasoningData`) to `builder.upsertReasoningPart` instead of just the delta.
   - Option B (builder): Change `EventBuilder.upsertReasoningPart` to append to existing part text when the same `summary_index` already exists and only a delta string is provided.

3) Optional resilience: If `mcp_tool_start` arrives before `event_start`, create/ensure a streaming assistant placeholder anyway
   - Defensive path in frontend: when tool events arrive without a placeholder, synthesize or promote one so the tool UI can appear immediately. Prefer the provider `event` approach above first.

4) Role confusion (assistant vs user) during stream
   - Without `event_start`, the UI may only show the last user event while the assistant draft is not visible. Emitting `event_start` early should resolve this.

## Proposed Fixes
- Minimal, targeted changes:
  1) OpenAIResponsesProvider: emit a unified `event` at the earliest assistant signal (e.g., on `message_start` or first output token) and once per turn.
  2) Frontend reasoning: pass cumulative text to `EventBuilder.upsertReasoningPart` (or change builder to append on existing parts). This prevents overlay flicker.
  3) Optional: In frontend handler, when `mcp_tool_*` arrives with no placeholder, insert/activate a placeholder for resilience.

## Validation Plan
1) Logs: Confirm `event_start` is emitted once per assistant turn before tokens/reasoning/tool events.
2) Reasoning: Observe overlay text grows cumulatively (no token flicker replacement).
3) Tools: Tool cards appear during streaming (not only post-finalize) with arguments deltas and outputs.
4) Role: Streaming assistant event renders as assistant (not user), no refresh required.

## Notes
- These changes mirror the Anthropic streaming fixes we made previously: emit `event` early, pair each turn with an `event_start` and `event_complete`, and ensure deltas are appended rather than replacing full content.

