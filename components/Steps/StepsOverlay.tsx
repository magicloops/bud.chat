"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, TerminalSquare } from 'lucide-react';
import { Segment } from '@/lib/types/events';
import { streamingBus } from '@/lib/streaming/streamingBus';
import MarkdownRenderer from '@/components/markdown-renderer';

interface StepsOverlayProps {
  eventId: string;
  segments: Segment[];
  isStreaming: boolean;
}

export default function StepsOverlay({ eventId, segments, isStreaming }: StepsOverlayProps) {
  const [reasoningText, setReasoningText] = useState<string>(() => streamingBus.getReasoning(eventId));
  const [codeItemId, setCodeItemId] = useState<string | null>(null);
  const [codeText, setCodeText] = useState<string>('');

  // Track current active code interpreter item id, if any
  useEffect(() => {
    const activeCode = segments.find(s => s.type === 'code_interpreter_call' && s.status !== 'completed');
    const id = activeCode && activeCode.type === 'code_interpreter_call' ? activeCode.id : undefined;
    setCodeItemId(id || null);
  }, [segments]);

  // Subscribe to reasoning overlay text
  useEffect(() => {
    const update = () => {
      const next = streamingBus.getReasoning(eventId);
      setReasoningText(prev => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    const unsub = streamingBus.subscribeReasoning(eventId, update);
    // Initial sync
    update();
    return () => unsub();
  }, [eventId]);

  // Subscribe to code overlay text for the active code item
  useEffect(() => {
    if (!codeItemId) {
      setCodeText('');
      return;
    }
    const update = () => {
      const next = streamingBus.getCode(codeItemId);
      setCodeText(prev => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    const unsub = streamingBus.subscribeCode(codeItemId, update);
    // Initial
    update();
    return () => unsub();
  }, [codeItemId]);

  // Determine which overlay to show: reasoning text takes priority, then code, else tool status
  const activeWebSearch = useMemo(() => segments.find(s => s.type === 'web_search_call' && s.status !== 'completed'), [segments]);
  const hasReasoning = reasoningText && reasoningText.trim().length > 0;
  const hasCode = codeText && codeText.trim().length > 0;
  const showOverlay = isStreaming && (hasReasoning || hasCode || !!activeWebSearch);
  if (!showOverlay) return null;

  return (
    <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-muted" data-testid={`steps-overlay-${eventId}`}>
      {hasReasoning && (
        <div className="text-xs">
          <div className="mb-1 text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Thinking…</span>
          </div>
          <MarkdownRenderer content={reasoningText} />
        </div>
      )}
      {!hasReasoning && hasCode && (
        <div className="text-xs">
          <div className="mb-1 text-muted-foreground inline-flex items-center gap-2">
            <TerminalSquare className="h-3 w-3" />
            <span>Running code…</span>
          </div>
          <pre className="text-[11px] bg-background/60 p-2 rounded overflow-auto">{codeText}</pre>
        </div>
      )}
      {!hasReasoning && !hasCode && activeWebSearch && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Search className="h-3 w-3" />
          <span>Web search: {activeWebSearch.status}</span>
          {activeWebSearch.status !== 'completed' && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
      )}
    </div>
  );
}
