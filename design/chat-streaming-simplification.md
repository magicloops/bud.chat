**Title:** Simple, Performant Chat Streaming — Clear Boundary Between Stream and Store

**Context / Problem**
- The current approach mixes streaming concerns with the conversation store. Small changes have caused UI hangs because we sometimes push token-by-token updates into the store (reasoning/tool steps), causing large re-renders and churn.
- The UI path for new vs. existing conversations diverges, and local vs. store-backed streaming logic gets interwoven. This makes it easy to reintroduce bugs that write to the store during streaming.
- Reasoning/steps rendering is coupled with message segments, so we keep trying to “assemble” the event during streaming on the client, which is error-prone.

**Goals**
- Only the most recent assistant message re-renders during streaming.
- The conversation store is updated only once per assistant turn, at the end of the stream.
- Steps (reasoning parts, tool calls, built-ins) stream above the text, without touching the store.
- A final, canonical event arrives from the server with the complete content (reasoning parts, tools, text, metadata), so the client doesn’t have to reassemble it.
- Same flow for new and existing conversations, with minimal divergence.

---

**High-Level Design**

1) Single Source of Truth for Finished Messages
- Conversation store (Zustand) contains only persisted/finished events.
- During streaming, do NOT write to the store (no token/step deltas). The store remains stable for fast navigation.

2) Streaming Session Layer (Ephemeral, UI-Only)
- Introduce a small StreamingSessionManager (local module/singleton) per active stream:
  - Buffers: text tokens, reasoning deltas, tool overlays (args/status/code), progress.
  - Pub/sub interface (subscribe/unsubscribe) for a single StreamingMessage component.
  - No store writes, ever.
  - Keyed by `stream_id` (or `assistant_event_id`) so the UI knows which session to render.

3) Streaming UI
- ConversationView renders:
  - Store-backed messages (finished events) as usual.
  - A bottom-mounted StreamingMessage component if a session is active.
- StreamingMessage renders:
  - Steps Panel (top): reasoning/tool overlays streaming in real time.
  - Text Area: streams tokens directly as they arrive.
  - Auto-collapse Steps when the first text token arrives; expose a “Show steps” toggle.
  - On stream end, unmounts itself.

4) Finalization
- Back-end sends a single final payload with the complete assistant Event (segments + response_metadata), and also persists it to DB:
  - The front-end receives this `message_final` payload and appends it to the store in one shot.
  - The StreamingMessage unmounts, and the canonical store message takes its place.

---

**Back-End Contract (SSE Payloads)**

All events delivered via SSE `data: { type: '...' }` lines. Minimal, stable set:

- `session_started`:
  - `{ type: 'session_started', stream_id, conversation_id, assistant_event_id }`
  - Announces a streaming session. The client mounts a StreamingMessage keyed by `assistant_event_id`.

- Step streaming (non-text):
  - `{ type: 'step_started', stream_id, step_id, step_kind, meta? }`
    - `step_kind`: `reasoning_part` | `tool_call` | `web_search` | `code_interpreter`
  - `{ type: 'step_delta', stream_id, step_id, part_index?, text? | code? | status? }`
    - For reasoning: `text` deltas (optionally `part_index`).
    - For tools: `status`/`args` deltas; code interpreter: `code` deltas.
  - `{ type: 'step_completed', stream_id, step_id, result? }`
    - Mark final state so the overlay can stop animating.

- Text streaming:
  - `{ type: 'text_token', stream_id, content }` — first token triggers steps auto-collapse.
  - `{ type: 'text_complete', stream_id }`

- Finalization (one canonical payload):
  - `{ type: 'message_final', stream_id, event }`
    - `event` is the fully-formed assistant Event: all segments (reasoning parts, tool calls + results, text), response_metadata.
    - Back-end persists this to DB before or at the same time it is streamed.

- Terminal:
  - `{ type: 'stream_complete', stream_id }`
  - Optional if `message_final` always appears last.

