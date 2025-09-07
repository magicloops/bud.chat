# Modularization Plan: Bud Chat Core, Providers, Streaming, MCP, and Data

## Goals
- Reduce code surface area in app by extracting stable, testable modules.
- Keep existing functionality: unified events, streaming, tools (MCP + built‑in), model mapping, branching, and persistence.
- Enable independent unit tests and clearer ownership per concern.
- Preserve current UX performance (time‑to‑first‑token) and streaming semantics.

## Non‑Goals
- Rewriting UI or changing API contracts with clients.
- Changing database schema or RLS policies.
- Altering model defaults or provider selections.

## Current State (summary)
- Event model and conversions: `lib/types/events.ts`, `lib/events/*` provide Event/Segment types, `EventLog` transformations to/from providers, `StreamingFormat` for SSE.
- Providers: `lib/providers/unified/*` abstracts OpenAI Chat, OpenAI Responses (o‑series + built‑in tools), and Anthropic with a common `LLMProvider` interface.
- Streaming: Server emits SSE via `app/api/chat/route.ts` using `StreamingFormat`. Frontend assembles a canonical assistant event incrementally via `lib/streaming/eventBuilder.ts` and routes updates with `lib/streaming/frontendEventHandler.ts`.
- Tools: MCP helpers in `lib/mcp/*` and built‑in tool knowledge in `lib/modelMapping.ts` capability flags; API orchestrates tool execution and reinvocation loops.
- Model mapping: `lib/modelMapping.ts` centralizes friendly → API names, provider detection, and capabilities.
- State: `state/*` contains chat store, buds, workspace stores; UI references model mapping helpers directly.

The seams are already clear and amenable to packaging.

## Proposed Workspace Layout
Use pnpm workspaces with internal packages. Keep the Next.js app slim; depend on packages for all business logic.

```
packages/
  events/                # Types + conversions (isomorphic)
  providers/             # Unified provider adapters and streaming
  streaming/             # Streaming protocol + FE builder/handler (split entrypoints)
  mcp/                   # MCP client + config + tool execution helpers
  models/                # Model mapping and capability helpers
  data/                  # DB-facing repositories for conversations/events (Supabase)
```

Update `pnpm-workspace.yaml` to include:

```
packages:
  - packages/*
onlyBuiltDependencies:
  - supabase
```

Keep path aliases in app pointing to packages (or use relative imports initially and migrate aliases once stable).

## Progress Status
- Phase 1 — Events: COMPLETE
  - Implemented `@budchat/events` with `events` (types + EventLog), `EventConverter`, `StreamingFormat`, `types/branded`, and `types/progress`.
  - Updated all imports to use `@budchat/events`.
  - Kept semantics: added `getSystemMessage()` on `EventLog`; preserved `progressState` and `reasoning` fields.

- Phase 2 — Models: COMPLETE
  - Implemented `@budchat/models` and moved `modelMapping` implementation.
  - Updated UI and providers to import from `@budchat/models`.
  - Removed `lib/modelMapping.ts`.

- Phase 3 — Providers: IN PROGRESS (next)
  - Plan: scaffold `@budchat/providers` (re-export of unified providers), flip a key import (`ProviderFactory`) to validate, then move implementations.

## Package Responsibilities and APIs

### 1) @budchat/events
- Contents:
  - `Event`, `Segment`, `ReasoningPart`, `ResponseMetadata` types (from `lib/types/events.ts`).
  - `EventLog` with: `addEvent`, `getEvents`, `getUnresolvedToolCalls`, `toProviderMessages(provider)`, `getSystemMessage()`.
  - Helper creators: `createTextEvent`, `createToolCallEvent`, `createToolResultEvent`.
  - `EventConverter` (from `lib/events/EventConverter.ts`) for provider message arrays → events and vice‑versa.
  - `StreamingFormat` (from `lib/events/StreamingFormat.ts`) for SSE event envelope and parsing.
- Public API: stable, isomorphic, no Next.js or Supabase imports.
- Consumers: `providers`, `streaming`, `data`, Next.js API, UI.

