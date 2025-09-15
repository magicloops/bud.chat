'use client';

import React, { useEffect, useRef, useState } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { getDraft } from '@budchat/streaming';

interface StreamingTextSegmentProps {
  eventId: string;
  baseText: string;
  isStreaming: boolean;
}

export function StreamingTextSegment({ eventId, baseText, isStreaming }: StreamingTextSegmentProps) {
  const [text, setText] = useState<string>(() => {
    const draft = getDraft(eventId);
    const draftText = draft?.segments?.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
    return (baseText || '') + (draftText?.text || '');
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // On mount or eventId change, initialize text
    const initDraft = getDraft(eventId);
    const initTextSeg = initDraft?.segments?.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
    setText((baseText || '') + (initTextSeg?.text || ''));

    if (!isStreaming) {
      return;
    }

    const update = () => {
      const draft = getDraft(eventId);
      const seg = draft?.segments?.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
      const next = (baseText || '') + (seg?.text || '');
      setText(prev => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    intervalRef.current = setInterval(update, 50);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [eventId, baseText, isStreaming]);

  // When streaming and no text yet, render nothing (ephemeral overlay handles activity)
  if (isStreaming && (!text || !text.trim())) return null;
  if (!text || !text.trim()) return null;

  return <div className="text-segment my-1" data-testid="segment-text" data-type="text"><MarkdownRenderer content={text} /></div>;
}

export default StreamingTextSegment;
