# Modularization: Package READMEs + Root README refresh

## Summary
This PR advances the ongoing modularization by documenting each new internal package and refreshing the root README to reflect the package-based architecture. No functional changes are introduced here beyond docs—code examples remain in package READMEs per guidance.

## Why
- Make the modular boundaries explicit for contributors and reviewers.
- Provide quick references for package responsibilities and APIs.
- Ensure the root README reflects current reality (packages, pnpm, SSE, provider abstraction).

## Changes
- Root README replaced with a concise overview and links to package docs.
- Added package-specific READMEs:
  - `packages/events/README.md` — unified Event/Segment model, EventLog, provider conversions, SSE envelope.
  - `packages/models/README.md` — friendly→API mapping, provider detection, capabilities.
  - `packages/providers/README.md` — unified provider layer (OpenAI Chat/Responses, Anthropic), streaming surface, factory.
  - `packages/streaming/README.md` — EventBuilder, registries, rendering helpers, SSE processing (server/client entries).
  - `packages/data/README.md` — Supabase repositories for events/conversations, ordering and retries, timing updates.

## Package responsibilities (high-level)
- `@budchat/events`: Canonical event schema and conversions (`EventConverter`, `StreamingFormat`).
- `@budchat/models`: Model mapping, provider detection, and capability helpers used across UI and providers.
- `@budchat/providers`: OpenAI (Chat + Responses) and Anthropic adapters behind `LLMProvider` + streaming.
- `@budchat/streaming`: Client/server streaming primitives (`EventBuilder`, SSE iterator/dispatcher, render helpers).
- `@budchat/data`: Supabase repositories for loading/saving events and conversations, with ordering and fallback.

## Files touched (docs only in this PR)
- `README.md` (replaced; links to packages)
- `packages/events/README.md` (new)
- `packages/models/README.md` (updated from scaffold)
- `packages/providers/README.md` (new)
- `packages/streaming/README.md` (new)
- `packages/data/README.md` (new)

Note: The branch also contains the previously-reviewed code moves for modularization (packages added, legacy `lib/*` removals, and import updates). This PR description focuses on the documentation layer added on top of that work.

## Backward compatibility
- Documentation‑only changes. No runtime behavior or API contracts altered in this PR.

## How to test
- Open the root `README.md` and verify links to package docs resolve.
- Skim each package README for:
  - Clear responsibility statement
  - Short API overview
  - Example usage where relevant (kept inside package docs)

## Risks / Rollback
- Low risk (docs only). Rollback by reverting the README changes.

## Follow-ups
- Add a short "Contributing/Development Guidelines" section to root README pointing to `CLAUDE.md` and `AGENTS.md`.
- Expand package READMEs with API surface tables once stabilization lands for `@budchat/mcp` extraction.

## References
- `design/modularization-plan.md`
- `packages/events/README.md`
- `packages/models/README.md`
- `packages/providers/README.md`
- `packages/streaming/README.md`
- `packages/data/README.md`

