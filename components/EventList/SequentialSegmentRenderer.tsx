'use client';

import React from 'react';
import { TextSegment } from './TextSegment';
import StreamingTextSegment from './StreamingTextSegment';
import { ProgressIndicator } from './ProgressIndicator';
import MarkdownRenderer from '@/components/markdown-renderer';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';
import { ReasoningSegment } from './ReasoningSegment';
import StreamingReasoningSegment from './StreamingReasoningSegment';
import StreamingToolsOverlay from './StreamingToolsOverlay';
import { streamingBus } from '@/lib/streaming/streamingBus';
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
  // Sort segments by sequence_number, falling back to array order for segments without sequence_number
  const sortedSegments = [...event.segments].sort((a, b) => {
    // Get sequence numbers, using Infinity for segments without them to maintain array order
    const aSeq = 'sequence_number' in a && a.sequence_number !== undefined ? a.sequence_number : Infinity;
    const bSeq = 'sequence_number' in b && b.sequence_number !== undefined ? b.sequence_number : Infinity;
    
    // If both have sequence numbers, sort by them
    if (aSeq !== Infinity && bSeq !== Infinity) {
      return aSeq - bSeq;
    }
    
    // If neither has sequence numbers, maintain original array order
    if (aSeq === Infinity && bSeq === Infinity) {
      return event.segments.indexOf(a) - event.segments.indexOf(b);
    }
    
    // If only one has a sequence number, prioritize it
    return aSeq - bSeq;
  });

  let firstTextRendered = false;
  let toolsOverlayInserted = false;

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
                baseText={segment.text || ''}
                isStreaming={true}
              />
              {/* Insert tools overlay immediately after first text if tools already started */}
              {(() => {
                if (!toolsOverlayInserted && streamingBus.getTools(event.id).length > 0) {
                  toolsOverlayInserted = true;
                  return <div className="mt-2"><StreamingToolsOverlay eventId={event.id} /></div>;
                }
                return null;
              })()}
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
        // Do not render separately; ToolCallSegment displays result when available
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
        // Handle any unknown segment types gracefully
        console.warn('Unknown segment type:', (segment as unknown as { type: string }).type);
        return null;
    }
  };

  // Check if progress indicator should be shown
  const progressState = event.progressState;
  const shouldShowProgress = progressState?.isVisible && progressState.currentActivity;
  const hasContent = sortedSegments.length > 0;
  
  // Typing indicator is handled inside StreamingTextSegment; disable here to avoid duplication
  const shouldShowTypingIndicator = false;

  return (
    <div className={className}>
      {/* If tools have started before any text/reasoning is rendered, show overlay first */}
      {(() => {
        if (isStreaming && !toolsOverlayInserted && streamingBus.getTools(event.id).length > 0) {
          toolsOverlayInserted = true;
          return <div className="mb-2"><StreamingToolsOverlay eventId={event.id} /></div>;
        }
        return null;
      })()}
      {sortedSegments.map(renderSegment)}
      {/* Fallback: if not yet inserted but tools exist, append at end */}
      {(() => {
        if (isStreaming && !toolsOverlayInserted && streamingBus.getTools(event.id).length > 0) {
          toolsOverlayInserted = true;
          return <div className="mt-2"><StreamingToolsOverlay eventId={event.id} /></div>;
        }
        return null;
      })()}
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
