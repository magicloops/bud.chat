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
  const [text, setText] = useState(() => baseText + streamingBus.get(eventId));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // On mount or eventId change, initialize text
    setText(baseText + streamingBus.get(eventId));

    if (!isStreaming) {
      return;
    }

    const update = () => {
      const next = baseText + streamingBus.get(eventId);
      setText(prev => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    // Use streamingBus subscription only to avoid redundant interval updates
    const unsub = streamingBus.subscribe(eventId, update);
    return () => {
      unsub();
    };
  }, [eventId, baseText, isStreaming]);

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
