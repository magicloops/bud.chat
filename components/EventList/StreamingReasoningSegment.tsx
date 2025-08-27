'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { streamingBus } from '@/lib/streaming/streamingBus';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface StreamingReasoningSegmentProps {
  eventId: string;
  isStreaming: boolean;
}

export function StreamingReasoningSegment({ eventId, isStreaming }: StreamingReasoningSegmentProps) {
  const [parts, setParts] = useState(() => streamingBus.getReasoningParts(eventId));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const update = () => {
      const next = streamingBus.getReasoningParts(eventId);
      setParts(prev => {
        // Shallow compare by length and last item reference to avoid unnecessary renders
        if (prev.length === next.length && prev[prev.length - 1] === next[next.length - 1]) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    intervalRef.current = setInterval(update, 50);
    const unsub = streamingBus.subscribeReasoningParts(eventId, update);
    // Initial sync
    update();
    return () => {
      unsub();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [eventId]);

  const hasContent = Array.isArray(parts) && parts.length > 0 && parts.some(p => (p.text || '').trim().length > 0);
  // Determine the currently streaming (active) part: the highest summary_index that's not complete
  const activePart = useMemo(() => {
    if (!parts || parts.length === 0) return null;
    const incomplete = parts.filter(p => !p.is_complete);
    if (incomplete.length > 0) {
      return incomplete.sort((a, b) => a.summary_index - b.summary_index)[incomplete.length - 1];
    }
    return null;
  }, [parts]);

  // no debug logs
  // Only show when we actually have an active, in-progress part
  if (!hasContent || !activePart) return null;

  return (
    <div className="reasoning-segment mb-3" data-testid={`streaming-reasoning-${eventId}`} data-type="reasoning">
      <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
        <div className="reasoning-text prose prose-xs max-w-none dark:prose-invert">
          {activePart && (
            <div key={activePart.summary_index} className="mb-2">
              <MarkdownRenderer content={activePart.text || ''} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StreamingReasoningSegment;
