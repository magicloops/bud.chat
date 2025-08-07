'use client';

import React from 'react';
import { ReasoningSegment } from './ReasoningSegment';
import { ToolCallSegment } from './ToolCallSegment';
import { TextSegment } from './TextSegment';
import { ProgressIndicator } from './ProgressIndicator';
import MarkdownRenderer from '@/components/markdown-renderer';
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
            isLastSegment={index === sortedSegments.length - 1}
          />
        );
        
      case 'tool_call':
        return (
          <ToolCallSegment
            key={key}
            segment={segment}
            event={event}
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
        console.warn('Unknown segment type:', (segment as unknown as { type: string }).type);
        return null;
    }
  };

  // Check if progress indicator should be shown
  const progressState = event.progressState;
  const shouldShowProgress = progressState?.isVisible && progressState.currentActivity;
  const hasContent = sortedSegments.length > 0;
  
  // Check if we should show typing indicator
  // Only show if: assistant role, streaming, and only has empty text segment(s)
  const shouldShowTypingIndicator = event.role === 'assistant' && 
    isStreaming && 
    sortedSegments.length > 0 &&
    sortedSegments.every(seg => 
      seg.type === 'text' && (!seg.text || !seg.text.trim())
    );

  return (
    <div className={className}>
      {sortedSegments.map(renderSegment)}
      
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