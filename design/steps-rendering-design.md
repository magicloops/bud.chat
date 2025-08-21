# Steps Rendering (Reasoning + Tools) — Streaming and Non‑Streaming UI

Goal: simplify the assistant message rendering for reasoning models (o3, gpt‑5, etc.) so that:

- Non‑streaming: show a single collapsed “Show steps” dropdown per assistant message. When expanded (lazy), compute and render all steps (reasoning parts, built‑in tools, MCP tools, etc.) in the exact order executed.
- Streaming: render a single compact “Steps Overlay” that shows only the current in‑progress item (one at a time). As each part/tool finishes, the overlay swaps to the next. When output text begins, collapse the overlay and show the same “Show steps” dropdown as non‑streaming.

This eliminates per‑token parent re‑renders, reduces UI churn, and makes the progression easy to follow.

## Terms
- Output Item: OpenAI Responses API output unit (message, reasoning, tool call). Identified by `item_id` with `output_index` and `sequence_number` ordering.
- Step: A single item in the steps list. Examples: a reasoning summary part, a web search call, a code interpreter call, an MCP call lifecycle entry.
- Part: A “reasoning summary part” within a reasoning output item.

## Problems With Current UI
- Multiple components render different pieces (reasoning, tools) and often re‑mount during streaming, causing flicker and extra layout.
- Reasoning parts and tool calls can interleave, but we display them in separate areas, losing original order.
- We render all parts while streaming; this creates noise. We only need to show the current active thing.

## Proposed UX

### Non‑Streaming (finalized renders)
- Show: assistant’s text response as today.
- Below it: a collapsed disclosure “Show steps”.
- On expand (lazy):
  - Compute the list of steps for this message by scanning its segments (and legacy fields if needed).
  - Render a vertical timeline in the exact order the model executed:
    - Order by `output_index`, then `sequence_number`.
    - Flatten reasoning segments into individual reasoning “part” steps (sorted by `summary_index`).
    - Include built‑in tool steps (web search, code interpreter) and any MCP calls.
  - Each step shows a concise label, optional status/time, and details (markdown for reasoning parts, code viewer for code, etc.).

Defaults: the disclosure is closed by default for non‑streaming. No steps are computed until opened.

### Streaming
- Before output text starts, show a compact “Steps Overlay” placeholder directly above the typing area of that assistant message.
- Display only the current active item:
  - Reasoning: show the currently streaming part’s text (with spinner). When a part completes, swap to the next part.
  - Built‑in tools: show the current tool status (in_progress/searching/completed) and a short description.
  - Code interpreter: show the streaming code (throttled) as the active item.
- Never add a new component per step; update the same overlay view with the next item’s content.
- On the first output text token from the LLM:
  - Freeze/complete the overlay.
  - Replace it with the collapsed “Show steps” dropdown (empty at first).
  - Continue streaming text as usual (via our streaming bus), and once the stream finishes, the dropdown can be opened to view the final ordered steps.

## Data Model

Introduce a lightweight “Step” shape computed on demand:

```
type StepType = 'reasoning_part' | 'web_search' | 'code_interpreter' | 'mcp_call';

interface StepBase {
  key: string;                 // stable key (e.g., `${item_id}:${summary_index}`)
  type: StepType;
  output_index: number;        // ordering primary key from OpenAI
  sequence_number: number;     // ordering secondary key from OpenAI
  started_at?: number;         // optional timing
  completed_at?: number;       // optional timing
}

interface ReasoningPartStep extends StepBase {
  type: 'reasoning_part';
  item_id: string;
  summary_index: number;
  text: string;                // final text (non‑streaming) or current text (streaming overlay)
}

interface WebSearchStep extends StepBase {
  type: 'web_search';
  item_id: string;
  status: 'in_progress' | 'searching' | 'completed' | 'failed';
}

interface CodeInterpreterStep extends StepBase {
  type: 'code_interpreter';
  item_id: string;
  status: 'in_progress' | 'interpreting' | 'completed' | 'failed';
  code?: string;               // final code or streaming overlay snapshot
}

interface MCPCallStep extends StepBase {
  type: 'mcp_call';
  tool_id: string;
  name?: string;
  args?: object;
  output?: object;
  error?: string;
}

type Step = ReasoningPartStep | WebSearchStep | CodeInterpreterStep | MCPCallStep;
```

Notes:
- We do NOT store steps in the event permanently. For non‑streaming, compute once on disclosure expand.
- For streaming overlay, maintain ephemeral overlay state only.

## Computing Steps (Non‑Streaming)

When the user expands “Show steps” for an assistant event:

