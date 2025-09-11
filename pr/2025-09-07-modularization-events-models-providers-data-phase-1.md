# Modularization: Events, Models, Providers, and Data (Phase 1–3 complete; Phase 4 in progress)

## Summary
This PR modularizes core subsystems into internal workspace packages to reduce app complexity, enable targeted testing, and make future iteration safer and faster. We finished extracting events, models, and providers; we’ve kicked off data extraction and rewired the main chat API to use repository helpers.

## Goals
- Shrink app/API route complexity via focused libraries.
- Standardize cross-cutting types and streaming protocols.
- Preserve behavior (including SSE semantics, reasoning streams, MCP tools) while improving testability.

## Packages Introduced
- `@budchat/events` (new)
  - Canonical Event/Segment types, EventLog, StreamingFormat, EventConverter.
  - Preserves `progressState` and `reasoning` fields; adds `EventLog.getSystemMessage()`.
- `@budchat/models` (new)
  - Model mapping + capabilities. Adds `supportsTemperature()` helper.
- `@budchat/providers` (new)
  - Unified providers (OpenAI Chat, OpenAI Responses, Anthropic, Base, ProviderFactory).
  - Moved Responses streaming utils into package; legacy file removed.
- `@budchat/data` (new, Phase 4 in progress)
  - Conversation/event repo helpers: `loadConversationEvents`, `saveEvents`, `createConversation`, `getPostgrestErrorCode`.

## Key Changes
- Events
  - All imports now use `@budchat/events`.
  - Streaming envelope consolidated in `StreamingFormat` (still used by API route).
- Models
  - Moved `lib/modelMapping.ts` → `@budchat/models`.
  - Updated UI and providers to import from the package; removed legacy file.
- Providers
  - Implementations migrated under `@budchat/providers/src/unified`.
  - `OpenAIResponses` utils physically moved into package and exported; `lib/providers/unified/utils/openaiResponsesUtils.ts` deleted; legacy provider imports now target `@budchat/providers`.
  - API routes updated to import `ProviderFactory` from `@budchat/providers`.
- Data
  - Added `@budchat/data/src/chatRepo.ts`; rewired `app/api/chat/route.ts` to use `loadConversationEvents`, `saveEvents`, `createConversation`, `getPostgrestErrorCode`.

## Files Touched (high-level)
- Added: `packages/events/*`, `packages/models/*`, `packages/providers/*`, `packages/data/*`.
- Updated: `app/api/chat/route.ts` (uses `@budchat/providers`, `@budchat/data`), multiple imports across repo now target `@budchat/events` & `@budchat/models`.
- Removed: `lib/modelMapping.ts`, `lib/providers/unified/utils/openaiResponsesUtils.ts`.

## Backward Compatibility
- Streaming protocol and SSE events unchanged; `EventBuilder`/UI continue to render existing segments.
- Reasoning and MCP built-in tool streaming preserved via migrated utils.
- Model selection logic unchanged (centralized in `@budchat/models`).

## How to Test
- Dev build: `pnpm dev` / `pnpm build`.
- Chat flows
  - OpenAI Chat models: send messages, tool-calls stream correctly.
  - Reasoning models (o-series, gpt‑5 family): verify reasoning parts + built-in tools stream and render.
  - Anthropic: non-streaming message returns text.
- New conversation: ensure conversation creation and initial events persist; TTFB unaffected.
- Tool execution: MCP tool results emit as `tool_result`, follow-up turn re-invokes; finalizes.

## Risk & Mitigations
- Type drift between packages (ActivityType, branded IDs): unified by importing from `@budchat/events` where applicable.
- SDK union types (Anthropic/Responses streaming): guarded casts + defensive checks added.
- Responses utils: physically moved to providers package to avoid cross-boundary coupling.

## Follow-ups / TODOs
- Data (Phase 4)
  - Extract remaining DB helpers into `@budchat/data`:
    - Tool timing persistence (mark tool_call segment started/completed).
    - `updateEventSegments`, `getLatestEvent`, `getEventCount`, `getEventsByRole/TimeRange`.
  - Update other routes to use `@budchat/data` as needed.
- Streaming (Phase 5)
  - Extract `EventBuilder`, `frontendEventHandler`, `rendering` into `@budchat/streaming` (client/server entry points); keep StreamingFormat in `@budchat/events` (or re-export server helpers).
- Docs
  - Update CLAUDE.md and design notes to point to `@budchat/events`, `@budchat/models`, `@budchat/providers`, `@budchat/data`.
- Tests
  - Add targeted unit tests per package (EventLog conversions, Responses transformer, provider stream adapters, repo helpers with mock Supabase).

## Migration Notes
- `pnpm-workspace.yaml` updated to include packages/*.
- `next.config.mjs` `transpilePackages`: `@budchat/events`, `@budchat/models`, `@budchat/providers`, `@budchat/data`.
- Package imports flipped incrementally; legacy files re-exported or removed to avoid breakage.

