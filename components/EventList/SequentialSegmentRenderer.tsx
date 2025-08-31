'use client';

import React, { useEffect, useState } from 'react';
import { TextSegment } from './TextSegment';
import StreamingTextSegment from './StreamingTextSegment';
import { ProgressIndicator } from './ProgressIndicator';
import MarkdownRenderer from '@/components/markdown-renderer';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';
import { getRenderableSegments } from '@/lib/streaming/rendering';
import { ReasoningSegment } from './ReasoningSegment';
import StreamingReasoningSegment from './StreamingReasoningSegment';
// Removed overlay dependency
import { ToolCallSegment } from './ToolCallSegment';
import { BuiltInToolSegment } from './BuiltInToolSegment';

interface SequentialSegmentRendererProps {
  event: Event;
  allEvents?: Event[]; // For finding tool results
  isStreaming?: boolean;
  className?: string;
}

export function SequentialSegmentRenderer({ 
  event, 
  allEvents, 
  isStreaming = false,
  className 
}: SequentialSegmentRendererProps) {
  const dbg = (msg: string, obj: any) => {
    if (process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true' || process.env.NEXT_PUBLIC_RESPONSES_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.debug('[STREAM][Renderer]', msg, obj);
    }
  };
  // Poll progress from EventBuilder draft so indicator updates during streaming
  const [progressState, setProgressState] = useState(() => event.progressState);
  useEffect(() => {
    if (!isStreaming) { setProgressState(event.progressState); return; }
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getDraft } = require('@/lib/streaming/eventBuilderRegistry');
      const tick = () => {
        const d = getDraft(event.id) || event;
        const ps = d.progressState;
        setProgressState(prev => {
          const changed = JSON.stringify(prev) !== JSON.stringify(ps);
          return changed ? (ps ? { ...ps } : undefined) : prev;
        });
      };
      timer = setInterval(tick, 80);
      tick();
    } catch {
      // ignore
    }
    return () => { if (timer) clearInterval(timer); };
  }, [event.id, isStreaming]);
  // Build a normalized, renderable list of segments; preserve original order
  dbg('renderer_in', { eventId: event.id, role: (event as any).role, isStreaming, segTypes: event.segments.map(s => (s as any).type) });
  const renderSegments = getRenderableSegments(event, allEvents);
  dbg('render_segments', { eventId: event.id, segTypes: renderSegments.map(s => (s as any).type) });

  let firstTextRendered = false;
  // No overlays; segments render inline from Event (or draft)

  const renderSegment = (segment: Segment, index: number) => {
    const key = segment.type === 'reasoning' || segment.type === 'tool_call' || 
                segment.type === 'web_search_call' || segment.type === 'code_interpreter_call'
      ? segment.id || `${segment.type}-${index}`
      : `${segment.type}-${index}`;

    switch (segment.type) {
      case 'reasoning':
        // During streaming, show live overlay; otherwise show collapsed reasoning
        return isStreaming ? (
          <StreamingReasoningSegment key={`stream-reasoning-${key}`} eventId={event.id} isStreaming={true} />
        ) : (
          <ReasoningSegment
            key={key}
            segment={segment}
            isStreaming={false}
            autoExpanded={false}
            isLastSegment={false}
          />
        );
        
      case 'tool_call':
        // Render tool call inline; shows loading until result is available
        return (
          <ToolCallSegment
            key={key}
            segment={segment}
            event={event}
            allEvents={allEvents}
            isStreaming={isStreaming}
          />
        );
        
      case 'text': {
        // When streaming, render a streaming text segment for the first text segment only
        if (isStreaming && !firstTextRendered) {
          firstTextRendered = true;
          return (
            <React.Fragment key={`frag-${key}`}>
              <StreamingTextSegment
                eventId={event.id}
                baseText={''}
                isStreaming={true}
              />
            </React.Fragment>
          );
        }
        return (
          <TextSegment
            key={key}
            segment={segment}
          />
        );
      }
        
      case 'tool_result':
        // Should not occur because getRenderableSegments removes standalone tool_result
        return null;
        
      case 'web_search_call':
      case 'code_interpreter_call':
        return (
          <BuiltInToolSegment
            key={key}
            segment={segment as Extract<Segment, { type: 'web_search_call' } | { type: 'code_interpreter_call' }>}
            isStreaming={isStreaming}
          />
        );
        
      default:
        // Fallback: render unknown segments as JSON for now
        try {
          return (
            <div key={key} className="text-segment">
              <MarkdownRenderer content={`
\n\n\n\n\n\n\n\n` +
                '```json\n' +
                JSON.stringify(segment as any, null, 2) +
                '\n```'} />
            </div>
          );
        } catch {
          return null;
        }
    }
  };

  // Check if progress indicator should be shown
  const shouldShowProgress = progressState?.isVisible && progressState.currentActivity;
  const hasContent = renderSegments.length > 0;
  
  // Typing indicator is handled inside StreamingTextSegment; disable here to avoid duplication
  const shouldShowTypingIndicator = false;

  return (
    <div className={className}>
      {renderSegments.map(renderSegment)}
      {/* Steps UI intentionally omitted here (owned by EventItem) */}
      
      {/* Show typing indicator for empty assistant events */}
      {shouldShowTypingIndicator && (
        <div className="text-segment" data-testid="typing-indicator">
          <MarkdownRenderer content="|" />
        </div>
      )}
      
      {/* Show progress indicator at the bottom of content (or top if no content) */}
      {shouldShowProgress && (
        <ProgressIndicator
          currentActivity={progressState.currentActivity}
          hasContent={hasContent}
          serverLabel={progressState.serverLabel}
        />
      )}
    </div>
  );
}
