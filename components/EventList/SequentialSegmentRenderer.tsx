'use client';

import React from 'react';
import { ReasoningSegment } from './ReasoningSegment';
import { ToolCallSegment } from './ToolCallSegment';
import { TextSegment } from './TextSegment';
import { ProgressIndicator } from './ProgressIndicator';
import { Event } from '@/state/eventChatStore';
import { Segment } from '@/lib/types/events';

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
    // Get sequence numbers, defaulting to 0 for segments without them
    const aSeq = 'sequence_number' in a ? a.sequence_number || 0 : 0;
    const bSeq = 'sequence_number' in b ? b.sequence_number || 0 : 0;
    
    // If both have sequence numbers, sort by them
    if (aSeq !== 0 && bSeq !== 0) {
      return aSeq - bSeq;
    }
    
    // If only one has a sequence number, prioritize it
    if (aSeq !== 0) return -1;
    if (bSeq !== 0) return 1;
    
    // If neither has sequence numbers, maintain original order
    return 0;
  });

  const renderSegment = (segment: Segment, index: number) => {
    const key = segment.type === 'reasoning' || segment.type === 'tool_call' 
      ? segment.id || `${segment.type}-${index}`
      : `${segment.type}-${index}`;

    switch (segment.type) {
      case 'reasoning':
        return (
          <ReasoningSegment
            key={key}
            segment={segment}
            isStreaming={isStreaming}
            autoExpanded={segment.streaming || isStreaming}
          />
        );
        
      case 'tool_call':
        return (
          <ToolCallSegment
            key={key}
            segment={segment}
            allEvents={allEvents}
            isStreaming={isStreaming}
          />
        );
        
      case 'text':
        return (
          <TextSegment
            key={key}
            segment={segment}
          />
        );
        
      case 'tool_result':
        // Tool results are rendered inline with their corresponding tool calls
        // So we don't render them separately here
        return null;
        
      default:
        // Handle any unknown segment types gracefully
        console.warn('Unknown segment type:', (segment as any).type);
        return null;
    }
  };

  // Check if progress indicator should be shown
  const progressState = event.progressState;
  const shouldShowProgress = progressState?.isVisible && progressState.currentActivity;
  const hasContent = sortedSegments.length > 0;

  return (
    <div className={className}>
      {sortedSegments.map(renderSegment)}
      
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