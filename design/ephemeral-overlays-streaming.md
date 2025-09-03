# Ephemeral Overlays Streaming — Render What’s Streaming Now

Status: Draft (implementation pending review)
Owner: Frontend/Streaming
Scope: Minimal, robust streaming UI using ephemeral overlays + background event build

## Intent
Keep the live UI extremely simple: show exactly what’s currently streaming (reasoning snippet, tool in progress, built‑in step, or “writing answer”) as a single ephemeral overlay for the active assistant event. Build the canonical Event/Segments in the background for the post‑stream "Steps" dropdown and the persisted record. Do not gate ephemeral UI on segment analysis or step derivation.

## Core Principles
- One overlay at a time: only the current streaming phase is shown.
- Direct mapping from incoming stream messages → ephemeral overlay state.
- Background build: event segments (reasoning, tools, text) are still assembled for persistence and post‑stream details, but do not influence the ephemeral overlay during the stream.
- Provider‑agnostic: FrontendEventHandler translates various provider events (Anthropic, OpenAI Chat, Responses, built‑ins) into a tiny, unified ephemeral state machine.

## Data Flow
1) SSE → FrontendEventHandler
   - Handles transport events: `event_start`, `reasoning_*`, `mcp_tool_*`, `segment` (text), `message_final`, `complete`, `progress_*`.
   - Updates two independent targets:
     a) EventBuilder draft (unchanged; for final segments)
     b) EphemeralOverlayState (NEW; for immediate UI)

2) EphemeralOverlayState (per streaming assistant event)
   - In‑memory, not persisted; cleared on `message_final/complete`.
   - Shape (example):
     ```ts
     type EphemeralKind = 'reasoning' | 'tool' | 'built_in' | 'writing' | 'idle';
     interface EphemeralOverlayState {
       eventId: string;
       kind: EphemeralKind;
       // Reasoning
       reasoning?: { text: string; item_id: string; updatedAt: number };
       // Tool (MCP/local/built-in)
       tool?: { id: string; name: string; status?: string; updatedAt: number };
       // Writing (assistant text streaming)
       writing?: { updatedAt: number };
     }
     ```
   - Implementation: small registry (like eventBuilderRegistry) or a lightweight EventEmitter + Map keyed by `streamingEventId`.

3) UI — EphemeralOverlay component
   - Subscribes to EphemeralOverlayState for the active `streamingEventId`.
   - Renders a tiny panel inline above the text area of that assistant event:
     - Reasoning: shows the current reasoning text (markdown) updating live.
     - Tool: shows “Using <name>…” (and simple status when available).
     - Writing: shows a subtle “writing…” indicator (optional) when text tokens stream.
     - Idle: hidden.
   - Absolutely no step derivation during streaming; render whatever ephemeral state says.

4) Post‑stream Steps (dropdown)
   - Uses the canonical Event (from store/DB) to render the list of steps (reasoning/tool/built‑ins) with durations.
   - The ephemeral overlay is hidden after `message_final/complete`.

## FrontendEventHandler → EphemeralOverlayState mapping
- On `event_start`: create/reset ephemeral state `{ kind: 'idle' }` for that event id.
- On `reasoning_start` or first reasoning summary_part_added:
  - Set `{ kind: 'reasoning', reasoning: { text: '' } }`.
- On `reasoning_text_delta`: append to `reasoning.text`.
- On `reasoning_part_done`/`reasoning_complete`: keep `kind: 'reasoning'` until next phase begins (or switch to `writing` when text tokens appear).
- On `mcp_tool_start` (or any tool start): set `{ kind: 'tool', tool: { id, name, status: 'in_progress' } }`.
- On `mcp_tool_arguments_delta`: leave `kind: 'tool'`, optional status update.
- On `mcp_tool_complete`: set `{ kind: 'tool', status: 'completed' }` briefly; switch to next phase on next incoming event.
- On assistant text `segment` tokens (not reasoning): set `{ kind: 'writing' }` while tokens arrive.
- On `message_final`/`complete`: clear ephemeral state.

## Minimal New Code
- `lib/streaming/ephemeralOverlayRegistry.ts`
  - Map<string, EphemeralOverlayState>
  - `setOverlay(eventId, state)`, `getOverlay(eventId)`, `subscribe(eventId, cb)`
- FrontendEventHandler
  - Update overlay registry when handling reasoning/tool/text events.
  - Do not gate on builder/segments for ephemeral.
- UI: `components/EventList/EphemeralOverlay.tsx`
  - Subscribe to overlay for active streaming eventId.
  - Render small panel inline; show markdown for reasoning text.
- Remove/ignore streaming‑time step derivation in the renderer.
  - SequentialSegmentRenderer only renders text segments in order during streaming + the EphemeralOverlay.
  - Post‑stream: keep existing step summary (built from the final event).

## Removal of Complexity
- Drop currentStepIndex/deriveSteps gating during streaming.
- No more conflation of ephemeral live UI and the on-disk segment model.
- One small, predictable state object drives the live panel.

## Provider Coverage
- Anthropic: map `message_start/reasoning/tool_use` to overlay states.
- OpenAI Chat: map function calls (tools) and deltas similarly.
- OpenAI Responses: map `reasoning_*`, `mcp_*`, and text deltas.

## Error/Progress
- Progress remains as a tiny indicator; can be folded into the overlay (e.g., append “searching…” under tool or “thinking…” under reasoning when no deltas yet).

## Phased Plan
1) Add overlay registry + component; wire handler updates for reasoning/tool/writing.
2) Remove streaming-time step derivation; renderer shows text + overlay only.
3) Keep post-stream steps dropdown based on final segments.
4) QA with: reasoning-only bud; tools then reasoning; tools-only; text-only.

## Acceptance
- With reasoning-only: overlay shows reasoning text live.
- With tools then reasoning: overlay shows tool live, then switches to reasoning live, then writing.
- No dependence on complex step derivation during streaming.

