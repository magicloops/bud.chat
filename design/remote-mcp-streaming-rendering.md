# Remote MCP Streaming Rendering (Pre‑Text Steps Hidden)

Goal
- For remote MCP/Responses-style streams where multiple segments (reasoning/tool/built‑in) can arrive within a single assistant event, do not render those non‑text segments inline before any text is produced. Use the ephemeral overlay to indicate the current phase until text begins. Once text exists, render any subsequent non‑text segments inline.
- Preserve the existing local MCP/tool compatibility (multi‑turn behavior) where tool calls happen in a separate event turn.

Why
- Remote MCP tools frequently execute before the model emits its textual answer, leading to a cluttered pre‑text sequence. Showing these steps inline during streaming duplicates information that the overlay already conveys.
- Hiding pre‑text steps behind a simple overlay keeps the streaming UI calm. After text starts, inline steps provide context for operations that occur after the answer begins.

Key Terms
- Remote MCP (Responses API): Reasoning/tool/built‑in segments stream as parts of the same assistant event.
- Local MCP/tools: The model returns a tool_call; the server executes it in a new turn and emits tool_result as separate events.
- Pre‑text step: Any non‑text segment that appears before the first text segment in the same assistant event.
- Post‑text step: Any non‑text segment that appears after the first text segment in the same assistant event.

Behavior
1) During streaming
   - Pre‑text (no text yet):
     - Do not render non‑text segments inline (reasoning, tool_call, web_search, code_interpreter).
     - Show the ephemeral overlay to reflect the current phase (reasoning/tool/loading/etc.).
   - After first text:
     - Keep overlay hidden for the remainder of the event (no re‑appearance).
     - Render any subsequent non‑text segments inline in normal order (e.g., tool_call after text).

2) After streaming (finalized)
   - Hide all pre‑text steps under the “Ran for Ns ▸/▾” control in the header (even if there is only one step).
   - Render text normally.
   - Render post‑text steps inline after the text.
   - Duration in the header should summarize only the pre‑text phase (sum of pre‑text reasoning/tool/built‑in timings; fall back to min(start)→max(end) if needed).

3) Local MCP/tools compatibility (multi‑turn)
   - The server still creates separate events for tool_result turns. This remains unchanged.
   - Overlays are used for pre‑text phases only; they clear on first token of the assistant answer.
   - Post‑text inline step rendering applies only to non‑text segments within the same assistant event (i.e., remote MCP/Responses style). Separate tool_result events continue to render as their own entries.

Detection & Rules (Implementation Guidance)
- Pre/Post boundary is determined by `firstTextIndex = segments.findIndex(s => s.type === 'text')`.
- During streaming:
  - Render: segments where `segment.type === 'text'` OR `(firstTextIndex >= 0 && index > firstTextIndex)`.
  - Skip: segments where `index < firstTextIndex` and `segment.type !== 'text'`.
- Overlay gating:
  - Maintain a `textStartedForCurrentEvent` flag.
  - On first token, clear overlay and set the flag; after this point, ignore overlay updates for the current event.

Rendering Summary
- Streaming (no text): overlay only.
- Streaming (after text): text + any following steps inline; overlay hidden.
- Finalized: pre‑text steps hidden by “Ran for Ns” dropdown; text; post‑text steps inline.

Edge Cases
- Events with no text: overlay remains throughout streaming; finalized view shows pre‑text steps under dropdown (if any) and no text.
- Multiple text segments: The boundary is the first text segment. Subsequent non‑text segments may render inline.
- Timing missing: “Ran for Ns” falls back to span from earliest started_at to latest completed_at among pre‑text steps.

Testing Matrix
- Remote MCP (Responses):
  - Reasoning → tool → text → tool: overlay until first text; show later tool inline.
  - Tool → text only: overlay shows tool; hides on text.
  - Reasoning only; then text only: overlay, then text.
- Local MCP:
  - Assistant turn (no text) → tool call next turn: overlay during assistant pre‑text; separate tool_result event renders as its own item.
  - Assistant turn (text) → server executes tool in next turn: overlay clears on text; tool_result renders as separate event below.

Instrumentation
- Add `STREAM_DEBUG` logging for:
  - First token event (overlay clear + textStarted flag set).
  - Suppressed overlay updates when textStarted is true (optional, to validate gating).

Notes
- This doc describes behavior; current code paths already implement most of this:
  - Streaming renderer: renders text and post‑text non‑text segments, skips pre‑text non‑text.
  - Ephemeral overlay: gated to pre‑text phase via the textStarted flag.
- Any further changes should ensure remote MCP (same-event steps) follows these rules without disrupting local multi‑turn tool flows.

