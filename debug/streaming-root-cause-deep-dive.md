# Streaming Root-Cause Deep Dive

Status: in-progress

Goal: Identify why client-side token streaming becomes extremely slow (≈1.2s per token) even after the server has finished sending the SSE response, leading to unresponsive tab warnings for large responses.

This doc maps the full path from server emission to UI paint, enumerates hypotheses, and proposes focused instrumentation to locate the bottleneck precisely.

---

## Symptom Recap

- Tokens appear on the client at ~1.2s cadence, sometimes taking minutes to render a single assistant message.
- Chrome warns about an unresponsive tab on large outputs.
- Backend logs indicate the request completes and the SSE connection is closed promptly.
- Frontend logs show continued, sparse growth of text length (`[STREAM][ui] first_text_tokens { len: ... }`) long after the server has supposedly finished.

Interpretations to reconcile:
- Either tokens are still being processed client-side after completion (buffered somewhere), or the main thread is so busy that scheduled callbacks (including logging) are starved and appear “slow”.

We will instrument to distinguish these cases.

---

## End-to-End Flow (Current Architecture)

Server path:
- `app/api/chat/route.ts`
  - Builds a `ReadableStream` and returns `new Response(stream, { headers: { 'Content-Type': 'text/event-stream', ... }})`.
  - Inside `start(controller)`: defines `send(obj)` → `controller.enqueue(encoder.encode("data: ${JSON.stringify(obj)}\n\n"))` and `sendSSE(s)` for pre-formatted SSE.
  - Runs `for await (const streamEvent of provider.stream(chatRequest))` to emit events.
  - Emits:
    - event start via `sendSSE(streamingFormat.eventStart(...))`
    - tokens via `send({ type: 'token', content: segment.text })`
    - reasoning deltas and others similarly
  - On `done`/completion: saves events, `controller.close()`, and returns the Response.

Provider path (OpenAI Responses, representative):
- `lib/providers/unified/OpenAIResponsesProvider.ts`
  - Uses `this.client.responses.create({ stream: true })` and `processResponsesAPIStream` to convert provider chunks to internal events (`token`, `segment`, `reasoning_*`, `done`).
  - Yields a mix of `event`, `segment: { type: 'text' }`, `token`, and reasoning events.

Client path:
- `components/EventStream.tsx`
  - For existing chats: fetches `/api/chat` and passes the Response to `FrontendEventHandler.processStreamingResponse(response)`.

- `lib/streaming/frontendEventHandler.ts`
  - `processStreamingResponse`: `const reader = response.body?.getReader(); while (true) { const { done, value } = await reader.read(); ... }` → decodes chunks, splits on `\n`, parses lines starting with `data: ` as JSON, and calls `handleStreamEvent`.
  - Tokens route to `updateLocalStateToken`/`updateStoreStateToken` which call `streamingBus.append(assistantPlaceholderId, delta)` (no store writes during streaming) → leaf components render from the bus.
  - Reasoning: similar flow via `appendReasoning` (recently restored to append-only).

- `lib/streaming/streamingBus.ts`
  - Holds buffers per `eventId` and subscribers. Appends deltas, notifies subscribers. Now coalesces emits to ≤1 per frame.

- UI components
  - `components/EventList/StreamingTextSegment.tsx`: subscribes to the bus; now appends only the delta and batches to one render per frame; renders Markdown.
  - `components/Steps/StepsOverlay.tsx`: subscribes to reasoning bus; renders Markdown for overlay text.
  - `components/EventList/index.tsx`: `ResizeObserver` + `streaming-content-updated` auto-scroll.

---

## What Changed Recently (Diff Signals)

- MarkdownRenderer now uses a custom `CodeBlock` (react-syntax-highlighter) and MathJax (rehype-mathjax). A random `key={Math.random()}` is used for code blocks, forcing remount on every render (expensive on streaming).
- Reasoning overlay switched from incremental append to `setReasoning(fullText)` on each delta (O(n²) re-parse). We have reverted this to append-only.
- Streaming updates moved to leaf components via the bus (good), but previously there was a global ~30fps aggregator that limited worst-case re-render rate. We added frame-coalescing in the leaf and bus to recover that behavior.

Despite these mitigations, the page still freezes for large outputs, suggesting an additional bottleneck.

---

## Hypotheses (Ranked, with What to Measure)

1) Heavy render path per token (Markdown + syntax highlight + MathJax)
   - Effect: Main thread long tasks block subscriber callbacks; tokens “appear slowly” even though they arrived earlier.
   - Signals:
     - PerformanceObserver long tasks during streaming.
     - Large render durations around MarkdownRenderer and CodeBlock.
   - Checks:
     - Disable (temporarily) MathJax for non-math content; remove random key from CodeBlock; measure delta.

2) O(n²)/O(n·m) work in subscribers (string rebuilding and overlay updates)
   - Effect: Reparse growing content on each delta; amplified by auto-scroll and layout thrash.
   - Signals:
     - High render counts and increasing per-update time as message length grows.
   - Checks:
     - Ensure append-only deltas (done for reasoning and text). Verify no other full-text replacements on hot path.

3) Auto-scroll feedback loops (ResizeObserver + custom events)
   - Effect: ResizeObserver triggers scroll which triggers layout, which triggers observer, etc., per token.
   - Signals:
     - Many `streaming-content-updated` handlers and ResizeObserver callbacks per second.
   - Checks:
     - Add log counters; throttle scroll reactions via rAF to confirm improvement.

