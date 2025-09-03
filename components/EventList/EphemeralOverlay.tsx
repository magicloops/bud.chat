'use client';

import React, { useEffect, useState } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { EphemeralOverlayState, subscribeOverlay, getOverlay } from '@/lib/streaming/ephemeralOverlayRegistry';

interface EphemeralOverlayProps {
  eventId: string;
}

export function EphemeralOverlay({ eventId }: EphemeralOverlayProps) {
  const [state, setState] = useState<EphemeralOverlayState | null>(() => getOverlay(eventId));

  useEffect(() => {
    return subscribeOverlay(eventId, setState);
  }, [eventId]);

  if (!state || state.kind === 'idle') return null;

  switch (state.kind) {
    case 'reasoning': {
      const text = state.reasoning?.text || '';
      return (
        <div className="mb-2 p-2 bg-muted/30 rounded border border-muted">
          {text ? (
            <div className="prose prose-xs max-w-none dark:prose-invert">
              <MarkdownRenderer content={text} />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
              <span>Thinking…</span>
            </div>
          )}
        </div>
      );
    }
    case 'tool': {
      return (
        <div className="mb-2 p-2 bg-muted/30 rounded border border-muted text-xs text-muted-foreground">
          <span>Using {state.tool?.name || 'tool'}…</span>
        </div>
      );
    }
    case 'built_in': {
      return (
        <div className="mb-2 p-2 bg-muted/30 rounded border border-muted text-xs text-muted-foreground">
          <span>Working…</span>
        </div>
      );
    }
    case 'writing': {
      return (
        <div className="mb-2 p-2 bg-muted/30 rounded border border-muted text-xs text-muted-foreground">
          <span>Writing…</span>
        </div>
      );
    }
    default:
      return null;
  }
}

export default EphemeralOverlay;

