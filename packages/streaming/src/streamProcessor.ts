// Minimal SSE processor to decouple Response parsing from app logic

export async function* sseIterator(response: Response): AsyncGenerator<any> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          if (payload === '' || payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            yield data;
          } catch {
            // Skip malformed JSON lines but keep stream alive
            continue;
          }
        }
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
  const isDebug = (() => {
    try {
      // Prefer window flags in browser
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w: any = (typeof window !== 'undefined') ? window : undefined;
      const winFlag = !!(w && (w.__STREAM_DEBUG || w.__RESPONSES_DEBUG));
      const ls = typeof window !== 'undefined' ? (window.localStorage?.getItem('STREAM_DEBUG') === '1' || window.localStorage?.getItem('RESPONSES_DEBUG') === '1') : false;
      const env = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true' || process.env.NEXT_PUBLIC_RESPONSES_DEBUG === 'true') : false;
      return winFlag || ls || env;
    } catch { return false; }
  })();

  for await (const data of sseIterator(response)) {
    try { await handlers.onAny?.(data); } catch {}
    const t = (data && data.type) || 'unknown';
    if (isDebug) {
      try {
        // eslint-disable-next-line no-console
        console.debug('[SSE][client] event', { type: t, keys: Object.keys(data || {}) });
      } catch {}
    }
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