1. Gather sources from the event’s finalized segments:
   - Reasoning segments: flatten `segment.parts` to `reasoning_part` steps with keys `${segment.id}:${summary_index}`; carry `output_index`, `sequence_number` from segment; order parts by `summary_index`.
   - Built‑in tools: web search and code interpreter segments become steps with their lifecycle status.
   - MCP tool calls: convert `tool_call` segments to `mcp_call` steps; if tool outputs are attached on the segment (Responses API), include them in the step.
2. Sort all steps by `(output_index, sequence_number)`.
3. Render a list of steps using minimal components (small markdown for reasoning, small status rows for tools, code viewer for code).

Edge cases:
- Multiple reasoning segments: simply flatten all their parts; the ordering by `(output_index, sequence_number)` keeps correct chronology.
- If any segment lacks `sequence_number`, treat as `Infinity` (fallback order remains stable by original array index).

## Streaming Overlay Flow

We already have a streaming bus and unified event handler; reuse them to drive a single overlay.

State machine (per streaming assistant message):
- currentOverlayItem: one of { reasoning_part, web_search, code_interpreter, mcp_call } with metadata.
- transitions are driven by stream events:
  - reasoning_summary_part_added: set overlay to that part (summary_index).
  - reasoning_summary_text_delta: append text to overlay.
  - reasoning_summary_part_done: mark part complete; pick next available part or await next item.
  - web_search_call.in_progress/searching/completed: update overlay to show web search status (swap to it if no active part).
  - code_interpreter_call.in_progress/interpreting/completed: same pattern.
  - code_interpreter_call_code.delta/done: stream code into overlay.
  - First response.output_text.delta: finalize overlay; hide; instantiate collapsed “Show steps” dropdown.

Rendering:
- Use a single `<StepsOverlay eventId=... />` component that subscribes to a small overlay store (or taps the existing streamingBus channels mapped to a single item view).
- The overlay renders compact content (spinner + concise label + body) and updates in place without re‑mounting.
- No additional segments are rendered during streaming; only the text StreamingTextSegment is visible below.

## Components

- StepsDropdown (non‑streaming)
  - Props: `event` (finalized), defaultCollapsed=true.
  - On expand: computes steps and renders StepList.
  - StepList: simple renderer by type (markdown for reasoning, micro‑status for tools, code viewer for code interpreter, concise info for MCP calls).

- StepsOverlay (streaming)
  - Props: `eventId`, visible while streaming until first text token.
  - Reads ephemeral overlay state (via a small overlay store or via streamingBus + local reducer) and renders the single active item.
  - Handles minimal autoscroll signals via `streaming-content-updated` events (existing pattern).

## Integration Points

- FrontendEventHandler (already emits unified events):
  - Ensure we capture `output_index` and `sequence_number` for all relevant items.
  - Maintain ephemeral overlay state per event: current step type + content snapshot.
  - On first text token, dispatch an action to hide overlay in UI.

- Event rendering:
  - Replace the current multi‑component stack for reasoning/tool streaming with:
    - Streaming: Text + StepsOverlay.
    - Non‑streaming: Text + StepsDropdown (collapsed by default).
  - Keep legacy fallbacks for now, but mark them for removal.

## Ordering Rules

1. Primary: `output_index` asc.
2. Secondary: `sequence_number` asc.
3. Within a reasoning item, parts order by `summary_index` asc.

Rationale: mirrors OpenAI Responses API chronology across interleavings (reasoning/tool/message).

## Performance & Stability

- Lazy computation: the dropdown only computes steps on first expand; cache result on the component instance.
- Streaming overlay: updates are throttled via existing bus cadence; minimal DOM changes (update text/code in place).
- Immutability: never mutate frozen props; clone arrays when sorting; perform immutable updates in event handler (already fixed).
- Autoscroll: continue to dispatch `streaming-content-updated` on overlay updates; EventList uses `ResizeObserver`.

## Migration Plan

Phase 1 (behind a feature flag):
- Add StepsOverlay and StepsDropdown components.
- Wire overlay to FrontendEventHandler/streamingBus; hide on first token.
- Render StepsDropdown (collapsed) after stream completes.

Phase 2:
- Replace existing StreamingReasoningSegment/ReasoningSegment and built‑in tool streaming renderers inside assistant messages with the new overlay.
- Ensure tool results and citations still appear in final text region or as steps details.

Phase 3:
- Remove legacy combined_text reliance entirely; keep parts‑only path.
- Simplify SequentialSegmentRenderer and adjacent code to delegate to the new components.

## Open Questions

- Do we want timestamps or durations per step? We can synthesize from event arrival times.
- Should the dropdown remember its open/closed state per conversation (localStorage)?
- How much detail for MCP steps by default (name/args/output excerpt vs. full details)?

## Testing

- Unit test the step ordering function with mixed reasoning/tool items.
- Manual tests for streaming: interleaved reasoning + web_search + code interpreter; verify overlay swaps correctly and hides on first text token.
- Regression checks: no infinite update loops, no flicker at stream end, and autoscroll remains smooth.