Why: Centralizes the canonical schema and conversions in a lightweight package with excellent unit‑testability.

### 2) @budchat/models
- Contents: `lib/modelMapping.ts` (friendly names, provider detection, capabilities, UI helpers: `getModelsForUI`, `getDefaultModel`, `getModelProvider`, `usesResponsesAPI`, etc.).
- Public API: exported functions only; no React/Next.js dependencies.
- Consumers: UI components, `providers`, API layer.

Why: Single source of truth for models consumed by both app layers and providers.

### 3) @budchat/providers
- Contents: `lib/providers/unified/*` (BaseProvider, OpenAIChatProvider, OpenAIResponsesProvider, AnthropicProvider, ProviderFactory, types) plus `utils/openaiResponsesUtils`.
- Depends on: `@budchat/events` for event types/`EventLog`, `@budchat/models` for model mapping.
- Public API:
  - `LLMProvider` interface, `ProviderFactory.get()` and `.createNew()`.
  - `provider.chat(request)` → `{ event, usage }` and `provider.stream(request)` → `AsyncGenerator<StreamEvent>` (keeps current semantics).
- Config: accept API keys through environment or explicit constructor argument; do not import `process.env` in core logic where avoidable (enable testability).

Why: Encapsulates all vendor idiosyncrasies and keeps app code vendor‑agnostic.

### 4) @budchat/streaming
- Contents:
  - Server: SSE helpers built on `StreamingFormat` (thin wrappers are fine; package remains isomorphic except for stream writers).
  - Client: `EventBuilder`, `frontendEventHandler` (rebroadcasts streaming updates, constructs canonical event), `rendering` helpers, ephemeral overlay registry.
- Entry points:
  - `exports` field exposes `client` and `server` subpaths: `@budchat/streaming/client`, `@budchat/streaming/server`.
- Depends on: `@budchat/events` only.

Why: Formalizes the streaming surface and keeps both sides in sync with a shared envelope and builder logic.

### 5) @budchat/mcp
- Contents: `lib/mcp/*` (client manager, config resolver, streaming handler, message helpers, types).
- Public API: Typed tool listing, execution, and normalization into `tool_result` outputs for events.
- Depends on: `@budchat/core-events` for tool segment IDs and basic types.

Why: Clean boundary around tool execution, enabling local and remote servers with unified error handling.

### 6) @budchat/data
- Contents: repository helpers now inline in API routes:
  - `loadConversationEvents`, `saveEvents` (+ fractional indexing), conversation creation, tool completion persistence.
- Depends on: `@budchat/core-events` types.
- Public API: pure functions that accept a Supabase client (inversion of control) and DTOs; no Next.js imports.

Why: Makes persistence testable and re‑usable across routes/CRON/background jobs.

## API Route Simplification (after extraction)
- `app/api/chat/route.ts` reduces to orchestration:
  - Auth and access checks (stay in route).
  - Fetch bud + overrides via `@budchat/data`.
  - Create `ProviderFactory.get(model)` and invoke `provider.stream()`.
  - For tool calls, delegate to `@budchat/mcp.executeToolCalls()` and persist via `@budchat/data.saveEvents()`.
  - Use `@budchat/events/StreamingFormat` for SSE writes.

The route keeps branching loop and guardrails, while most logic moves to packages.

## Incremental Migration Plan
Migration is staged to minimize churn. Each phase compiles and passes existing flows.

Phase 0: Workspace scaffolding
- Add `packages/*` to `pnpm-workspace.yaml` and create empty package scaffolds with TS configs and build scripts.
- Introduce path alias mapping to packages in app `tsconfig.json` (or keep relative until packages are published/linked).

Phase 1: Extract core events
- Move `lib/types/events.ts`, `lib/events/*` into `packages/core-events` with preserved exports.
- Replace app imports (`@/lib/types/events`, `@/lib/events`) with `@budchat/core-events` via alias.
- Add unit tests for `EventLog.toProviderMessages()`, `getUnresolvedToolCalls()`, `StreamingFormat.parseSSE()`.

