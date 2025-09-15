'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronDown, 
  ChevronRight, 
  Search,
  Code,
  Loader2,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Segment } from '@budchat/events';
import MarkdownRenderer from '@/components/markdown-renderer';

interface BuiltInToolSegmentProps {
  segment: (Segment & { type: 'web_search_call'; status: 'in_progress' | 'searching' | 'completed' | 'failed' }) |
           (Segment & { type: 'code_interpreter_call'; status: 'in_progress' | 'interpreting' | 'completed' | 'failed'; code?: string });
  isStreaming?: boolean;
  className?: string;
}

export function BuiltInToolSegment({ 
  segment, 
  isStreaming = false,
  className 
}: BuiltInToolSegmentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const isWebSearch = segment.type === 'web_search_call';
  const isCodeInterpreter = segment.type === 'code_interpreter_call';
  
  // Get appropriate icon and colors
  const getToolIcon = () => {
    if (isWebSearch) return <Search className="w-4 h-4" />;
    if (isCodeInterpreter) return <Code className="w-4 h-4" />;
    return null;
  };
  
  const getToolName = () => {
    if (isWebSearch) return 'Web Search';
    if (isCodeInterpreter) return 'Code Interpreter';
    return 'Built-in Tool';
  };
  
  const status = 'status' in segment ? segment.status : 'in_progress';
  
  const getStatusIcon = () => {
    switch (status) {
      case 'in_progress':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'searching':
      case 'interpreting':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-3 h-3 text-green-600" />;
      case 'failed':
        return <XCircle className="w-3 h-3 text-red-600" />;
      default:
        return null;
    }
  };
  
  const getStatusText = () => {
    switch (status) {
      case 'in_progress':
        return 'Starting...';
      case 'searching':
        return 'Searching...';
      case 'interpreting':
        return 'Interpreting...';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };
  
  const getStatusColor = () => {
    switch (status) {
      case 'in_progress':
      case 'searching':
      case 'interpreting':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };
  
  // Temporarily disable code interpreter UI
  const hasCode = false;
  const hasExpandableContent = false;
  
  return (
    <Card className={cn(
      "builtin-tool-segment border-l-4 border-l-blue-500 mb-3",
      className
    )}>
      <div className="p-3">
        <div 
          className={cn(
            "flex items-center gap-2",
            hasExpandableContent && "cursor-pointer hover:bg-muted/50 -m-3 p-3 rounded-lg"
          )}
          onClick={hasExpandableContent ? () => setIsExpanded(!isExpanded) : undefined}
        >
          {/* Expand/Collapse Icon */}
          {hasExpandableContent && (
            <div className="flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          )}
          
          {/* Tool Icon */}
          <div className="flex-shrink-0 text-blue-600 dark:text-blue-400">
            {getToolIcon()}
          </div>
          
          {/* Tool Name */}
          <span className="font-medium text-sm">
            {getToolName()}
          </span>
          
          {/* Status Badge */}
          <Badge variant="outline" className={cn("text-xs", getStatusColor())}>
            <div className="flex items-center gap-1">
              {getStatusIcon()}
              {getStatusText()}
            </div>
          </Badge>
          
          {/* Streaming indicator */}
          {(isStreaming && (status === 'searching' || status === 'interpreting')) && (
            <div className="flex-shrink-0">
              <div className="flex space-x-1">
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          )}
        </div>
        
        {/* Expandable Code Content (includes streaming overlay) */}
        {hasExpandableContent && isExpanded && (
          <div className="mt-3 pt-3 border-t border-border">
            {/* Code interpreter disabled */}
          </div>
        )}
        {/* Code interpreter disabled */}
      </div>
    </Card>
  );
}
