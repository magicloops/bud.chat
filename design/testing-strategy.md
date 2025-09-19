**Title:** Unified Testing Strategy for Bud Chat & Shared Packages

**Context / Problem**
- Core logic now lives across the monorepo: shared packages (`packages/events`, `packages/providers`, `packages/streaming`, etc.) plus the Next.js app. We lack a cohesive testing approach that validates shared utilities and their integration with the app.
- Recent work (JSON-mode export helpers, provider transforms) requires high confidence that backend and frontend stay in sync, yet there is no regression suite to ensure parity.

**Goals**
- Establish a testing pattern that covers both shared packages and the main application without duplicating effort.
- Provide clear guidance on test types (unit, snapshot, integration) and when to use each.
- Ensure providers and transcript/export code share canonical fixtures so regressions are caught early.

**Non-Goals**
- Build an exhaustive test plan for Supabase migrations or browser E2E flows (covered elsewhere).
- Replace existing manual QA flows; this strategy complements them.

---

**Test Layers**
1. **Unit & Snapshot Tests (Packages)**
   - Location: `packages/<name>/__tests__/*` 
   - Tooling: Jest (transform via ts-jest or swc-jest) scoped to individual packages.
   - Targets:
     - `packages/events/src/transforms`: snapshot provider conversions using canned event fixtures; verify both request shaping and response reconstruction stay stable.
     - `packages/providers/src/unified`: mock SDK responses, ensure adapters wrap shared transforms correctly (minimal tests; rely on shared module snapshots whenever possible).
     - `packages/streaming`: deterministic state-machine tests for streaming event builders.
   - Strategy: share fixtures via `packages/events/__tests__/fixtures/` so providers and transcript helpers consume identical data.

2. **Integration Tests (App + Packages)**
   - Location: `app/__tests__/` (or `tests/` at repo root) running Jest with Next.js testing utilities (or Vitest + `@testing-library/react` if preferred).
   - Targets:
     - JSON mode transcript builder + generator pipeline: verify reconstructed payloads feed generators without drift.
     - API routes that wrap provider adapters (mock Supabase, use recorded events to ensure SSE outputs align).
   - Use dependency injection/mocking to substitute provider classes with deterministic versions (leveraging shared fixtures).

3. **Contract Tests (Optional / Future)**
   - For critical provider interactions (OpenAI/Anthropic), consider MSW-based contract tests that simulate provider payloads to validate streaming pipelines end-to-end.
   - Run selectively (CI nightly) due to cost/time.

---

**Fixture Strategy**
- Centralize conversation/event fixtures under `packages/events/__tests__/fixtures`:
  - `basicTextConversation.json`
  - `toolCallConversation.json`
  - `responsesReasoningConversation.json`
  - `anthropicToolConversation.json`
- Each fixture includes:
  - `events`: canonical event array
  - `providerOutputs`: expected provider payloads per target (OpenAI Chat, Responses, Anthropic)
  - `notes`: edge cases (reasoning, tool errors)
- Shared transforms, provider adapters, transcript builder, and generators import fixtures to validate parity.

---

**Tooling Setup**
- Add a base Jest config per package (or a shared root config referencing per-package roots).
- Use `tsup`/`tsconfig` paths to keep component imports clean during tests.
- Provide a `pnpm test` workspace script that iterates packages (`pnpm -r --filter @budchat/events test`).
- For app-level tests, configure Next.js Jest setup (existing `@testing-library` infrastructure or add if missing).

---

**Implementation Steps**
1. Scaffold Jest in `packages/events` with initial snapshot tests for `openaiChat`, `openaiResponses`, `anthropic` transforms (install dev deps via `pnpm add -D jest ts-jest @types/jest`).
2. Add fixtures capturing representative conversations; assert shared transforms match expected provider payloads.
3. Update transcript builder tests to reuse fixtures, ensuring reconstructed request/responses align with snapshots.
4. Create app-level integration test exercising JSON mode generation using fixtures (mock providers; ensure generated code references correct payloads).
5. Document testing commands in README, include CI workflow to run package + app tests.

---

**Open Questions**
- Should we introduce Vitest for faster package tests or standardize on Jest across the repo?
- Do we need separate lint-type checks ensuring fixture parity (e.g., diff between backend call payloads and transcript output) or are snapshots sufficient?
- How to manage provider version updates that change responses (versioned snapshots vs. dynamic assertions)?

**Risks**
- Snapshot overuse can lead to brittle updates; mitigate by focusing on key payload fields or using structured assertions.
- Running package tests per commit increases CI time; leverage selective filters (`pnpm -r --filter ...`) to scope based on touched files.

---

**Next Steps**
- Align on Jest vs. Vitest for packages; configure base testing harness.
- Implement first snapshot tests for shared transforms using the planned fixtures.
- Extend integration tests to cover JSON mode exports once helpers stabilize.
