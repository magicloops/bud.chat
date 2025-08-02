'use client';

import React from 'react';
import MarkdownRenderer from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';

interface TextSegmentProps {
  segment: {
    type: 'text';
    text: string;
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
      className={cn('text-segment', className)}
      data-testid="segment-text"
      data-type="text"
    >
      <MarkdownRenderer content={segment.text} />
    </div>
  );
}