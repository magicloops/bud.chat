# Steps Button in Assistant Header

Goal
- Move the post-stream steps summary control (e.g., "Ran for 12.4s ▸") into the assistant event header, to the right of the timestamp. When the assistant header is omitted (continuation view), show the button by itself above the content.

Current Behavior
- The steps button is rendered inside `SequentialSegmentRenderer` (post‑stream branch) above the text content. It manages its own `showSteps` state and conditionally renders the non‑text steps inline.
- During streaming, `SequentialSegmentRenderer` renders only text segments and relies on `EphemeralOverlay` for phase indication (reasoning/tool/built‑in), so the steps button is not shown.

Proposed Changes
1) Lift the steps toggle UI into the event header
   - Add a compact steps button to the assistant header (in `EventItemSequential.tsx`) next to the relative timestamp. Label format: `Ran for Ns ▸/▾` when there are multiple steps; fallback to `Steps` if timing could not be derived.
   - When the header is omitted (continuation assistant message), render the same button alone in a tiny top row above the content (same spacing as the header would have used).

2) Centralize `showSteps` state in `EventItemSequential`
   - Maintain `const [showSteps, setShowSteps] = useState(false)` in `EventItemSequential`.
   - Compute steps and duration using `deriveSteps(event)` in `EventItemSequential` to drive button label and visibility.
   - Pass `showSteps` down to `SequentialSegmentRenderer` via a new optional prop, e.g., `showSteps?: boolean`.

3) Simplify `SequentialSegmentRenderer` (post‑stream)
   - Remove the internal steps button and its local `showSteps` state.
   - Keep existing logic to compute steps for rendering, but only use the incoming `showSteps` prop to decide whether to show the non‑text steps list (collapsed vs expanded). If `showSteps` is false, render only text and inline segments (when steps are single/none) as today.
   - Preserve the current streaming branch behavior (render text only). No button while streaming.

4) Continuation handling
   - `EventItemSequential` currently hides the assistant header for continuation (`shouldShowAsContinuation`). In this case, render just the steps button inline above the content to retain access to the steps summary.

Affected Files
- `components/EventList/EventItemSequential.tsx`
  - Compute `const { steps, totalDurationMs } = deriveSteps(displayEventOrEvent);` using the same event used for rendering (prefer the draft when streaming is not relevant here, but since this is post‑stream only, the saved event is fine).
  - Add `showSteps` state and button click handler next to the timestamp when the header is shown.
  - When `shouldShowAsContinuation` is true, render the button alone above the content.
  - Pass `showSteps={showSteps}` to `SequentialSegmentRenderer`.

- `components/EventList/SequentialSegmentRenderer.tsx`
  - Add `showSteps?: boolean` prop.
  - Remove the steps button and internal toggle state; use the `showSteps` prop to decide whether the non‑text steps list is visible in the post‑stream branch when `hasMultipleSteps`.
  - Keep streaming branch unchanged (text only).

Formatting & UX Notes
- Button label: if `totalDurationMs > 0`, format as `Ran for {seconds.toFixed(1)}s`; otherwise use `Steps`.
- Show the button only when `!isStreaming && steps.length > 0`.
- Keep button styling consistent with existing muted secondary actions (`text-xs text-muted-foreground hover:text-foreground underline`).

Edge Cases
- Events with a single step: keep inline rendering; the button should not render.
- No timing available but multiple steps: show `Steps ▸` to allow expansion (duration unknown).
- Multi‑turn assistant messages separated by tool events: timing still derives from `started_at/completed_at` persisted on segments; no special handling needed here.

Migration Plan
1. Update `SequentialSegmentRenderer` prop signature and remove its local steps button/logic.
2. Update `EventItemSequential` to compute steps, render the header‑placed button (or standalone button for continuations), and pass `showSteps` down.
3. Light verification with STREAM_DEBUG:
   - Confirm `deriveSteps(event)` returns steps after refresh.
   - Confirm header shows `Ran for Ns` when appropriate and toggles expansion.

Out of Scope
- Styling/layout refactors beyond placing the button; no changes to EphemeralOverlay or streaming behavior.
- Changing steps derivation logic.

