'use client';

import React from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';

interface TextSegmentProps {
  segment: {
    type: 'text';
    text: string;
    citations?: Array<{
      url: string;
      title: string;
      start_index: number;
      end_index: number;
    }>;
  };
  className?: string;
}

export function TextSegment({ segment, className }: TextSegmentProps) {
  // Don't render empty text segments
  if (!segment.text || !segment.text.trim()) {
    return null;
  }

  return (
    <div 
      className={cn('text-segment my-1', className)}
      data-testid="segment-text"
      data-type="text"
    >
      <MarkdownRenderer content={segment.text} />
      
      {/* Render citations if available */}
      {segment.citations && segment.citations.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/30">
          <div className="text-xs text-muted-foreground mb-1">Sources:</div>
          <div className="flex flex-wrap gap-2">
            {segment.citations.map((citation, index) => (
              <a
                key={index}
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 bg-muted hover:bg-muted/80 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>🔗</span>
                <span className="truncate max-w-[200px]">{citation.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
