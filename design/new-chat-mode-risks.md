# New Chat Mode — Streaming & Persistence Risks

## Overview
- New chats stream the first assistant response and only persist events at provider `done`. During multi-turn tool flows, tool results are emitted to the client but not persisted until the final save.
- After adding multi-iteration tool handling, the gap between UI-visible events and DB persistence widened.

## Current Flow (simplified)
- Create conversation row.
- Build `eventLog` in memory; stream SSE to client.
- If assistant emits tool_call(s):
  - Execute tools (server-side), emit `tool_result`/`tool_complete` to SSE, append to `eventLog` (memory only).
  - Re-invoke provider with updated `eventLog`.
- Persist all events for new conversations only once (on provider `done`).

## Predicted Issues
- Unsaved tool results during streaming
  - Tool results are visible in UI but not in DB until the end. If the server crashes or the request is aborted mid-stream, tool results and assistant output are lost.
  - Users cannot resume an in-progress “new” conversation after refresh because the DB lacks any of the streamed events.
- Lost context on reconnect
  - Follow-up invocations rely on `eventLog` in memory. If the connection drops before final save, the server cannot continue the flow on a new request because unresolved tool calls/results aren’t in DB.
- Atomicity and partial saves
  - Final persistence happens in one batch, potentially writing a large set of events. Any error at this point discards the entire streamed interaction from the DB.
  - Title generation depends on persisted events; if save fails or is skipped (disconnect before `done`), no title is generated.
- Ordering and duplication risks on retries
  - If the endpoint retries after partial work (e.g., transient DB error), reusing `eventLog` could attempt duplicate inserts unless IDs remain stable and unique across retries.
  - Current fallback logic handles unique violations, but the all-at-once write near `done` may be heavier than incremental inserts.
- Long-running memory residency
  - Multi-iteration flows keep all events in memory until the end. Large responses or many tool invocations increase memory footprint and GC pressure.
- SSE close vs. server lifecycle
  - If the client disconnects, the route may be torn down before the final save. Without explicit handling to persist on abort, streamed data is lost.
- Mixed provider behaviors
  - Responses API sometimes resolves tools internally. Other times, it may emit tool calls for local handling. The current new-mode persistence policy treats both the same and still delays saving, creating the same durability gap.
- Frontend consistency
  - UI consumes `message_final` as canonical but cannot reload from DB mid-stream. If users navigate away, the conversation appears empty or incomplete on reload.

## Impact
- Durability: Medium-to-high risk of losing entire first-turn content for new chats in real-world network failures.
- UX: Users cannot resume or share a link mid-stream; refreshing the page discards progress.
- Observability: Post-mortem debugging is harder because streamed-but-unsaved data never reaches DB logs.

## Options to Address
- Incremental persistence (recommended)
  - Save assistant events as soon as they are finalized (on `event` with sufficient structure) even in new mode.
  - Save tool_result batches immediately after tool execution in each iteration.
  - Maintain `currentOrderKey` across iterations starting from null, updating after each incremental save.
- Idempotency controls
  - Keep event IDs stable and unique per item so replays/retries can safely re-insert with conflict handling.
  - Avoid regenerating new IDs for the same semantic event during retries.
- Abort/disconnect handling
  - Detect client disconnect and opportunistically persist the current `eventLog` snapshot (best-effort) before teardown.
- Backpressure/limits
  - Impose limits on max iterations or memory usage; fall back to incremental persistence earlier when thresholds are exceeded.
- Title generation triggering
  - Trigger title generation after the first assistant event is persisted rather than at the very end.
- Resume support
  - If a stream ends prematurely, allow a “resume” continue-mode call that loads whatever was persisted and replays unresolved tool calls.

## Recommended Direction
- Switch new-mode to incremental persistence:
  - Persist each assistant event immediately when finalized and persisted in memory.
  - Persist each tool_result batch right after execution.
  - On final `done`, only persist remaining unsaved items (noop in most cases).
- Ensure stable IDs and conflict-safe inserts to make retries idempotent.

## Acceptance Criteria (for follow-up PR)
- Assistant events and tool_result events for new chats are visible in DB within 1–2 seconds of being emitted to SSE.
- Refreshing the page mid-stream shows the latest persisted events (no empty conversation).
- On transient DB errors, retries do not create duplicate events.
- Title generation runs after the first assistant event is saved (not gated on final `done`).
- Memory usage remains bounded during long multi-iteration flows.

## Test Scenarios
- Anthropic + MCP tool, refresh mid-stream → DB contains user msg, assistant tool_call, tool_result, possibly partial assistant text; resume works.
- OpenAI gpt-4o + MCP with multiple tools in sequence → events persist after each iteration; order keys increase correctly.
- OpenAI o-series (Responses) with locally handled tool calls → incremental persistence works identically; with provider-internal tools → stream completes and final persistence succeeds.
- Simulated disconnect before `done` → persisted events reflect work completed up to that point; no duplicates on retry.
