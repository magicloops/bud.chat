Title: Cross‑provider streaming + persistence regressions after modularization — upstream hypotheses

Scope
- All providers affected in some way:
  - OpenAI Chat Completions: assistant responses not persisted reliably; multiple iterations; sometimes no ‘done’.
  - OpenAI Responses (+ remote MCP): multiple iterations; persistence missing if ‘done’ not seen.
  - Anthropic: no visible streaming to FE and not saving.

Key integration points (upstream)
1) ProviderFactory → provider.stream(request)
2) Chat route stream loop → SSE emission + DB persistence
3) EventLog unresolved accounting → outer iteration control

Observations and hypotheses

P1) OpenAI Chat provider: missing ‘done’ yield in stream()
- Code: packages/providers/src/unified/OpenAIChatProvider.ts: stream() iterates chunks, but never yields `{ type: 'done' }` nor returns a terminal signal after the `for await` loop.
- Effect: Chat route never hits its ‘done’ case; no DB save; outer loop may continue if error path triggers.
- Validation: Instrument Chat route to log when ‘done’ case runs for openai‑chat. Compare to provider logging to see end of stream.
- Fix: Provider should yield `{ type: 'done' }` and/or return after the loop, and possibly emit a final `{ type: 'event_complete' }` if we want explicit completion semantics.

P2) Anthropic provider: placeholder stream emits empty event then ‘done’ only
- Code: packages/providers/src/unified/AnthropicProvider.ts: stream() yields an empty assistant event followed by ‘done’; chat(request) is implemented but stream is not.
- Effect: No segments stream to FE; DB may save an empty assistant event but perceived as “not streaming” and potentially filtered upstream.
- Validation: Confirm Chat route receives the ‘event’ then ‘done’. If we see the ‘done’ path run, DB should save; if not, see P4.
- Fix: Implement real streaming via Anthropic SDK streaming iterator or keep chat() path for non‑streaming fallback (and ensure Chat route supports non‑streaming path properly).

P3) OpenAI Responses: ‘done’ not emitted in some flows
- Code: packages/providers/src/unified/OpenAIResponsesProvider.ts: stream sets `streamCompleted = true` and yields `{ type: 'done' }` on certain events (e.g., response.output_text.done). If those events don’t surface (e.g., tool‑only paths), ‘done’ may never be yielded.
- Effect: Chat route waits; fallback path may trigger; DB save not in fallback currently.
- Validation: Log transformed events for last 3 items; verify if any ‘response.completed’ mapping exists (and ensure transform yields done in that case). Confirm stream termination without done.
- Fix: Ensure transformOpenAIReasoningEvent maps ‘response.completed’ to a terminal signal the provider stream recognizes to yield ‘done’.

P4) Chat route error catch path doesn’t stop outer loop
- Code: app/api/chat/route.ts: within the ReadableStream `start`, the catch block after the provider loop enqueues SSE error and closes the controller but does not set `iteration = maxIterations` nor `return`.
- Effect: Outer while continues to next iteration even though the stream is closed; repeated ‘Iteration N/30’ logs.
- Validation: Add a log in the catch; observe subsequent iteration logs.
- Fix: In catch, set `isClosed = true`, `iteration = maxIterations`, and `return` (and likely avoid emitting any further SSE afterwards).

P5) Current event null / persistence path coupling only to ‘done’
- Code: The ‘done’ case saves `currentEvent`. If provider did not yield ‘event’ (or it was nulled when handling ‘event_complete’), persistence is skipped.
- Effect: No DB save.
- Validation: Log `!!currentEvent` when entering 'done'. Ensure provider stream always yields an initial ‘event’ before any segments (OpenAI Chat: yes; Anthropic: placeholder does; Responses: code sets hasStarted to yield event).
- Fix: Ensure providers always yield `{ type: 'event', data: { event } }` first. If not, defensively reconstruct from stream state before saving.

P6) EventLog unresolved accounting edge cases cause continued iterations
- Code: packages/events/src/events.ts: getUnresolvedToolCalls now ignores `server_type === 'remote_mcp'` and treats inline output/error as resolved.
- Risk: Some remote tool_call segments may lack `server_type` but have `server_label` (still remote). These could be miscounted as unresolved.
- Validation: Log unresolved with segment snapshots to confirm fields.
- Fix: Expand remote heuristic: consider `server_label` present (non‑empty) as remote if `server_type` absent.

P7) SSE handshake and event order expectations
- Code: Chat route expects ‘event’ first (emit event_start), then ‘segment’ updates, then ‘done’ (emit message_final + done, save to DB).
- Risk: Providers that emit ‘segment’ without ‘event’ first can cause `currentEvent` to remain null.
- Validation: Add guard logs when a ‘segment’ arrives with no currentEvent; count occurrences.
- Fix: In that case, create a new `currentEvent` immediately.

P8) Persistence splitting between stream and done
- Code: Tool results are saved incrementally during the stream; the assistant event is saved only on ‘done’.
- Risk: If ‘done’ is missed, assistant event is never saved even though the client saw streaming text.
- Validation: Check that the assistant event was present in EventLog at stream end.
- Fix: Save assistant event in both ‘done’ and fallback paths (after verifying it represents the final state).

P9) Package stream contracts regressed from previous lib behavior
- Code: Legacy lib providers likely always yielded an explicit terminal (‘done’), and Anthropic stream had real streaming. The package versions diverged (Chat missing ‘done’, Anthropic not streaming).
- Validation: Compare old lib/unified providers behavior (git history) with package versions and align contracts.
- Fix:
  - OpenAIChatProvider.stream: add final ‘done’ yield.
  - AnthropicProvider.stream: implement streaming or make chat() the code path used.
  - Responses: ensure mapping emits a terminal event reliably (map response.completed).

P10) Route’s DB save path requires ‘done’, but some providers are non‑streaming
- Code: For non‑streaming chat() path (Anthropic chat), persistence happens upstream (route handles UnifiedChatResponse). For stream path, persistence only happens on ‘done’.
- Risk: If a provider switches from chat to stream with no terminal signal, persistence breaks.
- Validation: Verify which path is used by providers for given models.
- Fix: Standardize provider stream contracts or let the route detect non‑terminal stream end and persist.

Instrumentation plan (minimal)
- In route: mark when entering ‘done’, when fallback triggers, whether `currentEvent` exists, and log unresolved summary per iteration.
- In providers: log first yield ‘event’ and terminal yield ‘done’ per provider (guarded by env flag).

Implementation plan (after confirming logs)
1) OpenAIChatProvider.stream: add ‘done’ at end.
2) Responses mapping: ensure response.completed maps to terminal → provider yields ‘done’.
3) Chat route catch: stop outer loop on exceptions.
4) Chat route fallback: persist currentEvent and order key, then emit done.
5) EventLog unresolved: treat tool_call with server_label as remote when server_type is absent.
6) Anthropic stream: implement or route to chat() for non‑streaming, but ensure the route handles this consistently.