Notes:
- This contract lets the front-end avoid reassembling all segments. The server performs provider-specific merging into our unified Event format.
- If a provider can’t supply reasoning parts live, we still use `step_started/delta/completed` to drive the overlay and then rely on `message_final` for canonical content.

---

**Front-End Architecture**

1) StreamingSessionManager (new)
- Responsibilities:
  - Maintains ephemeral buffers keyed by `stream_id` or `assistant_event_id`.
  - Publishes updates for: steps list, per-step deltas, text tokens, and progress.
  - Exposes `start(stream_id, assistant_event_id)`, `apply(eventPayload)`, and `complete(stream_id)`
  - Cleans up buffers on completion.
  - Zero dependencies on the store.

2) FrontendStreamHandler (thin)
- Parses SSE chunks and invokes `StreamingSessionManager.apply(payload)`.
- On `message_final`: calls a single store append `appendEvent(conversationId, event)`.
- On errors/abort: cleans up session (no store writes beyond prior user message that initiated the stream).

3) Conversation Store (unchanged for finished messages)
- Holds only finished, persisted Events.
- Append-only for assistant turns via `message_final`.
- Enables quick navigation without streaming-induced re-renders.

4) UI Components
- `ConversationView`
  - Renders store-backed messages.
  - Subscribes to StreamingSessionManager to render a single `StreamingMessage` if a session is active.
  - Only this component re-renders as tokens/steps arrive.

- `StreamingMessage`
  - StepsPanel (top): subscribes to session steps overlay (reasoning/tool/built-ins).
  - TextRenderer (bottom): subscribes to token buffer.
  - Collapses steps on first token; exposes “Show steps”.
  - Unmounts on `message_final`, when store appends the real Event.

---

**Performance Characteristics**
- Store writes: exactly one per assistant turn (when `message_final` arrives).
- React re-renders: only the StreamingMessage updates during streaming.
- Navigation: switching between conversations reuses the store snapshot; streaming session is per-view and gets torn down when leaving the page.
- No diffing of large arrays per token; only small overlay buffers update.

---

**Migration Plan (Incremental)**

1) Back-End
- Add `message_final` SSE payload and ensure the server constructs the canonical assistant Event and persists it.
- Emit `session_started`, `step_*`, `text_*` as light progress signals.

2) Front-End
- Introduce `StreamingSessionManager` and `StreamingMessage` component.
- Update the stream handler to use only the session manager during streaming (no store writes).
- On `message_final`, append to store and tear down the session.

3) UI Convergence
- Use the same streaming path for new and existing conversations.
- Remove legacy code paths that push deltas into the store.

4) Cleanups
- Remove ad-hoc in-place segment merging during streaming.
- Consolidate overlays (reasoning, tools, built-ins) under the session manager.

---

**Fallbacks / Edge Cases**
- If `message_final` fails to arrive (network error):
  - Show a retry CTA; do not commit a partial assistant message.
  - Optionally send a `message_recover` request to re-stream or load the persisted event if it was saved.
- If the server cannot provide reasoning steps live:
  - Overlays may be sparse; still show tokens. The final message will include all reasoning parts for the store.

---

**Why This Is Simpler**
- Single boundary: streaming session (ephemeral, UI-only) vs. conversation store (finished data).
- The front-end never needs to rebuild the canonical Event; the server sends it once.
- Only one component re-renders live. All other UI remains stable.
- Eliminates accidental reintroduction of store writes mid-stream.

---

**Open Questions**
- Do we need a progress bar or activity indicator per step category (reasoning/tools)? The design supports it via `step_kind` and `status`.
- Should we support multiple assistant turns in-flight? For MVP, disallow parallel streams per conversation.
- Do we keep the current streamingBus or wrap it inside the new StreamingSessionManager? Proposed: encapsulate it inside the manager to contain complexity.

