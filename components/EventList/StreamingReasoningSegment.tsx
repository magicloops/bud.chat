'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { getDraft } from '@/lib/streaming/eventBuilderRegistry';
// no extra UI chrome imports needed here

interface StreamingReasoningSegmentProps {
  eventId: string;
  isStreaming: boolean;
}

export function StreamingReasoningSegment({ eventId, isStreaming }: StreamingReasoningSegmentProps) {
  const [parts, setParts] = useState<Array<{ summary_index: number; text: string; is_complete: boolean; sequence_number?: number; created_at?: number }>>(() => {
    const draft = getDraft(eventId);
    const reasoning = draft?.segments?.find(s => s.type === 'reasoning') as any;
    if (!reasoning || !Array.isArray(reasoning.parts)) return [];
    return reasoning.parts.map((p: any) => ({ summary_index: p.summary_index, text: p.text, is_complete: !!p.is_complete, sequence_number: p.sequence_number, created_at: p.created_at }));
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const update = () => {
      const draft = getDraft(eventId);
      const reasoning = draft?.segments?.find(s => s.type === 'reasoning') as any;
      const next = reasoning && Array.isArray(reasoning.parts)
        ? reasoning.parts.map((p: any) => ({ summary_index: p.summary_index, text: p.text, is_complete: !!p.is_complete, sequence_number: p.sequence_number, created_at: p.created_at }))
        : [];
      setParts(prev => {
        if (prev.length === next.length && prev[prev.length - 1]?.text === next[next.length - 1]?.text) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    intervalRef.current = setInterval(update, 50);
    // Initial sync
    update();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [eventId]);

  const hasAnyPart = Array.isArray(parts) && parts.length > 0;
  const hasContent = hasAnyPart && parts.some(p => (p.text || '').trim().length > 0);
  // Determine the currently streaming (active) part: the highest summary_index that's not complete
  const activePart = useMemo(() => {
    if (!parts || parts.length === 0) return null;
    const incomplete = parts.filter(p => !p.is_complete);
    if (incomplete.length > 0) {
      return incomplete.sort((a, b) => a.summary_index - b.summary_index)[incomplete.length - 1];
    }
    return null;
  }, [parts]);

  const dbg = (msg: string, obj: any) => {
    if (process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true' || process.env.NEXT_PUBLIC_RESPONSES_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.debug('[STREAM][Reasoning]', msg, obj);
    }
  };

  dbg('reasoning_overlay', { where: 'reasoning_overlay', eventId, hasAnyPart, activePartExists: !!activePart });

  // no debug logs
  // Only show when we actually have an active, in-progress part
  if ((!hasContent && !(isStreaming && hasAnyPart)) || !hasAnyPart) return null;

  return (
    <div className="reasoning-segment mb-3" data-testid={`streaming-reasoning-${eventId}`} data-type="reasoning">
      <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
        <div className="reasoning-text prose prose-xs max-w-none dark:prose-invert">
          {activePart ? (
            <div key={activePart.summary_index} className="mb-2">
              <MarkdownRenderer content={activePart.text || ''} />
            </div>
          ) : (
            // Show placeholder container during streaming even before text arrives
            <div className="mb-2">
              <MarkdownRenderer content={''} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StreamingReasoningSegment;
