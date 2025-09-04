'use client';

import React, { useEffect, useState } from 'react';
import { TextSegment } from './TextSegment';
import StreamingTextSegment from './StreamingTextSegment';
import { ProgressIndicator } from './ProgressIndicator';
import MarkdownRenderer from '@/components/markdown-renderer';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';
import { getRenderableSegments, deriveSteps } from '@/lib/streaming/rendering';
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
  showSteps?: boolean; // Controls expansion of non-text steps post-stream
}

export function SequentialSegmentRenderer({ 
  event, 
  allEvents, 
  isStreaming = false,
  className,
  showSteps = false,
}: SequentialSegmentRendererProps) {
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
  const renderSegments = getRenderableSegments(event, allEvents);
  const firstTextIndex = renderSegments.findIndex(s => s.type === 'text');
  const isStep = (s: Segment) => s.type === 'reasoning' || s.type === 'tool_call' || s.type === 'web_search_call' || s.type === 'code_interpreter_call';
  const preTextSegments = firstTextIndex >= 0 ? renderSegments.slice(0, firstTextIndex).filter(isStep) : [];
  const hasPreTextSteps = preTextSegments.length > 0;

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
            <div key={key} className="text-segment my-1">
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
  // Suppress progress indicator if an ephemeral overlay is present for this event
  let hasOverlay = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getOverlay } = require('@/lib/streaming/ephemeralOverlayRegistry');
    hasOverlay = !!getOverlay(event.id);
  } catch {}
  const shouldShowProgress = !!(progressState?.isVisible && progressState.currentActivity && !hasOverlay);
  const hasContent = renderSegments.length > 0;

  // Derive steps (non-text) for post-stream display; active step not used here
  const { steps } = deriveSteps(event);
  
  // Typing indicator is handled inside StreamingTextSegment; disable here to avoid duplication
  const shouldShowTypingIndicator = false;

  return (
    <div className={className}>
      {/* Streaming: render only text segments; current phase shown via EphemeralOverlay */}
      {isStreaming ? (
        <>
          {renderSegments.map((segment, index) => segment.type === 'text' ? renderSegment(segment, index) : null)}
        </>
      ) : (
        // Post-stream: hide pre-text steps behind header toggle; always render text; post-text steps render inline
        <>
          {hasPreTextSteps ? (
            <div className="mb-2">
              {showSteps && (
                <div className="mb-2 space-y-1">
                  {renderSegments.map((segment, index) => {
                    if (index >= firstTextIndex) return null; // pre-text only
                    return isStep(segment) ? renderSegment(segment, index) : null;
                  })}
                </div>
              )}
              {/* Always render text segments in order */}
              {renderSegments.map((segment, index) => segment.type === 'text' ? renderSegment(segment, index) : null)}
              {/* Render post-text non-text segments inline */}
              {renderSegments.map((segment, index) => {
                if (index <= firstTextIndex) return null;
                return isStep(segment) ? renderSegment(segment, index) : null;
              })}
            </div>
          ) : (
            // Single (or zero) step: render everything inline in order
            <>{renderSegments.map(renderSegment)}</>
          )}
        </>
      )}
      {/* Steps UI intentionally omitted here (owned by EventItem) */}
      
      {/* Show typing indicator for empty assistant events */}
      {shouldShowTypingIndicator && (
        <div className="text-segment my-1" data-testid="typing-indicator">
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