Phase 2: Extract model mapping
- Move `lib/modelMapping.ts` → `packages/models` and update imports across app/components/providers.
- Keep function names and behavior unchanged to avoid UI churn.

Phase 3: Extract providers
- Scaffold `@budchat/providers` re-exporting `lib/providers/unified/*`.
- Flip `ProviderFactory` import in Chat API to `@budchat/providers` to validate.
- Move `lib/providers/unified/*` into `packages/providers` with unchanged APIs; update imports across app.
- Inject API keys through constructor options with environment fallback.
- Add tests (mock OpenAI/Anthropic); verify tool-call and reasoning streams.

Phase 4: Extract streaming
- Move `lib/streaming/eventBuilder.ts`, `frontendEventHandler.ts`, `rendering.ts`, overlay registries → `packages/streaming`.
- Expose `client` and `server` entry points; refactor `app/api/chat/route.ts` to import only `StreamingFormat` from `@budchat/events` or `@budchat/streaming/server` (choose one place; prefer events for envelope, streaming/server only for helpers if needed).

Phase 5: Extract MCP
- Move `lib/mcp/*` → `packages/mcp` and expose a single high‑level `executeToolCalls()` that returns normalized `{ id, output, error? }[]`.
- Ensure message helpers for legacy formats remain for any transitional needs.

Phase 6: Extract data repositories
- Move `loadConversationEvents`, `saveEvents`, and conversation creation helpers into `packages/data`.
- Refactor API routes to depend on `@budchat/data` exclusively for DB work.

Phase 7: Cleanups and deprecations
- Delete migrated files from `lib/*` once imports are switched.
- Keep thin re‑exports during transition if large refactors need to land incrementally.

## Testing Strategy
- Core events: unit tests for conversions, deduplication, unresolved tool detection, SSE parsing/formatting.
- Providers: stream fixtures for OpenAI Chat and Responses; assert correct `StreamEvent` emission order for text, tool calls, tool results, reasoning parts.
- Streaming client: deterministic EventBuilder tests for interleaved text and tool segments; reasoning parts incrementally combined and finalized.
- MCP: integration tests hitting the included `test-mcp-server` or a mocked MCP client, validating error surfaces and output normalization.
- Data: repository tests using a local supabase test harness or a typed mock for PostgREST responses; verify unique violation fallback path in `saveEvents` and fractional key ordering.

Keep tests co‑located in each package; ensure packages compile independently.

## Backwards Compatibility and Risk Mitigation
- Preserve all function names and TypeScript shapes exported today.
- Maintain same SSE envelope (`StreamingFormat`) and frontend consumption via `FrontendEventHandler`.
- Provider selection continues to flow through model mapping; Responses API routing for reasoning models unchanged.
- Keep tool execution loop semantics: accumulate unresolved tool calls, execute, persist tool_result events, reinvoke provider until done.
- Add thin re‑exports from old paths during migration if needed to reduce PR size.

## Build and Publishing
- Internal workspace packages (no external publishing required). Use `"type": "module"` and `exports` map with subpath entries for `streaming`.
- Each package ships TS sources or prebuilt ESM to be consumed by Next.

## Coding Conventions for Packages
- No React/Next imports in packages; accept framework objects via function parameters when necessary (e.g., Supabase client instance).
- Avoid reading env vars at import time; read inside constructors or allow DI for testability.
- Keep error types unified via `AppError` at the edges. Optionally move `lib/errors/*` into a lightweight `@budchat/errors` later if sharing is needed across packages.

## Next Steps Checklist
- Create package scaffolds and wire workspace config.
- Phase 1 extraction (core events) with tests; update imports.
- Phase 2 (models) and Phase 3 (providers) extractions; run app, validate streaming + tools.
- Phase 4–6 extractions; iterate with thin re‑exports to minimize churn.
- Document package READMEs with public APIs and examples.

This plan modularizes along natural boundaries already present in the repo, keeps the streaming UX intact, and makes provider, event, MCP, and data logic independently testable and evolvable.
