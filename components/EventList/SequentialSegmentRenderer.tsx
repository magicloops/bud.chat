'use client';

import React from 'react';
// Legacy segment renderers are no longer used for steps
import { TextSegment } from './TextSegment';
import StreamingTextSegment from './StreamingTextSegment';
import { ProgressIndicator } from './ProgressIndicator';
import MarkdownRenderer from '@/components/markdown-renderer';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';
// Steps UI is rendered by EventItem; keep this renderer focused on content

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

  const renderSegment = (segment: Segment, index: number) => {
    const key = segment.type === 'reasoning' || segment.type === 'tool_call' || 
                segment.type === 'web_search_call' || segment.type === 'code_interpreter_call'
      ? segment.id || `${segment.type}-${index}`
      : `${segment.type}-${index}`;

    switch (segment.type) {
      case 'reasoning':
        // Hidden; shown via StepsOverlay/StepsDropdown
        return null;
        
      case 'tool_call':
        // Hidden; shown via StepsOverlay/StepsDropdown
        return null;
        
      case 'text': {
        // When streaming, render a streaming text segment for the first text segment only
        if (isStreaming && !firstTextRendered) {
          firstTextRendered = true;
          return (
            <StreamingTextSegment
              key={key}
              eventId={event.id}
              baseText={segment.text || ''}
              isStreaming={true}
            />
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
        // Tool results are rendered inline with their corresponding tool calls
        // So we don't render them separately here
        return null;
        
      case 'web_search_call':
      case 'code_interpreter_call':
        // Hidden; shown via StepsOverlay/StepsDropdown
        return null;
        
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
      {sortedSegments.map(renderSegment)}
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
