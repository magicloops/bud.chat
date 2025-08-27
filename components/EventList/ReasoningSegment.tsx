'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import MarkdownRenderer from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';
import { ChevronDown, Loader2 } from 'lucide-react';

interface ReasoningSegmentProps {
  segment: {
    type: 'reasoning';
    id: string;
    output_index: number;
    sequence_number: number;
    parts: Array<{
      summary_index: number;
      type: 'summary_text';
      text: string;
      sequence_number: number;
      is_complete: boolean;
      created_at: number;
    }>;
    combined_text?: string;
    effort_level?: 'low' | 'medium' | 'high';
    reasoning_tokens?: number;
    streaming?: boolean;
    streaming_part_index?: number;
  };
  isStreaming?: boolean;
  autoExpanded?: boolean; // For streaming segments that should start expanded
  isLastSegment?: boolean; // Whether this is the last segment in the event
  className?: string;
}

export function ReasoningSegment({ 
  segment, 
  isStreaming = false,
  autoExpanded = false,
  isLastSegment = false,
  className 
}: ReasoningSegmentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [wasManuallyToggled, setWasManuallyToggled] = useState(false);
  const [wasStreaming, setWasStreaming] = useState(autoExpanded || isStreaming || segment.streaming);
  
  // Track if this segment was streaming
  useEffect(() => {
    if (segment.streaming || isStreaming) {
      setWasStreaming(true);
    }
  }, [segment.streaming, isStreaming]);
  
  // Auto-collapse reasoning when streaming finishes
  useEffect(() => {
    const isCurrentlyStreaming = segment.streaming || isStreaming;
    
    // Only auto-collapse if:
    // 1. Not currently streaming
    // 2. Is expanded 
    // 3. Was streaming at some point
    // 4. Was NOT manually toggled by user
    if (!isCurrentlyStreaming && isExpanded && wasStreaming && !wasManuallyToggled) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 500); // Small delay to allow users to see the completion
      
      return () => clearTimeout(timer);
    }
  }, [segment.streaming, isStreaming, isExpanded, wasStreaming, wasManuallyToggled]);
  
  // Determine if this reasoning segment is currently streaming
  const isReasoningStreaming = segment.streaming || (isStreaming && isLastSegment);

  // Compute which parts to render:
  // - While streaming, show only the current streaming part to minimize UI churn
  // - When not streaming, render all parts (sorted)
  const streamingIndex = segment.streaming_part_index;
  const partsToRender = isReasoningStreaming && streamingIndex !== undefined
    ? segment.parts.filter(p => p.summary_index === streamingIndex)
    : [...segment.parts].sort((a, b) => a.summary_index - b.summary_index);

  // Check if we have any content in parts
  const hasAnyContent = partsToRender.some(part => part.text && part.text.trim());
  
  // Check if reasoning is complete (currently unused but kept for potential future use)
  // const isReasoningComplete = !segment.streaming && (
  //   !!segment.combined_text ||
  //   segment.parts.every(part => part.is_complete)
  // );
  
  // Auto-show reasoning while streaming, otherwise user controls visibility
  const shouldShowReasoning = isExpanded;
  
  // Don't render if no content and not streaming (allow empty segments during streaming)
  if (!hasAnyContent && !isReasoningStreaming) {
    return null;
  }

  return (
    <div 
      className={cn('reasoning-segment mb-3', className)}
      data-testid={`segment-reasoning-${segment.sequence_number || 'no-seq'}`}
      data-type="reasoning"
    >
      {/* Toggle button (always visible) */}
      <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsExpanded(!isExpanded);
            setWasManuallyToggled(true);
          }}
          className="reasoning-toggle text-xs px-2 py-1 h-auto"
        >
          {isExpanded ? 'Hide' : 'Show'} Reasoning
          <ChevronDown className={cn(
            "h-3 w-3 ml-1 transition-transform",
            isExpanded && "rotate-180"
          )} />
        </Button>
      
      {shouldShowReasoning && (
        <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
          <div className="reasoning-text prose prose-xs max-w-none dark:prose-invert">
            <div className="reasoning-parts space-y-4">
              {partsToRender.map((part, index) => (
                <div key={part.summary_index || index} className="reasoning-part py-1">
                  {isReasoningStreaming && !part.is_complete && (
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </div>
                  )}
                  <div className="text-xs">
                    <MarkdownRenderer content={part.text} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
