'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { getDraft } from '@budchat/streaming';
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
  // Use the latest part by summary_index (even if complete) so we always show the newest text
  const latestPart = useMemo(() => {
    if (!parts || parts.length === 0) return null;
    const sorted = [...parts].sort((a, b) => a.summary_index - b.summary_index);
    return sorted[sorted.length - 1];
  }, [parts]);
  const hasContent = !!latestPart && (latestPart.text || '').trim().length > 0;

  const dbg = (msg: string, obj: any) => {
    if (process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true' || process.env.NEXT_PUBLIC_RESPONSES_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.debug('[STREAM][Reasoning]', msg, obj);
    }
  };

  dbg('reasoning_overlay', { where: 'reasoning_overlay', eventId, hasAnyPart, latestLen: latestPart ? (latestPart.text || '').length : 0 });

  // no debug logs
  // Only show when we actually have an active, in-progress part
  if (!hasAnyPart) return null;

  return (
    <div className="reasoning-segment my-2" data-testid={`streaming-reasoning-${eventId}`} data-type="reasoning">
      <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
        <div className="reasoning-text prose prose-xs max-w-none dark:prose-invert">
          {hasContent ? (
            <div key={(latestPart as any).summary_index} className="mb-2">
              <MarkdownRenderer content={(latestPart as any).text || ''} />
            </div>
          ) : (
            // Show a minimal placeholder when no text has arrived yet
            <div className="mb-2 text-muted-foreground text-xs flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
              <span>Thinking…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StreamingReasoningSegment;
