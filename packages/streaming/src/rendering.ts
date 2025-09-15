import { Event, Segment } from '@budchat/events';

export function getRenderableSegments(event: Event, allEvents?: Event[]): Segment[] {
  const renderable: Segment[] = [];
  for (const seg of event.segments as Segment[]) {
    if (seg.type === 'tool_result') continue;
    if (seg.type === 'tool_call') {
      let output = (seg as any).output as unknown;
      let error = (seg as any).error as string | undefined;
      if (output === undefined) {
        const inline = event.segments.find(s => s.type === 'tool_result' && (s as any).id === seg.id) as any;
        if (inline) {
          output = inline.output; error = inline.error;
        } else if (allEvents) {
          const external = allEvents.find(e => e.role === 'tool' && e.segments.some(s => s.type === 'tool_result' && (s as any).id === seg.id));
          if (external) {
            const res = external.segments.find(s => s.type === 'tool_result' && (s as any).id === seg.id) as any;
            if (res) { output = res.output; error = res.error; }
          }
        }
      }
      renderable.push({ ...(seg as any), output, error } as any);
      continue;
    }
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