4) JSON.parse and chunk splitting costs
   - Effect: Very large chunks from server → big JSON strings per line; parsing cost increases with size.
   - Signals:
     - Measurable time between `reader.read()` resolved and `await this.handleStreamEvent` due to JSON.parse.
   - Checks:
     - Time JSON.parse per line; track cumulative parse time vs total.

5) Duplicate handler/reader
   - Effect: Multiple handlers appending to the same bus; increased work and contention.
   - Signals:
     - Multiple `handler_start` without corresponding `handler_finally`; multiple bus subscribers without matching unsubs.
   - Checks:
     - Use instanceId lifecycle logs (already added); correlate with bus subscription counts.

6) GC/Allocation pressure (ever-growing strings)
   - Effect: Appending to one giant string can incur frequent reallocations and GC pauses.
   - Signals:
     - GC events in performance profile; stalls scaling with content size.
   - Checks:
     - Performance profile in DevTools; consider chunked rendering (windowing) if confirmed.

---

## Targeted Instrumentation Plan (Quick, Low Noise)

Enable via `NEXT_PUBLIC_STREAM_DEBUG=true`.

Server (`app/api/chat/route.ts`):
- Wrap `send()` and `sendSSE()` to log lightweight timestamps and payload sizes only for:
  - token, reasoning_summary_text_delta, done
- Example:
  - `[STREAM][api] send { type, len: content?.length, ts }`

Frontend read loop (`lib/streaming/frontendEventHandler.ts`):
- Already logs `handler_start`, `recv_event` (non-token), `recv_complete`, `handler_finally`.
- Add timing around:
  1) `await reader.read()` resolve → `decoder.decode` → chunk split → per-line JSON.parse.
  2) `handleStreamEvent` dispatch time (aggregate tokens in the chunk).
- Emit periodic summaries instead of per-token logs to avoid flooding:
  - `[STREAM][fe][reader] read_ms, decode_ms, lines, parse_ms_total, dispatch_ms_total` per chunk.

Bus (`lib/streaming/streamingBus.ts`):
- Already logs subscribe/unsubscribe counts (debug mode).
- Add a per-frame emit count (coalescer): how many IDs emitted and how many subscribers invoked.

UI components:
- StreamingTextSegment & StepsOverlay:
  - Add a render duration measurement (performance.now() in a `useEffect` after `text` state changes) to capture time spent per update:
    - `[STREAM][ui][render] segment_ms=... len=...`
  - Count how many renders per second.

Global long-task observer (optional but powerful):
- In a top-level client-only init (e.g., `components/EventStream.tsx` or a small debug helper), register:
  ```ts
  if ('PerformanceObserver' in window) {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.log('[STREAM][perf] longtask', { dur: entry.duration, ts: performance.now() });
      }
    });
    // 50ms is default thresholds
    // @ts-ignore
    obs.observe({ type: 'longtask', buffered: true });
  }
  ```

---

## Experiments (to isolate root cause)

1) Logging-only run (no behavior changes)
   - Collect chunk timing (reader/parse/dispatch) and UI render durations.
   - If read/parse are fast but renders are long → main-thread render cost.
   - If read/parse are slow with large chunks → server chunking / JSON parse overhead.

2) Disable heavy features (temporary):
   - Turn off MathJax (rehype-mathjax) by gating it with a simple “content looks like math?” heuristic.
   - Remove `key={Math.random()}` from CodeBlock to prevent re-mounts.
   - Compare render durations and “first_text_tokens” cadence.

3) Scroll feedback test:
   - Temporarily disable `ResizeObserver` + `streaming-content-updated` in `EventList/index.tsx`.
   - Verify whether the freeze disappears or shrinks significantly.

4) Token throughput test:
   - Log `streamingBus.append` timestamps (rate) vs `StreamingTextSegment` onDelta invocation timestamps. If append is steady but onDelta lags, the UI thread is blocked.

---

## Likely Fixes (Once Confirmed)

- Remove `key={Math.random()}` from `CodeBlock` to avoid remounting on each update.
- Coalesce scroll updates (`ResizeObserver` + custom event) to one per animation frame.
- Keep append-only deltas (done) and frame-coalescing in `StreamingTextSegment` (done) and reasoning overlay (done).
- Conditionally enable heavy Markdown features (MathJax, code highlighting) only when detected or after streaming completes.
- If JSON.parse chunk cost is material: consider line buffering with staged parse (but unlikely the primary issue).

---

## Next Actions

1) Add the reader/parse/dispatch timing logs in `FrontendEventHandler.processStreamingResponse` (chunk-level summaries).
2) Add render duration counters in `StreamingTextSegment` and `StepsOverlay` (gated by debug flag).
3) Run a repro with debug on; collect:
   - Per-chunk timing, render durations, long-task logs
   - Throughput comparison of `append` vs `onDelta` timestamps
4) Based on evidence, apply minimal fix (likely remove random key from `CodeBlock`; then throttle scroll reactions; then consider gating MathJax during streaming).

---

## Notes

- Earlier regression (now fixed): reasoning overlay used `setReasoning(fullText)` on each delta → O(n²) Markdown work. Restored append-only.
- Even with coalescing, heavy remounts (random keyed CodeBlock) and MathJax can cause second‑long frames for large messages. Verify via perf logs before changing behavior.

