'use client';

import React, { useEffect, useState } from 'react';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';
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

  return (
    <div className={className}>
      {/* During streaming: show overlays until text starts; then hide reasoning overlay and show collapsible */}
      {isStreaming ? (
        <>
          {!textStarted && (
            <StreamingReasoningSegment eventId={event.id} isStreaming={true} />
          )}
          {/* Tools overlay can still show during streaming regardless of text */}
          <StreamingToolsOverlay eventId={event.id} />
          {textStarted && (
            ordered.map((segment, idx) => {
              if (segment.type === 'reasoning') {
                const key = (segment as any).id || `${segment.type}-${idx}`;
                return (
                  <ReasoningSegment
                    key={key}
                    // @ts-expect-error segment shape is compatible
                    segment={segment as any}
                    isStreaming={false}
                    autoExpanded={false}
                    isLastSegment={idx === ordered.length - 1}
                  />
                );
              }
              return null;
            })
          )}
        </>
      ) : (
        ordered.map((segment, idx) => {
          const key = (segment as any).id || `${segment.type}-${idx}`;
          switch (segment.type) {
            case 'reasoning':
              return (
                <ReasoningSegment
                  key={key}
                  // @ts-expect-error segment shape is compatible
                  segment={segment as any}
                  isStreaming={false}
                  autoExpanded={false}
                  isLastSegment={idx === ordered.length - 1}
                />
              );
            case 'tool_call':
              return (
                <ToolCallSegment
                  key={key}
                  // @ts-expect-error segment shape is compatible
                  segment={segment as any}
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
                  // @ts-expect-error segment shape is compatible
                  segment={segment as any}
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
