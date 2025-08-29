# Unified Event Rendering & Streaming Simplification

## Goals
- Single rendering path for assistant/user/tool events regardless of provider (Anthropic, OpenAI Chat, OpenAI Responses).
- Streaming and non‑streaming use the same UI components and data shape (Event + Segment[]).
- Provide a minimal, local “event builder” during streaming that assembles canonical Event objects incrementally, then commits them to the store.
- Keep only one streaming‑specific behavior in UI: reasoning overlay while a reasoning segment is in progress; collapse to the standard Reasoning dropdown once the next non‑reasoning segment appears.
- Support multi‑turn responses within a single request without losing previously built events when the stream finalizes.

## Problems With Current Pipeline
- Divergent paths for streaming vs. persisted events:
  - Streaming uses a fragmented `streamingBus` (text buffer, tools, reasoning parts) and avoids store writes.
  - Persisted events flow through store and render as canonical segments.
  - Result: different styling and behavior until page refresh.
- Tool overlays only use the bus and aren’t mirrored into the event during streaming; inline tool UI shows up only after commit.
- Reasoning UI renders from the bus and separately as a dropdown after commit; ordering logic is duplicated and fragile.
- New chat mode saves only at `done`, so if a stream aborts, the UI shows more than the DB and we can’t resume. (Documented in new-chat-mode-risks.md.)
- Multi‑turn streams: when multiple assistant events are produced within one request, we can lose previously streamed turns when `message_final` arrives because only the last placeholder is replaced and we avoided store writes mid‑stream.

## Design Overview
Unify on the canonical Event shape everywhere. Introduce a lightweight, front‑end “EventBuilder” that consumes SSE and produces the same Event objects the store uses.

- Builder responsibilities:
  - Start a new assistant Event when the stream signals an event start.
  - Append segments in order: text deltas (first text streams), tool_call starts/finalization, built‑in tool segments, reasoning parts, and (when applicable) tool_result segments.
  - Maintain minimal ephemeral state needed for visuals (e.g., current reasoning part, tool status), but always project that state into the in‑memory Event’s segments where possible.
  - Emit granular updates to the UI (to render immediately) and commit the finalized Event to the store when the builder marks it complete.

- Rendering responsibilities:
  - A single renderer (SequentialSegmentRenderer) reads an Event (whether in‑progress from the builder or persisted from store) and renders segments in sequence.
  - While the current Event has an active reasoning segment and no later non‑reasoning segment has arrived yet, show the streaming overlay; once a non‑reasoning segment is appended, collapse to the standard Reasoning dropdown.
  - Tool calls render as segments inline; while waiting for results, show the loading state; once results are appended or status flips, show completed/error state.

This eliminates special casing based on “where data comes from” (bus vs. store). It’s always an Event.

## Data Flow (Streaming)
1. User sends message → optimistic user Event + assistant placeholder Event are added to store.
2. EventBuilder attaches to the assistant placeholder id and starts filling its segments as SSE arrives:
   - token/text: updates the first text segment (streaming delta for first text; subsequent text segments add as complete chunks).
   - tool_start/tool_finalized: ensures a tool_call segment exists and updates args.
   - built‑in tool events: add/advance `web_search_call` or `code_interpreter_call` segments with status transitions.
   - reasoning events: add or update a single reasoning segment, record parts in order; mark as streaming until next non‑reasoning segment arrives.
   - tool_result/mcp_tool_complete: append tool_result segment (or attach output if the provider embeds results on tool_call).
3. Multi‑turn handling within a single request:
   - If the backend emits a new assistant Event during the same session, the builder finalizes the current Event (commit to store) and starts a new assistant Event with a new id. Previously built Events remain in the store (no overwriting on final commit).
4. At stream end:
   - Builder finalizes any in‑progress Event and commits to the store.
   - No special reconcile step required — store already contains all assistant Events created during this stream.

## Store Writes (Incremental)
- Continue‑mode: commit each Event as soon as it is finalized (end of its stream chunk). Tool results that arrive between two assistant Events are saved in their own tool_result Event or attached (depending on provider rules) and committed immediately.
- New‑mode: adopt the same incremental approach (see new-chat-mode-risks.md) to avoid durability gaps.
- Idempotency: Event ids come from the server or are preallocated for placeholders; replays are conflict‑free.

