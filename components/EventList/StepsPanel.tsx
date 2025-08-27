'use client';

import React, { useEffect, useState } from 'react';
import { Event } from '@/state/eventChatStore';
import { Segment, ReasoningPart } from '@/lib/types/events';
import { ReasoningSegment } from './ReasoningSegment';
import { ToolCallSegment } from './ToolCallSegment';
import { BuiltInToolSegment } from './BuiltInToolSegment';
import StreamingReasoningSegment from './StreamingReasoningSegment';
import StreamingToolsOverlay from './StreamingToolsOverlay';
import { streamingBus } from '@/lib/streaming/streamingBus';

interface StepsPanelProps {
  event: Event;
  allEvents?: Event[];
  isStreaming?: boolean;
  className?: string;
}

function sortSegments(segments: Segment[], event: Event): Segment[] {
  // Sort by sequence_number when available, else preserve array order
  return [...segments].sort((a, b) => {
    const aSeq = 'sequence_number' in a && a.sequence_number !== undefined ? a.sequence_number : Infinity;
    const bSeq = 'sequence_number' in b && b.sequence_number !== undefined ? b.sequence_number : Infinity;
    if (aSeq !== Infinity && bSeq !== Infinity) return aSeq - bSeq;
    if (aSeq === Infinity && bSeq === Infinity) return event.segments.indexOf(a) - event.segments.indexOf(b);
    return aSeq - bSeq;
  });
}

export function StepsPanel({ event, allEvents, isStreaming = false, className }: StepsPanelProps) {
  const nonTextSegments = event.segments.filter(s =>
    s.type === 'reasoning' || s.type === 'tool_call' || s.type === 'web_search_call' || s.type === 'code_interpreter_call'
  );
  const ordered = sortSegments(nonTextSegments as Segment[], event);

  // Detect when text streaming has begun (to swap from overlay to collapsible)
  const [textStarted, setTextStarted] = useState<boolean>(false);
  useEffect(() => {
    if (!isStreaming) return;
    const compute = () => {
      const text = streamingBus.get(event.id);
      setTextStarted(!!text && text.length > 0);
    };
    const unsubA = streamingBus.subscribe(event.id, compute);
    const unsubB = streamingBus.subscribeReasoningParts(event.id, compute);
    compute();
    return () => { unsubA(); unsubB(); };
  }, [isStreaming, event.id]);

  // Gather reasoning content availability from either persisted segments or streaming bus
  const streamingParts = isStreaming ? streamingBus.getReasoningParts(event.id) : [];
  const hasStreamingReasoningContent = streamingParts.some(p => (p.text || '').trim().length > 0);
  const hasPersistedReasoningContent = ordered.some(
    (seg): seg is Extract<Segment, { type: 'reasoning' }> =>
      seg.type === 'reasoning' && Array.isArray(seg.parts) && seg.parts.some((p: ReasoningPart) => (p.text || '').trim().length > 0)
  );
  const hasAnyReasoningContent = hasPersistedReasoningContent || hasStreamingReasoningContent;

  // Helper: build a transient reasoning segment from streaming parts for the Show Reasoning panel
  type ReasoningSegmentType = Extract<Segment, { type: 'reasoning' }>;
  const buildStreamingReasoningSegment = (): ReasoningSegmentType => ({
    type: 'reasoning',
    id: `streaming-reasoning-${event.id}`,
    output_index: 0,
    sequence_number: 0,
    parts: streamingParts
      .filter(p => (p.text || '').trim().length > 0)
      .map(p => ({
        summary_index: p.summary_index,
        type: 'summary_text' as const,
        text: p.text,
        sequence_number: p.sequence_number ?? 0,
        is_complete: !!p.is_complete,
        created_at: p.created_at ?? Date.now(),
      })),
    streaming: false,
  });

  return (
    <div className={className}>
      {/* During streaming: show overlays until text starts; then hide reasoning overlay and show collapsible */}
      {isStreaming ? (
        <>
          {/* Ephemeral thinking overlay: only before text starts */}
          {!textStarted && (
            <StreamingReasoningSegment eventId={event.id} isStreaming={true} />
          )}
          {/* Tools overlay can still show during streaming regardless of text */}
          <StreamingToolsOverlay eventId={event.id} />
          {/* Show Reasoning toggle: visible during streaming whenever content exists (from persisted or streaming parts) */}
          {hasAnyReasoningContent && (
            <ReasoningSegment
              // During streaming, prefer transient segment from bus; otherwise fall back to persisted ordering
              segment={
                hasPersistedReasoningContent
                  ? (ordered.find((s): s is ReasoningSegmentType => s.type === 'reasoning') as ReasoningSegmentType)
                  : buildStreamingReasoningSegment()
              }
              isStreaming={false}
              autoExpanded={false}
              isLastSegment={true}
            />
          )}
        </>
      ) : (
        ordered.map((segment, idx) => {
          const key = ('id' in segment && segment.id) ? (segment as { id: string }).id : `${segment.type}-${idx}`;
          switch (segment.type) {
            case 'reasoning':
              return (
                <ReasoningSegment
                  key={key}
                  segment={segment as Extract<Segment, { type: 'reasoning' }>}
                  isStreaming={false}
                  autoExpanded={false}
                  isLastSegment={idx === ordered.length - 1}
                />
              );
            case 'tool_call':
              return (
                <ToolCallSegment
                  key={key}
                  segment={segment as Extract<Segment, { type: 'tool_call' }>}
                  event={event}
                  allEvents={allEvents}
                  isStreaming={false}
                />
              );
            case 'web_search_call':
            case 'code_interpreter_call':
              return (
                <BuiltInToolSegment
                  key={key}
                  segment={segment as Extract<Segment, { type: 'web_search_call' } | { type: 'code_interpreter_call' }>}
                  isStreaming={false}
                />
              );
            default:
              return null;
          }
      }))}
    </div>
  );
}

export default StepsPanel;
