'use client';

import React, { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Event, Conversation } from '@/state/eventChatStore';
import { ToolCallId } from '@/lib/types/branded';
import { useBud } from '@/state/budStore';
import { cn } from '@/lib/utils';
import { SequentialSegmentRenderer } from './SequentialSegmentRenderer';
import { streamingSessionManager } from '@/lib/streaming/StreamingSessionManager';
import StreamingTextSegment from './StreamingTextSegment';
import StepsPanel from './StepsPanel';
import {
  Copy,
  Edit,
  Trash2,
  GitBranch,
  MoreHorizontal,
  AlertCircle,
  // Wrench, // Not currently used
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface EventItemProps {
  event: Event
  conversation?: Conversation | null
  index?: number
  isLast?: boolean
  isStreaming?: boolean
  onEdit?: (eventId: string, newContent: string) => void
  onDelete?: (eventId: string) => void
  onBranch?: (eventId: string) => void
  allEvents?: Event[]
  previousEvent?: Event
}

export const EventItemSequential = memo(function EventItemSequential({
  event,
  conversation,
  index: _index = 0,
  isLast: _isLast,
  isStreaming = false,
  onEdit,
  onDelete,
  onBranch,
  allEvents,
  previousEvent,
}: EventItemProps) {
  const isSystem = event.role === 'system';
  const isUser = event.role === 'user';
  const isAssistant = event.role === 'assistant';
  const isTool = event.role === 'tool';
  
  // Determine if this event is the active streaming placeholder
  const session = streamingSessionManager.getState();
  const isStreamingActive = isAssistant && session.active && session.assistantEventId === event.id;
  
  // Extract text content for fallback and editing
  const textContent = event.segments
    .filter(s => s.type === 'text')
    .map(s => s.text)
    .join('');
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const [localTextContent, setLocalTextContent] = useState(textContent);
  
  // Error handling - check if any segments have errors
  const error = useMemo(() => {
    const errorSegments = event.segments.filter((segment): segment is { type: 'tool_result'; id: ToolCallId; output: object; error: string } => 
      segment.type === 'tool_result' && 'error' in segment && !!segment.error
    );
    return errorSegments.length > 0 ? { error: errorSegments[0].error } : null;
  }, [event.segments]);
  
  // Update local content when the event changes
  useEffect(() => {
    setLocalTextContent(textContent);
  }, [textContent]);
  
  // Check if event has any content to render
  const hasSegments = event.segments && event.segments.length > 0;
  const hasReasoningSegments = event.segments.some(s => s.type === 'reasoning');
  const hasToolCalls = event.segments.some(s => s.type === 'tool_call');
  // Outer steps toggle removed; rely on inner Reasoning/Tool controls

  
  // Load bud data if conversation has a source_bud_id
  const bud = useBud(conversation?.meta?.source_bud_id || '');
  const budConfig = bud?.default_json;
  
  // Get assistant identity with proper hierarchy:
  // 1. Conversation overrides (if explicitly set)
  // 2. Bud configuration
  // 3. Default values
  const assistantName = conversation?.meta?.assistant_name || 
                       (budConfig && typeof budConfig === 'object' && 'name' in budConfig ? budConfig.name as string : null) || 
                       'Assistant';
  const assistantAvatar = conversation?.meta?.assistant_avatar || 
                         (budConfig && typeof budConfig === 'object' && 'avatar' in budConfig ? budConfig.avatar as string : null) || 
                         '🤖';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(textContent);
  }, [textContent]);

  const handleEdit = useCallback(() => {
    if (onEdit) {
      setIsEditing(true);
    }
  }, [onEdit]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(event.id);
    }
  }, [onDelete, event.id]);

  const handleBranch = useCallback(() => {
    if (onBranch) {
      onBranch(event.id);
    }
  }, [onBranch, event.id]);

  const formatEventDuration = useCallback((event: Event, _index: number) => {
    const now = new Date();
    const eventDate = new Date(event.ts);
    const diffMs = now.getTime() - eventDate.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m ago`;
    } else {
      return 'just now';
    }
  }, []);

  const isPending = false;
  const canEdit = isUser && !isPending;
  const canDelete = !isPending;
  const canBranch = !isPending && !isSystem;
  
  // Determine if this should be a continuation (compact view)
  const shouldShowAsContinuation = isAssistant && previousEvent && 
    (previousEvent.role === 'assistant' || previousEvent.role === 'tool');

  // Render system messages with editing capability
  if (isSystem) {
    return (
      <div className="mb-6 group">
        <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded-lg relative">
          {isEditing ? (
            <div className="space-y-3">
              <textarea
                value={editingContent}
                onChange={(e) => setEditingContent(e.target.value)}
                className="w-full min-h-[100px] p-2 text-sm font-mono bg-transparent border border-yellow-300 dark:border-yellow-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder="Enter system prompt..."
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setLocalTextContent(editingContent);
                    if (onEdit) {
                      onEdit(event.id, editingContent);
                    }
                    setIsEditing(false);
                  }}
                  className="px-3 py-1 bg-yellow-600 text-white text-xs rounded hover:bg-yellow-700 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditingContent(localTextContent);
                  }}
                  className="px-3 py-1 bg-gray-400 text-white text-xs rounded hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground font-mono">
                {localTextContent}
              </div>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    setEditingContent(localTextContent);
                    setIsEditing(true);
                  }}
                  className="p-1 text-yellow-600 hover:text-yellow-800 hover:bg-yellow-100 rounded transition-colors"
                  title="Edit system message"
                >
                  <Edit className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  
  // Don't render standalone tool result events (they're shown within tool calls)
  if (isTool) {
    return null;
  }

  // Determine container classes based on view type
  const containerClasses = cn(
    'group @[768px]:pr-[42px]',
    shouldShowAsContinuation && 'continuation-view'
  );

  return (
    <div className={containerClasses}>
      <div className="flex items-start gap-3">
        {/* Avatar - only show for non-continuation or hide with opacity for spacing */}
        <Avatar className={cn('h-8 w-8', shouldShowAsContinuation && 'opacity-0')}>
          {isUser ? (
            <AvatarFallback>U</AvatarFallback>
          ) : (
            <AvatarFallback>
              <span className="text-lg">{assistantAvatar}</span>
            </AvatarFallback>
          )}
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Header - hide for continuation view */}
          {!shouldShowAsContinuation && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium">
                {isUser ? 'You' : assistantName}
              </span>
              <span className="text-xs text-muted-foreground">
                · {isStreaming ? (hasReasoningSegments || hasToolCalls ? 'thinking...' : 'typing...') : formatEventDuration(event, _index)}
              </span>
            </div>
          )}
          
          <div className="relative">
            {/* Streaming cursor when no content yet */}
            {isStreaming && !hasSegments && (
              <span className="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>
            )}

            {/* Steps panel on top (handles both streaming and non-streaming) */}
            {(isStreamingActive || (hasSegments && (hasReasoningSegments || hasToolCalls))) && (
              <div className="mb-2">
                <StepsPanel event={event} allEvents={allEvents} isStreaming={isStreamingActive || isStreaming} />
              </div>
            )}

            {/* Content: stream text for active placeholder; otherwise render segments */}
            {isStreamingActive ? (
              <StreamingTextSegment eventId={event.id} baseText={''} isStreaming={true} />
            ) : (
              hasSegments && (
                <SequentialSegmentRenderer
                  event={event}
                  allEvents={allEvents}
                  isStreaming={isStreaming}
                />
              )
            )}
            
            
            {/* Error Display */}
            {error && (
              <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>Error: {error.error}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem onClick={handleEdit}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
            {canBranch && (
              <DropdownMenuItem onClick={handleBranch}>
                <GitBranch className="h-4 w-4 mr-2" />
                Branch
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canDelete && (
              <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export default EventItemSequential;
