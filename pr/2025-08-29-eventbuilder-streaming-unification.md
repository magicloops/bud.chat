# 2025-08-29 — EventBuilder Streaming Unification & streamingBus Removal

## Summary
- Unifies streaming and persisted rendering by building canonical assistant Events on the client via a lightweight EventBuilder (no overlay bus).
- Supports multi-turn assistant events within a single stream using event_start → segment* → event_complete, preserving earlier turns without refresh.
- Emits uniform SSE on the backend (event_start, segment, event_complete, complete) while keeping legacy events temporarily for compatibility.
- Temporarily disables the code interpreter built-in tool UI; web search built-in remains minimal.

## Status
- EventBuilder: added and integrated across streaming UI.
- Multi-turn: implemented via event_start; each assistant event gets its own builder + draft, then commits on message_final.
- streamingBus: fully removed from UI and handler. File deleted.
- Backend SSE: emits segment and event_complete in addition to legacy events.
- Code interpreter: UI disabled and handler paths converted to no-ops.

## Scope of Changes

### Frontend
- Draft-driven rendering (no bus):
  - components/EventList/EventItemSequential.tsx — reads live draft via `getDraft(event.id)` during streaming; header status (thinking/using-tools/typing) derived from draft segments.
  - components/EventList/SequentialSegmentRenderer.tsx — renders segments inline (text, tool_call, reasoning, web_search) in order for both drafts and committed events.
  - components/EventList/StreamingTextSegment.tsx — polls draft text (50ms) instead of bus.
  - components/EventList/StreamingReasoningSegment.tsx — polls draft reasoning parts (50ms) instead of bus.
- Removed bus-based overlays/components:
  - Deleted: StreamingToolsOverlay, StreamingReasoningSummary, StepsPanel, StepsOverlay, StreamingCodeInterpreter, hooks/useEventChat.ts.
- Conversation streaming state: derived from store’s `isStreaming` + `streamingEventId` (no overlay/session coupling).
- Commit logic: `onMessageFinal` replaces/appends by final event id, preserving previous turns in multi-turn streams.

### Streaming plumbing
- Added: lib/streaming/EventBuilder.ts — builds canonical Event from SSE deltas (text/tool_call/tool_result/reasoning) and toggles reasoning overlay state automatically.
- Added: lib/streaming/eventBuilderRegistry.ts — simple draft map (assistantEventId → Event draft).
- Updated: lib/streaming/frontendEventHandler.ts —
  - Initializes a builder for the current assistant placeholder.
  - Multi-turn: handles `event_start` by appending a new assistant placeholder to the store and creating a new builder.
  - Handles `segment` uniformly for text/tool/reasoning; `event_complete` (no-op); `message_final` commits via builder.
- Removed: lib/streaming/StreamingSessionManager.ts — fully removed; store state now determines streaming status.
- Removed: lib/streaming/streamingBus.ts

### Backend
- app/api/chat/route.ts —
  - Emits `event_start` when an assistant event begins.
  - Emits `segment` for text deltas and finalized tool_call segments (args present) in both initial segment list and streaming updates.
  - Emits `event_complete` before `message_final`, then `complete` and closes.
  - Stops forwarding `code_interpreter_*` SSE events; web_search built-in remains.
  - Incremental persistence for new chats:
    - Persists initial system/user messages immediately upon conversation creation.
    - Persists tool_result events as they occur (both new and continue modes).
    - Persists each assistant event at stream completion; triggers title generation after first assistant save.

### Code interpreter
- UI disabled in components/EventList/BuiltInToolSegment.tsx.
- All handler streaming paths for code interpreter replaced with no-ops.

## Notable Files Added/Removed
- Added: lib/streaming/EventBuilder.ts, lib/streaming/eventBuilderRegistry.ts
- Removed: lib/streaming/streamingBus.ts, components/EventList/StreamingToolsOverlay.tsx, components/EventList/StreamingReasoningSummary.tsx, components/EventList/StepsPanel.tsx, components/Steps/StepsOverlay.tsx, components/EventList/StreamingCodeInterpreter.tsx, hooks/useEventChat.ts

## Back-End Protocol (SSE)
- Added: `event_start`, `segment`, `event_complete`, `complete`
- Kept temporarily: `token`, `tool_start`, `tool_finalized`, `tool_result`, `tool_complete`, `reasoning_*`
- Removed passthrough: `code_interpreter_*`

## Verification Plan
- Anthropic + MCP
  - Tools render inline during streaming; after `tool_result`, model re-invokes; finalizes; no refresh.
  - Multi-turn: 2+ assistant events in one stream; prior turns persist after commit.
- OpenAI Chat (gpt-4o): same as above.
- OpenAI Responses (o-series)
  - Local tool calls → segments flow; remote tools → normal finalize; no regressions.
- New chat mode: behavior unchanged; follow-up PR will add incremental persistence.

## Follow-Ups (not in this PR)
- Migrate web_search built-in to EventBuilder status segments, then drop special-case built-in events.
- Remove legacy SSE events once all clients adopt uniform `segment`/`event_*`.
- Remove StreamingSessionManager entirely or repurpose strictly for store metadata.
- Reintroduce code interpreter later as proper Event segments if needed.

## Risks / Mitigations
- Mixed SSE during transition → EventBuilder consumes both; uniform `segment` emitted.
- Styling drift → gone; streaming drafts and persisted events share the same renderer.
- Residual references → removed/no-op’d; search verified.

## Rollback Plan
- Revert this PR and restore streamingBus-based components/handlers.
- Re-enable `code_interpreter_*` SSE passthrough if needed.

## References
- design/event-rendering-unification.md
- debug/mcp-tool-calling-investigation.md
