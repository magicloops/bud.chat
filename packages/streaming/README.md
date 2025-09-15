@budchat/streaming

Streaming primitives for Bud Chat, used on both server and client. Provides an incremental `EventBuilder`, simple registries for in‑flight state, rendering helpers, and a minimal SSE processor.

## What it does
- Event assembly: `EventBuilder` incrementally combines text, reasoning, tool calls/results, and exposes a streaming view.
- Registries: `eventBuilderRegistry` and `ephemeralOverlayRegistry` to coordinate per‑event draft state and UI overlays.
- Rendering: `getRenderableSegments(event, allEvents?)` flattens tool results for display; `deriveSteps(event)` summarizes step timing and progress.
- SSE processing: `sseIterator(response)` and `processSSE(response, handlers)` to dispatch standardized SSE envelopes.
- Entry points: `index.ts` (full exports, includes app’s `FrontendEventHandler` re‑export) and `client.ts` (safe client‑side subset without FE to avoid cycles).

## How it connects
- Works with the unified event types from `@budchat/events` and the SSE envelope emitted by API routes.
- The app’s `FrontendEventHandler` uses `EventBuilder` and `processSSE` to update UI state during streams.

## Usage
```ts
import { EventBuilder, processSSE } from '@budchat/streaming/client'

const builder = new EventBuilder({ placeholderEventId: 'tmp-1', onUpdate: draft => {/* render */} })
await processSSE(fetch('/api/chat', { method: 'POST' }), {
  onEventStart: (e) => {/* init row */},
  onSegment: (seg) => {
    if (seg.type === 'text') builder.appendTextDelta((seg as any).text)
    if (seg.type === 'tool_call') builder.upsertToolCall(seg as any)
  },
  onEventComplete: (e) => builder.finalizeCurrentEvent(e),
})
```

## Notes
- `EventBuilder` batches text updates for smoother UI and keeps reasoning segments active until non‑reasoning content arrives.
- Use `client` sub‑path on the web to avoid importing the app’s `FrontendEventHandler` inadvertently.

