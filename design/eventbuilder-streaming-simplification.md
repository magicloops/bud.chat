# EventBuilder‑Driven Streaming Simplification (No Timestamps)

Goal
- Make streaming rendering correct and simple without relying on timestamps or overlay state.
- Use the EventBuilder as the single source of truth for “phase” and segment order during streaming.

Why this change
- Segment array order during streaming is unreliable (providers can seed empty text segments or re‑order items).
- Overlay is a visualization, not a data signal; coupling renderer to overlay causes regressions.
- EventBuilder already sequences updates in arrival order and is the right place to track phase.

Proposed design
1) Extend EventBuilder with minimal, explicit streaming state:
   - hasTextContent(): boolean
     - True after the first non‑empty text delta is appended.
   - getStreamingView(): { preText: Segment[]; text: Extract<Segment, { type: 'text' }> | null; postText: Segment[] }
     - Buckets reflect arrival order as observed by the builder.
     - While streaming, draft.segments can remain preText + [text] + postText for compatibility.

2) EventBuilder behavior
   - Do NOT create a text segment on text_start if the delta is empty.
   - On appendTextDelta(delta):
     - If delta.trim().length > 0 and no text exists yet, create the text segment and flip hasTextContent to true.
     - Append to the text buffer as usual.
   - On non‑text updates (startToolCall, finalizeToolArgs, completeTool, reasoning parts, built‑ins):
     - If !hasTextContent → push/update in preText bucket.
     - Else → push/update in postText bucket.

3) Renderer contract (streaming)
   - Ask builder for hasTextContent() and getStreamingView() for the active event.
   - If !hasTextContent():
     - Render nothing from preText (overlay covers it).
     - Render text only if it has any content (usually none yet).
   - If hasTextContent():
     - Render text and postText inline.
     - Never render reasoning inline during streaming (UX rule).

4) Renderer contract (post‑stream)
   - Keep existing finalized behavior:
     - Collapse all preText steps under the “Ran for Ns” header dropdown.
     - Render text normally; render postText inline.

5) FrontendEventHandler
   - No change to overlay gating (pre‑text only; cleared on first token).
   - Ensure we only emit non‑empty text deltas to the builder (or let builder ignore empty text creates).

Benefits
- Provider‑agnostic: arrival order in the builder matches user perception; no need for timestamps.
- Simplicity: the renderer becomes a pure view of builder state; no overlay queries or provider conditionals.
- Correctness: local MCP tools appear inline during streaming after text begins; remote MCP steps never leak inline pre‑text.

Implementation outline
- EventBuilder (lib/streaming/eventBuilder.ts)
  - Add private fields: _hasTextContent = false, _preText: Segment[] = [], _postText: Segment[] = [].
  - Flip _hasTextContent on first non‑empty text delta and create the text segment if necessary.
  - Route non‑text segment updates into _preText or _postText based on _hasTextContent.
  - Maintain this.draft.segments = [..._preText, textIfAny, ..._postText] for downstream compatibility.
  - Add public getters hasTextContent() and getStreamingView().
- Renderer (components/EventList/SequentialSegmentRenderer.tsx)
  - For the active streaming event, resolve the builder for that event id and use the getters above.
  - Apply the streaming/post‑stream policies listed.

Notes
- If some providers force a text segment at text_start, treat it as non‑content until the first non‑empty delta.
- Minimal, targeted debug logs can be added at the builder boundary (phase flip, bucket counts) behind STREAM_DEBUG.
