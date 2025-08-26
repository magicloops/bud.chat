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
  allEvents?: { segments: Segment[] }[]; // Optional, used to detect MCP tool completion
}

export default function StepsOverlay({ eventId, segments, isStreaming, allEvents }: StepsOverlayProps) {
  const UI_DEBUG = process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true';
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
  // Detect active MCP tool call (no corresponding tool_result yet)
  const activeMcpCall = useMemo(() => {
    const toolCall = segments.find(s => s.type === 'tool_call');
    if (!toolCall || toolCall.type !== 'tool_call') return null;
    // If we don't have allEvents, assume running while streaming
    if (!allEvents || allEvents.length === 0) return toolCall;
    const hasResult = allEvents.some(ev => ev.segments.some(seg => seg.type === 'tool_result' && seg.id === toolCall.id));
    return hasResult ? null : toolCall;
  }, [segments, allEvents]);
  const hasReasoning = reasoningText && reasoningText.trim().length > 0;
  const hasCode = codeText && codeText.trim().length > 0;
  const showOverlay = isStreaming && (hasReasoning || hasCode || !!activeWebSearch || !!activeMcpCall);
  if (UI_DEBUG) {
    if (showOverlay) {
      console.log('[STREAM][ui] overlay_show', {
        eventId,
        hasReasoning,
        hasCode,
        hasWebSearch: !!activeWebSearch,
        hasMcp: !!activeMcpCall,
        ts: Date.now()
      });
    }
  }
  if (!showOverlay) return null;

  // Debug: measure time-to-paint after reasoning overlay updates
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STREAM_DEBUG !== 'true') return;
    if (!hasReasoning) return;
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const id = requestAnimationFrame(() => {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // eslint-disable-next-line no-console
      console.log('[STREAM][ui][render] reasoning_render', { eventId, len: reasoningText.length, ms: Math.round(end - start), ts: Date.now() });
    });
    return () => cancelAnimationFrame(id);
  }, [reasoningText, hasReasoning, eventId]);

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
      {!hasReasoning && !hasCode && !activeWebSearch && activeMcpCall && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <TerminalSquare className="h-3 w-3" />
          <span>Using tool: {(activeMcpCall as any).display_name || activeMcpCall.name || 'tool'}</span>
          <Loader2 className="h-3 w-3 animate-spin" />
        </div>
      )}
    </div>
  );
}
