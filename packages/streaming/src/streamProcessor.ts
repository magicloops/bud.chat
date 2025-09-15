// Minimal SSE processor to decouple Response parsing from app logic

export async function* sseIterator(response: Response): AsyncGenerator<any> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalize newlines and split into lines
      const parts = buffer.split(/\r?\n/);
      // Keep the last partial line in the buffer (no trailing newline)
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        if (line.startsWith('data:')) {
          // Support both 'data: ' and 'data:' prefixes
          const payload = line.startsWith('data: ')
            ? line.slice(6)
            : line.slice(5);
          if (!payload || payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            yield data;
          } catch {
            // Ignore malformed JSON; next chunks may contain valid events
          }
        }
      }
    }
    // Flush any final buffered complete line (unlikely, but safe)
    if (buffer && buffer.startsWith('data:')) {
      const payload = buffer.startsWith('data: ')
        ? buffer.slice(6)
        : buffer.slice(5);
      if (payload && payload !== '[DONE]') {
        try { yield JSON.parse(payload); } catch {}
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
}

export interface StreamHandlers {
  onEventStart?: (event: any, metadata?: any) => void | Promise<void>;
  onSegment?: (segment: any, segmentIndex?: number, eventId?: string) => void | Promise<void>;
  onEventComplete?: (event: any) => void | Promise<void>;
  onDone?: () => void | Promise<void>;
  onError?: (error: any) => void | Promise<void>;
  onAny?: (data: any) => void | Promise<void>;
}

/**
 * Dispatches standardized SSE events to callbacks. Supports both the unified
 * StreamingFormat events (event_start, segment, event_complete, complete, error)
 * and legacy 'done' events.
 */
export async function processSSE(response: Response, handlers: StreamHandlers): Promise<void> {
  for await (const data of sseIterator(response)) {
    try { await handlers.onAny?.(data); } catch {}
    const t = (data && data.type) || 'unknown';
    switch (t) {
      case 'event_start': {
        const ev = data?.data?.event ?? data.event;
        await handlers.onEventStart?.(ev, data?.metadata);
        break;
      }
      case 'segment': {
        const seg = data?.data?.segment ?? data.segment;
        const idx = data?.data?.segmentIndex ?? data.segmentIndex;
        const evId = (data?.data?.event ?? data.event)?.id;
        await handlers.onSegment?.(seg, idx, evId);
        break;
      }
      case 'event_complete': {
        const ev = data?.data?.event ?? data.event;
        await handlers.onEventComplete?.(ev);
        break;
      }
      case 'complete':
      case 'done': {
        await handlers.onDone?.();
        break;
      }
      case 'error': {
        const err = data?.data?.error ?? data.error ?? { code: 'STREAM_ERROR', message: 'Unknown error' };
        await handlers.onError?.(err);
        break;
      }
      default: {
        // Ignore, but still exposed via onAny above
        break;
      }
    }
  }
}
