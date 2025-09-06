# Ephemeral Steps Streaming — Simple, Robust Segment UX

Status: Draft (implementation pending review)
Owner: Frontend/Streaming
Scope: Frontend UI + small segment metadata additions

## Problem
Current streaming UX intermixes reasoning, tools, and text inline. Different providers (Anthropic, OpenAI Chat, Responses) produce slightly different streaming shapes. This complexity leads to:
- Reasoning overlay not reliably visible/ordered
- Tool/Reasoning interleaving artifacts
- Confusing headers/continuations

We need a simpler, robust pattern that renders the same during streaming and after refresh.

## Goals
- Stream one “ephemeral step” at a time for non‑text segments (thinking, tools, built‑ins), live and focused.
- After a step completes, either:
  - Switch to streaming the next step (previous step hidden), or
  - Collapse all prior steps into a single compact summary (“Worked for X seconds”) that can be expanded.
- If there is only a single non‑text step + text, render them inline (no collapsed summary).
- Text always renders in segment order relative to steps.
- Remove typing indicator. Show a small loading indicator before the first step appears.
- Same behavior across Anthropic, OpenAI Chat, OpenAI Responses, and for multi‑turn (per‑event only; no cross‑event collapsing).
- Keep implementation small and easy to modify.

## Non‑Goals
- Cross‑event folding/summarization.
- Advanced timelines/analytics.
- Backward compatibility migration for old events (we will add metadata in a backward‑compatible way).

## High‑Level Design
Render per assistant event as a simple timeline:
- 0..N ephemeral non‑text steps (reasoning, tool calls, built‑ins)
- M text segments (often one, sometimes interleaved with steps)

During streaming:
- Show only the current step’s ephemeral UI (e.g., “Thinking…”, “Using Tool X…”).
- Hide previous steps (or show a single compact “Worked for X seconds” bar if we choose summary mode).
- Stream text segments as they arrive in order (text may appear before, between, or after steps).

After streaming:
- If there were multiple steps, show a single collapsed summary button (“Worked for 8.2s”) above the text. Clicking expands the list of steps with details.
- If there was one (or zero) step, render that step inline with the text (no summary button).

## Data Model (minimal additions)
We will extend Segment with optional timing metadata. No DB migration needed; `events.segments` is JSONB.

```ts
// lib/types/events.ts — optional fields (provider agnostic)
interface SegmentBase {
  started_at?: number;  // ms epoch when step started (server adds or builder estimates)
  completed_at?: number; // ms epoch when step finished
}

// Apply SegmentBase to non-text segments
// - reasoning (segment-level timing)
// - tool_call (segment-level timing)
// - tool_result (optional timing, typically mirrors tool_call)
// - built-ins (web_search_call, code_interpreter_call)
```

Notes:
- For Responses API where steps stream as discrete events, builder sets `started_at` on first signal, `completed_at` on done.
- For Anthropic, we set `started_at` on `message_start` or first relevant content_block, and `completed_at` on `content_block_stop`/done.
- If timing is missing, UI falls back to ordering and “~” durations.

## Streaming Builder (frontend) — simple step tracker
Augment EventBuilder to maintain a tiny step state machine:
- `currentStepIndex` (in event.segments) for the active ephemeral step.
- On `reasoning_start` or first reasoning part: ensure a `reasoning` segment exists; set `started_at` if missing; set as current step.
- On `mcp_tool_start` / tool_call start: ensure tool_call segment exists; set `started_at`; set as current step.
- On `*_complete`/`reasoning_complete`: set `completed_at` for the step; clear current step (next step becomes current on next start).
- Text tokens: appended in place; not a “step” (no ephemeral UI), but render inline at its position.

No store writes during stream; builder draft only. Final commit uses server’s message_final event.

## Rendering (frontend) — minimal components
- Replace per‑segment inline orchestration with a simple controller:
  - During streaming: render
    - Loading indicator (if no steps yet)
    - Current step’s ephemeral component (ReasoningLive, ToolLive, BuiltInLive)
    - Any text segments in order
  - After streaming:
    - If steps count > 1: collapse to a single summary button (“Worked for X seconds”) above the text; expand to show the list of steps in time order.
    - Else: keep the lone step inline with the text.

Implementation outline:
- A tiny selector that derives:
  - `steps`: non‑text segments with timing
  - `currentStepIndex`: last step with `started_at` and no `completed_at`
  - `hasMultipleSteps`: steps.length > 1
  - `durationTotal`: sum of (completed_at - started_at) for steps with timing
- Ephemeral rendering during streaming:
  - If `currentStepIndex` is null and no text yet → show small loading dots until first step or text arrives.
  - Show only the current step; hide previous ones (or show compact bar if we enable it).
- Post‑stream rendering:
  - If `hasMultipleSteps` → SummaryButton + collapsible StepsList
  - Else → Inline single step

## Ordering Rules (simple)
- Preserve the original segments array order for text positioning.
- Steps order is their first appearance order; timing used for durations only.
- If a provider emits reasoning twice (before and after tools), each is its own step.

## Removal of Typing Indicator
- Delete the old inline typing cursor logic.
- Use the small loading indicator before any step/text appears; hide once first step or text arrives.

## Provider Notes
- Anthropic:
  - reasoning may be brief; ensure step starts on first signal and completes on done.
  - tools: use tool_call/tool_result.
- OpenAI Chat:
  - similar to Anthropic (function calls → tool_call).
- OpenAI Responses:
  - reasoning_* and mcp_tool_* map to step start/complete; attach output to tool_call as today.

## Phased Implementation Plan (small steps)
1) Types + Builder
   - Add optional `started_at`/`completed_at` to Segment in TS types.
   - In EventBuilder, set timing for reasoning/tool steps on start/complete.
   - No DB changes or migrations required.

2) Renderer
   - Add a tiny derive function `deriveSteps(event)` to return steps and currentStepIndex.
   - Replace the existing live overlay logic with: Loading → CurrentStepLive → Text (ordered) → (Post‑stream) SummaryButton if needed.
   - Remove typing indicator.

3) Provider sanity
   - Ensure Responses and Anthropic streams trigger builder timing updates (start/end) with existing events. Don’t change server format; builder interprets.

4) QA
   - Single step + text (reasoning then text): shows live thinking → inline step + text post‑stream.
   - Tools between reasoning and text: shows tool live → text → (post) step summary if multiple steps occurred.
   - Responses: “reasoning before tools” shows live reasoning; “reasoning after tools” shows second live step; post‑stream collapses correctly.

## Acceptance Criteria
- Live: exactly one non‑text step visible at once; previous steps hidden; text streams in order.
- Post‑stream: multiple steps collapse to a single summary button, expandable to detailed steps.
- Single step + text shows inline (no summary button).
- No typing cursor; loading indicator only before first step or text.
- Works identically across Anthropic, Chat, Responses; across multi‑turn events (per event only).

## Future (optional, later)
- Persist per‑step durations in server for accurate “Worked for X seconds”.
- Step icons/themes by type; advanced details within expanded view.

