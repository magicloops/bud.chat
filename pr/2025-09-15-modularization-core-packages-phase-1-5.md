# Modularization: Core Packages (Events, Models, Providers, Streaming, Data) — Phases 1–5

## Summary
Extracted stable internal libraries into workspace packages and updated the app to depend on them. This preserves the unified event model, streaming semantics, tool calling, and model mapping while substantially clarifying ownership and enabling independent evolution/testing. Based on the up‑to‑date design: `design/modularization-plan.md`.

## Goals
- Reduce app surface area; move business logic to packages.
- Keep existing behavior: unified events, streaming, tools (MCP + built‑ins), model mapping, branching, and persistence.
- Enable clearer ownership and unit tests per concern.
- Preserve streaming UX (time‑to‑first‑token) and SSE protocol.

## Packages Introduced
- @budchat/events — Canonical Event/Segment model, branded IDs, EventLog, provider conversions, StreamingFormat (SSE envelope).
- @budchat/models — Friendly→API model mapping, provider detection, capability helpers.
- @budchat/providers — Unified provider layer (OpenAI Chat, OpenAI Responses, Anthropic) + streaming.
- @budchat/streaming — EventBuilder, registries, rendering helpers, SSE iterator/dispatcher (client/server entries).
- @budchat/data — Supabase repositories for conversations and events (ordering, retries, timing updates).

## Key Changes
- Events (Phase 1 — COMPLETE)
  - Added `@budchat/events` with types (`events.ts`, `types/branded`, `types/progress`), `EventLog`, `EventConverter`, and `StreamingFormat`.
  - Updated provider conversions; added `getSystemMessage()` on EventLog.
- Models (Phase 2 — COMPLETE)
  - Added `@budchat/models`; moved model mapping and capability helpers. All app/components/providers import from package.
- Providers (Phase 3 — COMPLETE)
  - Added unified implementations: `OpenAIChatProvider`, `OpenAIResponsesProvider`, `AnthropicProvider`, shared `BaseProvider`/`OpenAIBaseProvider`, and `ProviderFactory`.
  - Streaming fixes and parity:
    - Responses (o‑series): overwrite final assistant text from `response.output_item.done` (authoritative provider text) to avoid duplication; removed route‑side text assembly for OpenAI providers.
    - Embedded remote MCP tool results in originating `tool_call` segment; normalized MCP events and removed duplicate `tool_start`s.
- Data (Phase 4 — IN PROGRESS)
  - Added `@budchat/data` with repo helpers: `loadConversationEvents`, `saveEvents` (unique‑violation fallback), `saveEvent`, `getLatestEvent`, `getLastOrderKey`, `updateEventSegments`, `updateToolSegmentTiming`, `updateReasoningSegmentTiming`, and utilities.
  - API routes now use these helpers for DB I/O.
- Streaming (Phase 5 — IN PROGRESS)
  - Added `@budchat/streaming` primitives: `EventBuilder`, `eventBuilderRegistry`, `ephemeralOverlayRegistry`, `rendering`, `sseIterator`/`processSSE`.
  - UI imports updated; `FrontendEventHandler` remains app‑scoped but delegates parsing to `processSSE` and uses package `EventBuilder`.
- Documentation
  - Root `README.md` refreshed to reflect package architecture and link to package docs.
  - Added/updated package READMEs with responsibilities and examples.

## Files Touched (high‑level)
- Added packages: `packages/events/*`, `packages/models/*`, `packages/providers/*`, `packages/streaming/*`, `packages/data/*`.
- Removed legacy libs now provided by packages: `lib/types/* (events/branded/progress)`, `lib/modelMapping.ts`, `lib/providers/unified/*`, `lib/events/*`, streaming primitives moved to `packages/streaming`.
- API routes and components updated to import from new packages.
- Workspace config: `pnpm-workspace.yaml` includes `packages/*`.

## Backward Compatibility
- Preserves existing function names and types exported publicly.
- SSE envelope unchanged (`StreamingFormat`), consumed by `FrontendEventHandler` via `@budchat/streaming`.
- Provider selection still flows through `@budchat/models`; Responses routing for reasoning models unchanged.
- Tool loop semantics preserved: unresolved tool calls gathered, executed, persisted, and reinvoked until done.

## Risk & Mitigations
- Import churn: mitigated with aligned package exports and updated imports across app.
- Streaming integrity: added overwrite of final text for Responses; single source of truth for Chat; SSE iterator hardened against partial lines.
- DB ordering conflicts: `saveEvents` uses fractional indexing and retries on `23505` unique violations.
- RLS/permissions unchanged; no schema changes in this PR.

## How to Test
- Providers
  - Test OpenAI Chat and Responses streaming in UI; verify no duplicate assistant text persists.
  - Validate tool calling: local MCP (if enabled) and remote MCP through Responses; outputs embedded in `tool_call`.
- Events
  - Verify system prompts pass correctly (Anthropic `system` param; OpenAI Chat message array).
  - Confirm unresolved tool detection returns only pending calls.
- Streaming
  - Confirm incremental rendering via EventBuilder (reasoning parts, text, tools) and stable steps display.
- Data
  - Start a conversation; persist streamed assistant events; check order keys increase; retry path on unique violation works (logs only, if any).

## Migration Notes
- Use pnpm. Run `pnpm install` and `pnpm run dev`.
- Ensure provider keys are set in `.env.local`.
- No DB migrations required for this PR.

## Follow‑ups
- Phase 6 — MCP: extract tool execution (local/remote) into `@budchat/mcp` with a single `executeToolCalls()` surface.
- Finalize extracting `FrontendEventHandler` into `@budchat/streaming` once store coupling is reduced.
- Add unit tests in each package (events conversions, streaming iterator, provider fixtures, data repo).
- Logging policy: keep error + turn summary behind env flag; drop info logs by default.

## References
- design/modularization-plan.md (authoritative plan and recent updates)
- packages/* READMEs for responsibilities and examples

