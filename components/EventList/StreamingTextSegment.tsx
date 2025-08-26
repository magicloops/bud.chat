'use client';

import React, { useEffect, useRef, useState } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { streamingBus } from '@/lib/streaming/streamingBus';

interface StreamingTextSegmentProps {
  eventId: string;
  baseText: string;
  isStreaming: boolean;
}

export function StreamingTextSegment({ eventId, baseText, isStreaming }: StreamingTextSegmentProps) {
  // Already-rendered content
  const [text, setText] = useState(() => baseText + streamingBus.get(eventId));
  // Track how much of the bus buffer we've consumed
  const consumedLenRef = useRef<number>(streamingBus.get(eventId).length);
  // Accumulate new chars since last paint
  const pendingRef = useRef<string>('');
  // Coalesced flush timer (time-based throttle)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushRef = useRef<number>(0);

  // Reset when eventId or base text changes
  useEffect(() => {
    const buf = streamingBus.get(eventId);
    setText(baseText + buf);
    consumedLenRef.current = buf.length;
    pendingRef.current = '';
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastFlushRef.current = 0;
  }, [eventId, baseText]);

  // Subscribe to streaming bus and coalesce updates with adaptive throttling
  useEffect(() => {
    if (!isStreaming) return;

    const flush = () => {
      if (pendingRef.current) {
        setText(prev => prev + pendingRef.current);
        pendingRef.current = '';
        // Notify scroll listeners once per frame
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
      }
      timerRef.current = null;
      lastFlushRef.current = Date.now();
    };

    // Choose a flush interval based on content size to avoid re-parsing huge markdown too often
    const getIntervalMs = () => {
      const totalLen = (text?.length || 0) + pendingRef.current.length;
      if (totalLen < 2000) return 16;     // ~60 fps for very short text
      if (totalLen < 8000) return 33;     // ~30 fps
      if (totalLen < 20000) return 66;    // ~15 fps
      if (totalLen < 50000) return 100;   // 10 fps
      return 200;                          // 5 fps for very large outputs
    };

    const scheduleFlush = () => {
      if (timerRef.current != null) return;
      const interval = getIntervalMs();
      const elapsed = Date.now() - (lastFlushRef.current || 0);
      const delay = Math.max(0, interval - elapsed);
      timerRef.current = setTimeout(flush, delay);
    };

    const onDelta = () => {
      const buf = streamingBus.get(eventId);
      const prevLen = consumedLenRef.current;
      if (buf.length > prevLen) {
        pendingRef.current += buf.slice(prevLen);
        consumedLenRef.current = buf.length;
        scheduleFlush();
      }
    };

    const unsub = streamingBus.subscribe(eventId, onDelta);
    return () => {
      unsub();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [eventId, isStreaming]);

  // Debug: measure time-to-paint after text updates
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STREAM_DEBUG !== 'true') return;
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const id = requestAnimationFrame(() => {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const len = (text || '').length;
      // Keep this log lightweight
      // eslint-disable-next-line no-console
      console.log('[STREAM][ui][render] text_render', { eventId, len, ms: Math.round(end - start), ts: Date.now() });
    });
    return () => cancelAnimationFrame(id);
  }, [text, eventId]);

  // When streaming and no text yet, show typing cursor
  if (isStreaming && (!text || !text.trim())) {
    return (
      <div className="text-segment" data-testid="typing-indicator" data-type="text">
        <MarkdownRenderer content="|" />
      </div>
    );
  }
  if (!text || !text.trim()) return null;

  return <div className="text-segment" data-testid="segment-text" data-type="text"><MarkdownRenderer content={text} /></div>;
}

export default StreamingTextSegment;
