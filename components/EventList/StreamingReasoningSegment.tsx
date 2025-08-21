'use client';

import React, { useEffect, useRef, useState } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { streamingBus } from '@/lib/streaming/streamingBus';
import { Badge } from '@/components/ui/badge';
import { Loader2, Brain } from 'lucide-react';

interface StreamingReasoningSegmentProps {
  eventId: string;
  isStreaming: boolean;
}

export function StreamingReasoningSegment({ eventId, isStreaming }: StreamingReasoningSegmentProps) {
  const [text, setText] = useState<string>(streamingBus.getReasoning(eventId));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const update = () => {
      const next = streamingBus.getReasoning(eventId);
      setText(prev => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    intervalRef.current = setInterval(update, 33);
    const unsub = streamingBus.subscribeReasoning(eventId, update);
    // Initial sync
    update();
    return () => {
      unsub();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [eventId]);

  const hasContent = !!text && text.trim().length > 0;
  // Only show when we actually have content; don't display an empty panel while streaming
  if (!hasContent) return null;

  return (
    <div className="reasoning-segment mb-3" data-testid={`streaming-reasoning-${eventId}`} data-type="reasoning">
      <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
        <div className="reasoning-header mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground flex items-center">
            <Brain className="h-3 w-3 mr-1" /> Model Reasoning
            {isStreaming && <Loader2 className="h-3 w-3 ml-2 animate-spin inline" />}
          </span>
          <Badge variant="outline" className="text-xs py-0 px-1 h-auto">streaming</Badge>
        </div>
        {hasContent ? (
          <div className="reasoning-text prose prose-xs max-w-none dark:prose-invert">
            <MarkdownRenderer content={text} />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Thinking…</div>
        )}
      </div>
    </div>
  );
}

export default StreamingReasoningSegment;
