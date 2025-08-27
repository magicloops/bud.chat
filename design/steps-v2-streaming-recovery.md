# Steps v2 + Streaming Recovery Plan

## Context
- Primary goals:
  - Fast chat with time-to-first-token, minimal re-renders, and branching.
  - Support OpenAI and Anthropic; both legacy Chat Completions and newer Responses API (GPT‑5, o‑series).
  - Persist unified event model: each assistant “event” can contain multiple segments (reasoning parts, tool calls/results, text).
  - Buds: reusable configs (model, system prompt, greeting, name/avatar, tool settings incl. MCP and built‑ins). `/chat/new?bud=…` renders optimistically; DB is created later and URL swaps to `/chat/[id]` without visible re-render.

## What Changed In This PR (high‑level)

Frontend (rendering)
- `components/EventList/EventItem.tsx`
  - Inserted unified steps UI above message text: `StepsOverlay` during streaming; `StepsDropdown` after completion.
  - Added `StreamingTextSegment` use to render live tokens from `streamingBus` (for `/chat/new` optimistic flow).
  - Suppressed legacy inline “Reasoning section” and “Tool call display” blocks by gating with `{false && …}` (kept code for now to minimize churn).
  - Minor imports cleanup (restored `Badge` when gating still referenced it).
  - Ensured both “continuation view” and “regular view” show steps before text.

- `components/EventList/SequentialSegmentRenderer.tsx`
  - Hidden reasoning/tool/built‑in tool segments (they’re surfaced via unified steps UI elsewhere).
  - Still renders text segments; added steps overlay/dropdown after content (risk of duplication if used alongside `EventItem`).

- `components/EventList/StreamingTextSegment.tsx`
  - Fixed logic so typing indicator shows while text is empty during streaming; otherwise render streamed text.

- `components/Steps/StepsOverlay.tsx`, `components/Steps/StepsDropdown.tsx`
  - Use `streamingBus` reasoning/code channels; detect active web search.
  - No breaking changes, just used more broadly.

Backend (SSE)
- `app/api/chat/route.ts`
  - Introduced `send()` and `sendSSE()` helpers with an `isClosed` guard to avoid enqueueing after `controller.close()`.
  - Switched several direct `controller.enqueue` calls (not all) to the safe helpers; updated `done` branch to send via helper then close and mark closed.

Support
- `lib/flags.ts` (removed) — the v2 steps flag was dropped per request.

## Regressions / Symptoms Observed
- Simple chats breaking after these changes (even without tools): user reports general failure.
- Web search flow threw: “Invalid state: Controller is already closed” from `app/api/chat/route.ts` in built‑in tool event branch.
- Before fixes, new chats required a refresh to see streaming text (text appended to `streamingBus` but UI used static `textContent`).
- Potential duplicate steps UI if both `EventItem` and `SequentialSegmentRenderer` are used on the same path.
- Legacy reasoning/tool UI still in file (gated by `false`) increasing complexity and risk of reintroduction.

## Likely Root Causes
1) SSE lifecycle
   - Mixed usage of raw `controller.enqueue` and new safe `send()` helpers means late provider emissions may still hit a closed controller.
   - Closing the stream in `done` and continuing to iterate provider events (or tool events arriving very late) can trigger errors unless all enqueues are guarded.

2) Rendering pipeline divergence
   - `/chat/new` optimistic flow pushes tokens to `streamingBus` only; `event.segments` don’t include token text until finalize.
   - Any renderer that only reads `textContent` from segments won’t display live tokens; must use `StreamingTextSegment` for new chats.

3) Duplication and ordering
   - Steps UI added in `EventItem` and also in `SequentialSegmentRenderer` can double-render.
   - Steps in some code paths were appended under the text (ordering mismatch) until adjusted.

4) Legacy UI remnants
   - Gated legacy reasoning/tool UIs create import/dependency clutter and complicate reasoning about what renders.

## Strategy To Stabilize

Short‑term (restore working baseline + keep steps v2)
- SSE safety
  - Option A (minimal): Wrap all remaining `controller.enqueue` calls with `send()`/`sendSSE()` and mark `isClosed = true` immediately after any `controller.close()` to avoid races.
  - Option B (rollback): Revert `route.ts` to last known-good and reapply the guard comprehensively in a follow‑up. Recommendation: Option A, but applied consistently in one pass.

- Rendering ownership
  - Make `EventItem` the sole owner of Steps UI. Remove Steps overlay/dropdown from `SequentialSegmentRenderer` to avoid duplicates.
  - In `EventItem`, always render steps before text (both “continuation” and “regular” views). Confirm only one instance per message.
  - For streaming text: use `StreamingTextSegment` only while `isStreaming`; otherwise render static markdown from `textContent`.

