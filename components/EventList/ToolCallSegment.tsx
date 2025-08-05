'use client';

import React, { useState } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { Event } from '@/state/eventChatStore';

interface ToolCallSegmentProps {
  segment: {
    type: 'tool_call';
    id: string;
    name: string;
    args: object;
    metadata?: {
      server_label?: string;
      display_name?: string;
      server_type?: string;
    };
    server_label?: string;
    display_name?: string;
    server_type?: string;
    output_index?: number;
    sequence_number?: number;
    // For Responses API, output is stored directly on tool_call
    output?: object;
    error?: string;
  };
  event?: Event; // Parent event to find tool results in same event
  allEvents?: Event[]; // To find corresponding tool results
  isStreaming?: boolean;
  className?: string;
}

export function ToolCallSegment({ 
  segment, 
  event,
  allEvents,
  isStreaming = false,
  className 
}: ToolCallSegmentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Find the corresponding tool result
  // For Responses API, check if output is directly on the tool_call segment
  let hasResult = segment.output !== undefined;
  let hasError = segment.error !== undefined;
  let resultOutput = segment.output;
  let resultError = segment.error;
  
  // If not on the segment itself, look for separate tool_result segment
  if (!hasResult) {
    // First check in the same event
    let resultSegment = event?.segments.find(seg => 
      seg.type === 'tool_result' && seg.id === segment.id
    ) as { type: 'tool_result'; id: string; output: object; error?: string } | undefined;
    
    // If not found in same event, check other events (for traditional tool calls)
    if (!resultSegment && allEvents) {
      const toolResult = allEvents.find(e => 
        e.segments.some(seg => 
          seg.type === 'tool_result' && seg.id === segment.id
        )
      );
      
      resultSegment = toolResult?.segments.find(seg => 
        seg.type === 'tool_result' && seg.id === segment.id
      ) as { type: 'tool_result'; id: string; output: object; error?: string } | undefined;
    }
    
    if (resultSegment) {
      hasResult = true;
      hasError = resultSegment.error !== undefined;
      resultOutput = resultSegment.output;
      resultError = resultSegment.error;
    }
  }
  
  // Get result content
  const resultContent = hasError 
    ? resultError 
    : resultOutput ? (
        typeof resultOutput === 'object' && 
        resultOutput !== null && 
        'content' in resultOutput
          ? (resultOutput as { content: string }).content
          : JSON.stringify(resultOutput, null, 2)
      ) : null;

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Show loading animation if no result yet (same logic as original EventItem)
  const showLoadingAnimation = !hasResult;

  return (
    <div 
      className={cn('tool-call-segment mt-2 mb-2', className)}
      data-testid={`segment-tool-call-${segment.sequence_number || 'no-seq'}`}
      data-type="tool_call"
    >
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Tool Call: {segment.metadata?.display_name || segment.display_name || segment.name}
          </span>
          
          {/* Server label for MCP tools */}
          {(segment.metadata?.server_label || segment.server_label) && (
            <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded">
              {segment.metadata?.server_label || segment.server_label}
            </span>
          )}
          
          {/* Loading animation */}
          {showLoadingAnimation && (
            <div className="flex space-x-1 items-end">
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-high-bounce [animation-delay:-0.3s]"></div>
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-high-bounce [animation-delay:-0.15s]"></div>
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-high-bounce"></div>
            </div>
          )}
          
          {/* Result status */}
          {hasResult && (
            <div className="flex items-center">
              {hasError ? (
                <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
              ) : (
                <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
              )}
            </div>
          )}
          
          {/* Expand/collapse toggle */}
          <button
            onClick={toggleExpanded}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Details
          </button>
        </div>
      
        {/* Collapsible tool details */}
        {isExpanded && (
          <div className="mt-3 border-t pt-3 space-y-3">
            {/* Tool Input Section */}
            <div>
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">Arguments:</div>
                <pre className="text-xs text-muted-foreground bg-background/50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(segment.args, null, 2)}
                </pre>
              </div>
            </div>
          
            {/* Tool Result Section */}
            {hasResult && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {hasError ? (
                    <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  )}
                  <span className="text-sm font-medium">
                    {hasError ? 'Tool Error' : 'Tool Result'}
                  </span>
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {hasError ? 'Error:' : 'Output:'}
                  </div>
                  <div className={cn(
                    'rounded p-2 text-xs overflow-x-auto max-h-[500px] overflow-y-auto',
                    hasError 
                      ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800'
                      : 'bg-background/50'
                  )}>
                    {hasError ? (
                      <div className="text-red-600 dark:text-red-400">
                        {resultContent}
                      </div>
                    ) : (
                      <div className="prose prose-xs max-w-none dark:prose-invert">
                        <MarkdownRenderer content={resultContent || ''} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}