Title: Responses + Remote MCP: repeated iterations and missing DB save — hypotheses and checks

Summary
- Symptoms observed after modularization and recent fixes:
  - With OpenAI Responses + remote MCP enabled, the chat route loops multiple iterations (Iteration 1/30, 2/30, …) instead of exactly one.
  - UI shows “thinking…” and the network request does not finish promptly.
  - Assistant response appears in UI but disappears after refresh (not saved to DB).

Context and recent changes
- Providers (@budchat/providers)
  - Responses input mapping: enforced msg_* IDs and reasoning summary_text.
  - For mcp_call items, fallback server_label to first configured remote server; skip item if none resolvable.
  - Tool result mapping now records name/server_label via tool_meta.
- Events (@budchat/events)
  - EventLog.getUnresolvedToolCalls updated to consider inline tool_call output/error as resolved and to ignore remote_mcp tool_calls for local execution accounting.
- Chat route (app/api/chat/route.ts)
  - Added synthetic tool_result to EventLog on mcp_tool_complete to resolve pending tool_calls.
  - Added a fallback when provider stream ends without a ‘done’ event: emits message_final and done, then closes SSE (no DB save in this path yet).
- Streaming (frontend)
  - FrontendEventHandler now clears streaming state on ‘error’ SSE.

Hypotheses (with validation steps and likely fixes)

H1) Fallback path bypasses DB persistence for the assistant event
- What: The ‘done’ case contains the code that saves the current assistant event to the DB. Our newly added fallback (when the provider stream ends without ‘done’) emits message_final and done to the client, then closes SSE and returns — but never calls saveEvents.
- Evidence: Missing DB persistence (response disappears after refresh) correlates with the fallback path being taken (multiple iterations before), suggesting the code never reaches the original ‘done’ handler that persists.
- How to validate:
  - Add logs around ‘done’ handler save block and around the fallback block to see which path is taken (e.g., ‘[Chat API] Fallback done used — no provider done’ and confirm absence of ‘Existing conversation events saved …’).
  - Inspect `currentEvent` value at fallback time.
- Likely fix:
  - In the fallback block, persist `currentEvent` (and any `allNewEvents` if applicable) using `saveEvents(supabase, [currentEvent], conversationId, currentOrderKey)` before closing the stream, mirroring the ‘done’ path semantics.
  - Ensure we also trigger title generation for new conversations (as the done path does).

H2) currentEvent is null at fallback time
- What: Even when streaming produced text, `currentEvent` might have been nulled earlier (e.g., after an event_complete or logic branch). If fallback tries to save when currentEvent is null, no persistence happens.
- How to validate:
  - Log `!!currentEvent` right before fallback emits message_final/done.
  - Verify the provider’s ‘event’ emission is always handled and `currentEvent` is set (Responses provider emits an initial event via `ExtendedStreamEvent` mapping).
- Likely fix:
  - If null, reconstruct a minimal assistant event from `eventLog.getEvents().slice(-1)[0]` or from accumulated segments (if available) and persist that.
  - Better: ensure the provider mapping always yields an ‘event’ before any ‘segment’ to seed `currentEvent`.

H3) Provider stream ends without sending ‘done’, and we return before marking unresolved as closed
- What: If the stream ends unexpectedly, we might not hit the ‘done’ case where we (a) save the event, and (b) inspect unresolved to decide subsequent passes.
- Evidence: Logs show repeated ‘Iteration N/30’ starts. The outer while loop increments before each call; if the inner stream doesn’t ‘return’ early with proper closure, outer loop might continue.
- How to validate:
  - Add logs at the start of each iteration and at provider stream close paths (‘done’ handler vs fallback) to confirm which termination path is used.
- Likely fix:
  - Ensure fallback path both saves and closes; also sets `iteration = maxIterations` as already implemented (to stop the outer loop) — keep this behavior.

H4) EventLog unresolved logic still flags items as unresolved in some cases
- What: Despite ignoring `server_type === 'remote_mcp'`, if remote tool_call segments are missing server_type or have unexpected shape, they may be counted as unresolved.
- Evidence: Iteration messages still appearing previously; now reduced but still worth guarding against.
- How to validate:
  - Add a debug dump of unresolved tool_call IDs and their segment snapshots right before unresolved check to see what fields are present (server_type, server_label, args, output, error).
- Likely fixes:
  - Expand the “remote” heuristic: treat as remote if `server_label` is present and not empty when `server_type` is absent.
  - Consider marking tool_call resolved when the provider emits ‘tool_result’ SSE to the client by also injecting a synthetic tool_result into EventLog (already added for mcp_tool_complete, but ensure it’s always reached for remote tools).

H5) Persisting only currentEvent misses earlier segments/events added to EventLog
- What: The done handler persists only `currentEvent`. If we added tool_call segments and other updates to EventLog but `currentEvent` was rotated or replaced mid-stream, persistence might be incomplete.
- How to validate:
  - Compare `eventLog.getEvents()` at the point of persistence vs what we save.
  - Ensure that the helper ‘existing conversation events saved’ path truly persists the final assistant event (not an earlier draft), and that tool results are persisted incrementally (they are, via saveEvents during the stream).
- Likely fix:
  - Use `currentEvent` for assistant save as now, but audit places where `currentEvent` is nulled (after `event_complete`), and ensure we always persist the last completed assistant event before nulling.

H6) Responses provider mapping: missing or late ‘event’ emission
- What: Our Responses provider `stream()` mapping constructs and emits an ‘event’ at the start. If certain responses begin with a tool block or other content we don’t map to ‘event’ promptly, the chat route might not set `currentEvent` until late or at all.
- How to validate:
  - Add logging in the provider mapping where it yields `{ type: 'event', data: { event } }` to confirm it happens before any ‘segment’.
  - Check for any code path that could bypass yielding ‘event’ (e.g., if output arrives as reasoning-only first).
- Likely fix:
  - Ensure provider mapping always yields an ‘event’ at the beginning (create an empty assistant event if needed) before any segments.

H7) ‘message_final’ emitted to client but not used for server persistence
- What: The server emits `message_final` SSE but the save path is tied to ‘done’. If fallback emits ‘message_final’ without saving, DB won’t reflect the final state.
- How to validate:
  - Trace where server sends `message_final`; confirm whether any save is performed in the same control flow.
- Likely fix:
  - Co-locate persistence with the finalization point (either in ‘done’ or in the fallback) and ensure it runs for both paths.

H8) Order key handling skipped on fallback
- What: In ‘done’, we save with `currentOrderKey = await saveEvents(...)`. The fallback currently doesn’t update `currentOrderKey` (since it didn’t save at all). Even after adding save, we should thread the updated key to avoid collisions on subsequent operations.
- How to validate:
  - Add a temporary log of `currentOrderKey` before and after save in both paths.
- Likely fix:
  - Mirror the ‘done’ handler’s save invocation and variable update in the fallback.

Proposed next steps (implementation plan after validation)
1) Instrumentation: Add minimal logs in chat route to distinguish ‘done’ vs fallback, log currentEvent presence, and log unresolved summary before deciding iteration.
2) Fallback save: In the fallback block, persist currentEvent (and optional title generation for new conversations) before emitting done and closing.
3) Robust remote detection: In EventLog.getUnresolvedToolCalls, treat tool_call with a non-empty server_label as remote when server_type is missing.
4) Provider mapping audit: Confirm ‘event’ yield happens at stream start for Responses provider; add a defensive early event creation if needed.

Expected result
- Exactly one iteration for Responses + remote MCP; DB contains persisted assistant event; SSE completes cleanly even if upstream omits ‘done’.