- New chat streaming
  - Confirm `frontendEventHandler`’s assistant placeholder id matches `EventItem`’s `event.id` so `StreamingTextSegment` and `StepsOverlay` receive the correct bus keys.
  - Ensure `/chat/new → /chat/[id]` silent URL swap does not remount the message list. Verify Zustand state prevents re-renders (no new arrays/objects in selectors).

- Legacy UI cleanup (low‑risk)
  - Delete the false‑gated legacy reasoning/tool blocks (not just hide). This reduces import churn and accidental re‑enablement.
  - Keep their logic available in git history; document the replacement (Steps v2) here.

Medium‑term (refactor for clarity + robustness)
- Steps composition
  - Centralize step composition in one util (`computeStepsForEvent`) to merge reasoning parts + all tool calls/results by `sequence_number`/`output_index`.
  - Ensure the same order and grouping are used by both overlay (streaming) and dropdown (finalized) with minimal branching.

- Rendering coherence
  - `SequentialSegmentRenderer`: restrict to content segments only (text). No steps UI. This turns it into a pure text renderer that is easy to reason about.
  - `EventItem`: orchestrates steps + text + errors + menus.

- SSE contract
  - Normalize server events into a small set consumed by the frontend event handler:
    - `event_start`, `token`, `reasoning_*`, `tool_start/finalized/result/complete`, built‑in tools (`web_search_*`, `code_interpreter_*`), `done`, `error`.
  - Ensure all events use the safe send wrappers and never enqueue after close.

- Performance hooks
  - Audit re-render hot paths (Zustand selectors, prop drilling). Use shallow compare and avoid inline array/object creation in selectors.
  - Keep streaming updates off the main store via `streamingBus` (already done for tokens/reasoning/code) to minimize React updates.

## Concrete Fix Plan (proposed order)
1) Server SSE guard (route.ts)
   - Replace all remaining raw `controller.enqueue` with `send()`/`sendSSE()`.
   - After any `controller.close()`, set `isClosed = true` so further sends are no-ops.
   - Add a comment at top of stream: “Never call controller.enqueue directly — use send()/sendSSE().”

2) Renderer ownership
   - Remove Steps overlay/dropdown from `SequentialSegmentRenderer.tsx` (keep hiding of reasoning/tool segments).
   - Verify only one steps block per message in `EventItem.tsx` (both views) and that it renders before the text.

3) Streaming text path
   - Keep `StreamingTextSegment` in `EventItem` for `isStreaming`.
   - Confirm assistant placeholder id wiring (frontendEventHandler → store → EventItem) so bus keys align.

4) Legacy code removal
   - Delete the `{false && …}` legacy reasoning/tool UI blocks and their now-unused imports.

5) URL handoff stability
   - Verify `/chat/new → /chat/[id]` silent swap does not remount the list; if needed, memoize list and item rows keyed by stable ids.

6) Test matrix
   - New chat (OpenAI Chat Completions): text only; text + web search (built‑in tool).
   - New chat (OpenAI Responses, e.g., o‑series): reasoning + text; with web search; with MCP.
   - New chat (Anthropic): reasoning + text; with MCP.
   - Existing conversation continuation for all above.
   - Ensure steps ordering by `sequence_number`/`output_index` across providers.

## Areas For Improvement
- Centralized model mapping already exists; ensure provider detection drives the streaming shape (Responses vs ChatCompletions) consistently.
- Unify built‑in tool events format at the server boundary; avoid spreading format knowledge across frontend components.
- Stronger unit tests for `frontendEventHandler` mapping to local/store state + `streamingBus` (especially late/lost events and done/close race conditions).
- Consider a dev-only “unstable features” toggle inside a single module (not env) to guard major UI refactors during iteration without leaking to prod builds.

## Next Steps (confirm before implementation)
- Do you want me to:
  1) Apply the server-side SSE guard comprehensively in `route.ts` now?
  2) Remove steps UI from `SequentialSegmentRenderer.tsx` and keep it only in `EventItem.tsx`?
  3) Fully delete legacy reasoning/tool UI blocks (instead of false‑gating) to simplify `EventItem.tsx`?
  4) Add a quick debug log gate to verify assistant placeholder ids align with EventItem’s event ids during `/chat/new` streaming?

Once agreed, I’ll implement the minimal, surgical fixes in that order and verify streaming for simple chats, web search, and reasoning flows.

