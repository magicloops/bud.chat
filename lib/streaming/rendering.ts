import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';

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

