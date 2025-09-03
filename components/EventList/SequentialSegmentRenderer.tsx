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
}

export function SequentialSegmentRenderer({ 
  event, 
  allEvents, 
  isStreaming = false,
  className 
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

  // Derive ephemeral steps (non-text) and active step
  const { steps, currentStepIndex, totalDurationMs } = deriveSteps(event);
  // Fallback: if no explicit current step, prefer first reasoning step to ensure overlay mounts
  const effectiveStepIndex = currentStepIndex !== null
    ? currentStepIndex
    : (() => {
        const idx = steps.findIndex(s => s.type === 'reasoning');
        return idx >= 0 ? idx : null;
      })();
  const hasMultipleSteps = steps.length > 1;
  const [showSteps, setShowSteps] = React.useState(false);
  const toggleShowSteps = () => setShowSteps(s => !s);
  
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
        // Post-stream: collapse multiple steps into a single summary button; otherwise render inline
        <>
          {hasMultipleSteps ? (
            <div className="mb-2">
              <button onClick={toggleShowSteps} className="text-xs text-muted-foreground hover:text-foreground underline">
                {totalDurationMs > 0 
                  ? `Ran for ${Math.max(0, Math.round(totalDurationMs / 100) / 10)}s` 
                  : 'Steps'} {showSteps ? '▾' : '▸'}
              </button>
              {showSteps && (
                <div className="mt-2 space-y-1">
                  {renderSegments.map((segment, index) => {
                    if (segment.type === 'text') return null; // steps only
                    return renderSegment(segment, index);
                  })}
                </div>
              )}
              {/* Render all text segments in order */}
              {renderSegments.map((segment, index) => segment.type === 'text' ? renderSegment(segment, index) : null)}
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
