import { Event } from '@/state/eventChatStore';
import { Segment } from '@budchat/events';

/**
 * Produce the renderable segments for an event, resolving tool results
 * and leaving unknown types as-is (so fallback renderers can handle them).
 * This preserves the original event.segments order (no resorting).
 */
export function getRenderableSegments(event: Event, allEvents?: Event[]): Segment[] {
  const renderable: Segment[] = [];

  for (const seg of event.segments as Segment[]) {
    if (seg.type === 'tool_result') {
      // Standalone tool_result is not rendered directly; it's shown under its tool_call
      continue;
    }

    if (seg.type === 'tool_call') {
      // Try to resolve an inline or external tool_result for this tool_call
      let output = (seg as any).output as unknown;
      let error = (seg as any).error as string | undefined;

      if (output === undefined) {
        // First, look in the same event for a matching tool_result
        const inline = event.segments.find(s => s.type === 'tool_result' && (s as any).id === seg.id) as any;
        if (inline) {
          output = inline.output;
          error = inline.error;
        }
      }
      if (output === undefined && allEvents && allEvents.length > 0) {
        // Then, search other events (e.g., Responses MCP or Anthropic tool_result event)
        for (const e of allEvents) {
          const match = e.segments.find(s => s.type === 'tool_result' && (s as any).id === seg.id) as any;
          if (match) { output = match.output; error = match.error; break; }
        }
      }

      if (output !== undefined || error !== undefined) {
        renderable.push({ ...seg, output, error } as any);
      } else {
        renderable.push(seg);
      }
      continue;
    }

    // reasoning, text, and any unknown segment types pass through
    renderable.push(seg);
  }

  return renderable;
}

export function deriveSteps(event: Event): {
  steps: Segment[];
  currentStepIndex: number | null;
  totalDurationMs: number;
} {
  const segs = event.segments as Segment[];
  const steps = segs.filter(s => s.type === 'reasoning' || s.type === 'tool_call' || s.type === 'web_search_call' || s.type === 'code_interpreter_call');
  let currentStepIndex: number | null = null;
  let total = 0;
  let minStart: number | undefined;
  let maxEnd: number | undefined;
  steps.forEach((s, i) => {
    const started = (s as any).started_at as number | undefined;
    const done = (s as any).completed_at as number | undefined;
    if (started && !done) currentStepIndex = i; // last active
    if (started && done) total += Math.max(0, done - started);
    if (started) minStart = minStart === undefined ? started : Math.min(minStart, started);
    if (done) maxEnd = maxEnd === undefined ? done : Math.max(maxEnd, done);
  });
  // Fallback: if no explicit current step, prefer the first reasoning step that has started and not completed
  if (currentStepIndex === null) {
    const idx = steps.findIndex(s => s.type === 'reasoning' && (s as any).started_at && !(s as any).completed_at);
    if (idx >= 0) currentStepIndex = idx;
  }
  // Fallback: if total is 0 but we have timing, show span from first start to last end
  const fallback = (minStart !== undefined && maxEnd !== undefined && total === 0) ? Math.max(0, maxEnd - minStart) : total;
  return { steps, currentStepIndex, totalDurationMs: fallback };
}
