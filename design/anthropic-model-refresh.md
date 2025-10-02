# Anthropic Model Catalog Update Plan

## Goal
Refresh our Anthropic offerings to match the latest catalog (Opus 4.1/4, Sonnet 4, Sonnet 3.7, Haiku 3.5) while keeping existing Buds and conversations functional. Any persisted reference to a retired model must transparently fall back to `claude-sonnet-4-0` when we build provider payloads.

## Current State
- `packages/models/src/modelMapping.ts` exposes friendly model aliases such as `claude-3-5-sonnet` → `claude-3-5-sonnet-20241022` and drives `getModelsForUI`, `getApiModelName`, capabilities checks, and defaults across the app.
- Bud settings, conversations, MCP configs, and exports persist the friendly alias only; `getApiModelName` converts it to the provider-specific model id at request time.
- Tests and docs (e.g., `CLAUDE.md`, `design/*`, fixtures in `lib/exports/__tests__`) assert against the current alias set.

## Proposed Changes
1. **Introduce the new Anthropic aliases** in `MODEL_MAPPING` and `MODEL_CAPABILITIES`:
   - `claude-opus-4-1` → `claude-opus-4-1-20250805`
   - `claude-opus-4-0` → `claude-opus-4-20250514`
   - `claude-sonnet-4-0` → `claude-sonnet-4-20250514`
   - `claude-3-7-sonnet-latest` → `claude-3-7-sonnet-20250219`
   - `claude-3-5-haiku-latest` → `claude-3-5-haiku-20241022`
   (carry forward capability flags from the closest prior generation, updating any differences noted in Anthropic release notes if applicable.)

2. **Retire the old aliases from UI surfacing** by removing them from `MODEL_MAPPING` so they no longer appear in selectors/export templates. Update guidance in `CLAUDE.md`, automation scripts, and tests to reference the new friendly names.

3. **Add a graceful fallback path** for persisted data that still references the legacy aliases (`claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`). Options:
   - Extend `getApiModelName` to translate any legacy alias to `MODEL_MAPPING['claude-sonnet-4-0']` before returning an API id.
   - Alternatively, keep a `DEPRECATED_ANTHROPIC_ALIASES` map (legacy → `claude-sonnet-4-0`) and re-route both `getApiModelName` and capability lookups through it so downstream helpers (exports, UI badges) stay consistent.
   - Ensure exports/transcripts reuse the resolved alias, so regenerated code samples use `claude-sonnet-4-0` instead of the legacy name.

4. **Guard UI state derived from legacy models** by normalizing conversation/bud models when loading into Zustand stores or React context (relying on the same alias fallback helper) so the UI never attempts to render an option that no longer exists.

5. **Update automated coverage**:
   - Refresh fixtures in `lib/exports/__tests__`, `packages/events` transforms, and any snapshot data to use the new aliases/API IDs.
   - Add unit coverage for the fallback mapping (e.g., expect `getApiModelName('claude-3-5-sonnet')` to return `claude-sonnet-4-20250514`).

6. **Documentation & tooling clean-up**: revise CLAUDE-specific docs, scripts in `scripts/`, and design references so developers adopt the new aliases; highlight the fallback behavior and default choice (`claude-sonnet-4-0`).

## Open Questions
- Do any capabilities (reasoning effort levels, built-in tools) change between the new releases and the previous generation? If so, we need updated capability metadata from Anthropic before shipping.
- Should `getDefaultModel()` change for Anthropic-only workspaces (e.g., if a Bud previously defaulted to `claude-3-5-sonnet`)? If yes, codify the new default alias per workspace profile.

## Next Steps
1. Implement the mapping + fallback helpers and adjust related utilities.
2. Update fixtures/tests/docs to the new aliases.
3. Smoke-test Bud creation, conversation replay, JSON exports, and MCP configs selecting each new model.
4. Coordinate with product/docs to announce the new model lineup and the automatic migration behavior.
