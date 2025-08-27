'use client';

import React from 'react';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';
import { ReasoningSegment } from './ReasoningSegment';
import { ToolCallSegment } from './ToolCallSegment';
import { BuiltInToolSegment } from './BuiltInToolSegment';
import StreamingReasoningSegment from './StreamingReasoningSegment';
import StreamingToolsOverlay from './StreamingToolsOverlay';

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
  if (nonTextSegments.length === 0) return null;

  const ordered = sortSegments(nonTextSegments as Segment[], event);

  return (
    <div className={className}>
      {/* Live reasoning overlay during streaming without store churn */}
      {isStreaming && (
        <StreamingReasoningSegment eventId={event.id} isStreaming={true} />
      )}
      {/* Live tools overlay during streaming without store churn */}
      {isStreaming && (
        <StreamingToolsOverlay eventId={event.id} />
      )}
      {ordered.map((segment, idx) => {
        const key = (segment as any).id || `${segment.type}-${idx}`;
        switch (segment.type) {
          case 'reasoning':
            return (
              <ReasoningSegment
                key={key}
                // @ts-expect-error segment shape is compatible
                segment={segment as any}
                isStreaming={isStreaming}
                autoExpanded={true}
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
                isStreaming={isStreaming}
              />
            );
          case 'web_search_call':
          case 'code_interpreter_call':
            return (
              <BuiltInToolSegment
                key={key}
                // @ts-expect-error segment shape is compatible
                segment={segment as any}
                isStreaming={isStreaming}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

export default StepsPanel;
