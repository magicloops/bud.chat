'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import MarkdownRenderer from '@/components/markdown-renderer';
import { streamingBus } from '@/lib/streaming/streamingBus';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

interface StreamingReasoningSummaryProps {
  eventId: string;
  className?: string;
}

export default function StreamingReasoningSummary({ eventId, className }: StreamingReasoningSummaryProps) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState(() => streamingBus.getReasoningParts(eventId));

  useEffect(() => {
    const update = () => setParts(streamingBus.getReasoningParts(eventId));
    const unsub = streamingBus.subscribeReasoningParts(eventId, update);
    update();
    return () => unsub();
  }, [eventId]);

  const hasAnyText = useMemo(() => parts.some(p => (p.text || '').trim().length > 0), [parts]);
  if (!hasAnyText) return null;

  return (
    <div className={cn('reasoning-summary', className)} data-type="reasoning-summary">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        className="reasoning-toggle text-xs px-2 py-1 h-auto"
      >
        {open ? 'Hide' : 'Show'} Reasoning
        <ChevronDown className={cn('h-3 w-3 ml-1 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
          <div className="prose prose-xs max-w-none dark:prose-invert space-y-4">
            {parts
              .filter(p => (p.text || '').trim().length > 0)
              .sort((a, b) => a.summary_index - b.summary_index)
              .map(p => (
                <div key={p.summary_index} className="py-1">
                  <MarkdownRenderer content={p.text || ''} />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