## Back‑End Notes
- Current SSE mix: `event` (start), `segment` (text/tool_call/reasoning), specialized `tool_*` and built‑in tool events.
- For maximal simplicity on the front‑end, prefer normalizing tool events as `segment` updates when feasible:
  - Emit `segment: { type: 'tool_call', ... }` upon finalized args.
  - Emit `segment: { type: 'tool_result', ... }` rather than a separate `tool_result` event when allowed by provider.
  - Keep the specialized `tool_*` events purely as UX hints/overlays (optional). The builder should be able to operate using either form.
- Anthropic sequencing constraint: EventLog.toAnthropicMessages must ensure tool_result blocks directly follow tool_use ids. Our current fix should remain.

## Front‑End: EventBuilder API (proposed)
- Constructor: `new EventBuilder({ placeholderEventId, onUpdate(eventDraft), onFinalize(event) })`.
- Methods mapped to SSE types:
  - `startAssistantEvent(id?, responseMetadata?)`
  - `appendTextDelta(text)`
  - `startToolCall({ id, name })`
  - `finalizeToolArgs({ id, args })`
  - `completeTool({ id, output, error })`
  - `upsertReasoningPart({ summary_index, text, is_complete, sequence_number })`
  - `setBuiltInToolStatus({ id, type, status, code? })`
  - `finalizeCurrentEvent()`
- The builder holds the working Event object (same shape as store) and sends `onUpdate` for immediate UI, `onFinalize` to write to store.
- For existing conversations, `onUpdate` writes to a transient map keyed by the active assistantEventId (not the persisted store) used by the renderer for that event id. For new conversations, the same pattern applies.

## Rendering: One Path
- SequentialSegmentRenderer reads either:
  - A persisted Event from store, or
  - A transient EventDraft from the builder (found via the active assistantEventId).
- It renders segments in the same way regardless of origin:
  - `reasoning` → overlay when streaming, collapsible when a later non‑reasoning segment exists.
  - `tool_call` → inline, loading until result present, then completed/error.
  - built‑in tools → inline, status mapped from segment.
  - `text` → first text streams, additional text as static segments.
- After finalization, the same renderer shows the committed Event; no style shift.

## Multi‑Turn Within One Request
- The builder tracks the current assistant Event id. When the back‑end begins a new assistant Event within the same stream:
  - Finalize current Event and commit to store.
  - Create a new draft Event with a new id and continue appending segments.
- The UI continues to show prior turns because they’re already committed.

## Migration Plan
1. Implement EventBuilder with a small adapter layer in FrontendEventHandler:
   - Translate existing SSE events to builder calls.
   - Maintain a map `draftsByEventId` for transient drafts; renderer looks them up when streaming.
   - Keep `debug` logs to aid verification.
2. Update SequentialSegmentRenderer to prefer draft for the current `streamingEventId` if present; otherwise use the persisted Event from the store.
3. Switch continue‑mode to incremental persistence (already planned) and keep the same for new‑mode.
4. Gradually reduce the `streamingBus` surface to a compatibility layer or fold it into the builder (the builder becomes the “bus” but returns a canonical Event shape).

## Telemetry & Debugging
- Add a compact tail summary of outgoing provider messages in the API logs for Anthropic (already added) when validation errors occur.
- Front‑end:
  - Log builder lifecycle per stream: startEvent, tool start/finalized/complete, reasoning part add/done, finalizeEvent.
  - Provide a dev overlay (gate by `NODE_ENV !== 'production'`) to show the active draft Event JSON for the assistant.

## Acceptance Criteria
- Tool calls and reasoning appear live during streaming in the exact segment order; no refresh needed.
- On stream completion, no visual shift — the committed Event looks identical to the streaming draft.
- Multi‑turn within one request preserves earlier turns after finalization.
- New conversations persist incrementally (no data loss on refresh mid‑stream).
- The front‑end code path is unified: same renderer for streaming and persisted events, with only a minimal overlay rule for in‑progress reasoning.

## Out of Scope (for now)
- Full replacement of `tool_*` SSE events with `segment` events on the server. We will support both and decouple UI from server specifics via the builder.
- Client‑side pagination/virtualization of very large conversations.

---

This design keeps the UI simple and deterministic by always rendering canonical Event objects, while the builder ensures streaming feels instantaneous without diverging component paths.
