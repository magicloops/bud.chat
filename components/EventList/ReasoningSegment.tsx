'use client';

import React, { useState, useEffect } from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';
import { Loader2, ChevronRight, ChevronDown } from 'lucide-react';

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
  // Per-part expansion state
  const [expandedParts, setExpandedParts] = useState<Record<number, boolean>>({});
  const [wasManuallyToggled, setWasManuallyToggled] = useState(false);
  const [wasStreaming, setWasStreaming] = useState(autoExpanded || isStreaming || segment.streaming);
  
  // Track if this segment was streaming
  useEffect(() => {
    if (segment.streaming || isStreaming) {
      setWasStreaming(true);
    }
  }, [segment.streaming, isStreaming]);
  
  // Auto-collapse reasoning when streaming finishes (no-op for per-part UI)
  useEffect(() => {
    const isCurrentlyStreaming = segment.streaming || isStreaming;
    
    // If needed, could auto-collapse parts after stream ends.
    if (!isCurrentlyStreaming && wasStreaming && !wasManuallyToggled) {
      // leave collapsed by default; no action needed
    }
  }, [segment.streaming, isStreaming, wasStreaming, wasManuallyToggled]);
  
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
  
  // Don't render if no content and not streaming (allow empty segments during streaming)
  if (!hasAnyContent && !isReasoningStreaming) {
    return null;
  }

  const togglePart = (summaryIndex: number) => {
    setExpandedParts(prev => ({ ...prev, [summaryIndex]: !prev[summaryIndex] }));
    setWasManuallyToggled(true);
  };

  const extractTitle = (md: string): string => {
    if (!md) return 'Reasoning';
    // First bold section delimited by **...** (dotAll replacement for broader TS targets)
    const m = md.match(/\*\*([\s\S]+?)\*\*/);
    if (m && m[1]) return m[1].trim();
    // Fallback: first line
    const firstLine = md.split('\n')[0]?.trim();
    if (firstLine) return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
    return 'Reasoning';
  };

  const toTitleMarkdown = (md: string): string => {
    const title = extractTitle(md);
    return `**${title}**`;
  };

  const toBodyMarkdown = (md: string): string => {
    if (!md) return '';
    // If there is a bold title, remove only the first bold segment
    const m = md.match(/\*\*([\s\S]+?)\*\*/);
    if (m && typeof m.index === 'number') {
      const start = m.index as number;
      const end = start + m[0].length;
      let body = md.slice(0, start) + md.slice(end);
      // Trim a single leading newline/whitespace left by removal
      body = body.replace(/^\s*\n?/, '');
      return body;
    }
    // Fallback: remove the first line if we used it as the title
    const nl = md.indexOf('\n');
    if (nl >= 0) {
      return md.slice(nl + 1).replace(/^\s*\n?/, '');
    }
    return '';
  };

  return (
    <div 
      className={cn('reasoning-segment my-2', className)}
      data-testid={`segment-reasoning-${segment.sequence_number || 'no-seq'}`}
      data-type="reasoning"
    >
      {/* Reasoning parts: collapsed title (from **bold**) that expands to full markdown on click */}
      <div className="reasoning-content mt-1">
        <div className="space-y-2">
          {partsToRender.map((part, index) => {
            const open = !!expandedParts[part.summary_index];
            const titleMd = toTitleMarkdown(part.text);
            const bodyMd = toBodyMarkdown(part.text);
            return (
              <div
                key={part.summary_index || index}
                className={cn(
                  'reasoning-part transition-colors bg-muted/30 border border-muted rounded-lg p-3'
                )}
              >
                <div
                  className="flex items-center gap-2 cursor-pointer select-none rounded px-0 py-0.5 hover:bg-muted/40"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => togglePart(part.summary_index)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePart(part.summary_index); } }}
                >
                  {isReasoningStreaming && !part.is_complete && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                  <div className="prose prose-xs max-w-none dark:prose-invert flex-1">
                    <MarkdownRenderer content={titleMd} />
                  </div>
                  <div className="ml-2 text-muted-foreground">
                    {open ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </div>
                </div>
                {open && (
                  <div className="prose prose-xs max-w-none dark:prose-invert mt-2">
                    <MarkdownRenderer content={bodyMd} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
