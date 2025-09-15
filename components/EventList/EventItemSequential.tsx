'use client';

import React, { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Event, Conversation } from '@/state/eventChatStore';
import { ToolCallId } from '@budchat/events';
import { useBud } from '@/state/budStore';
import { cn } from '@/lib/utils';
import { SequentialSegmentRenderer } from './SequentialSegmentRenderer';
import { getDraft } from '@budchat/streaming';
import StreamingTextSegment from './StreamingTextSegment';
import EphemeralOverlay from './EphemeralOverlay';
import { deriveSteps } from '@budchat/streaming';
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
  const isStreamingActive = isAssistant && !!conversation?.isStreaming && conversation?.streamingEventId === event.id;
  
  // Streaming header status: reasoning vs tools vs typing
  const [headerStatus, setHeaderStatus] = useState<'thinking' | 'using-tools' | 'typing'>('thinking');
  useEffect(() => {
    if (!(isStreamingActive || isStreaming)) return;
    const interval = setInterval(() => {
      const draft = getDraft(event.id);
      const segs = draft?.segments || event.segments;
      const toolCalls = segs.filter(s => s.type === 'tool_call') as any[];
      const toolResults = segs.filter(s => s.type === 'tool_result') as any[];
      // consider results that may arrive in separate 'tool' events (multi-turn execution)
      const unresolved = toolCalls.some(tc => {
        const resolvedInEvent = toolResults.some(tr => tr.id === tc.id);
        if (resolvedInEvent) return false;
        if (allEvents && allEvents.length > 0) {
          const resolvedInOthers = allEvents.some(e => e.segments.some(s => s.type === 'tool_result' && (s as any).id === tc.id));
          if (resolvedInOthers) return false;
        }
        return true;
      });
      if (unresolved) { setHeaderStatus('using-tools'); return; }
      const reasoning = segs.find(s => s.type === 'reasoning') as any;
      if (reasoning && reasoning.streaming) { setHeaderStatus('thinking'); return; }
      const textSeg = segs.find(s => s.type === 'text') as any;
      if (textSeg && textSeg.text && textSeg.text.length > 0) { setHeaderStatus('typing'); return; }
      setHeaderStatus('thinking');
    }, 100);
    return () => clearInterval(interval);
  }, [isStreamingActive, isStreaming, event.id, event.segments, allEvents]);
  
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
  
  // Prefer draft event from EventBuilder during streaming
  const displayEvent = isStreamingActive ? (getDraft(event.id) || event) : event;
  const hasStreamingText = useMemo(() => {
    if (!isStreamingActive) return false;
    try {
      const segs = (displayEvent?.segments || []) as any[];
      const textSeg = segs.find(s => s.type === 'text' && s.text && String(s.text).trim().length > 0);
      return !!textSeg;
    } catch {
      return false;
    }
  }, [isStreamingActive, displayEvent]);

  // Intentionally minimal logs here to avoid noise

  // Check if event has any content to render (use displayEvent so streaming text suppresses cursor)
  const hasSegments = displayEvent.segments && displayEvent.segments.length > 0;
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

  // Steps & duration for header button (post-stream only)
  const { steps } = useMemo(() => deriveSteps(event), [event]);
  // Determine if there are pre-text steps to hide behind the dropdown
  const firstTextIdx = useMemo(() => event.segments.findIndex(s => s.type === 'text'), [event]);
  const isStepSeg = (s: any) => s && (s.type === 'reasoning' || s.type === 'tool_call' || s.type === 'web_search_call' || s.type === 'code_interpreter_call');
  const hasPreTextSteps = useMemo(() => {
    if (firstTextIdx < 0) return false;
    return event.segments.slice(0, firstTextIdx).some(isStepSeg);
  }, [event, firstTextIdx]);
  // Compute duration for pre-text steps only
  const preTextStepIds = useMemo(() => {
    if (firstTextIdx < 0) return new Set<string>();
    const ids = new Set<string>();
    for (const seg of event.segments.slice(0, firstTextIdx)) {
      if (isStepSeg(seg)) {
        // Reasoning/tool_call have IDs; built-ins also have ids
        const id = (seg as any).id;
        if (id) ids.add(String(id));
      }
    }
    return ids;
  }, [event, firstTextIdx]);
  const preTextSteps = useMemo(() => steps.filter(s => preTextStepIds.has(String((s as any).id))), [steps, preTextStepIds]);
  const { totalDurationMs: preTextDurationMs } = useMemo(() => {
    let total = 0;
    let minStart: number | undefined;
    let maxEnd: number | undefined;
    for (const s of preTextSteps as any[]) {
      const started = s.started_at as number | undefined;
      const done = s.completed_at as number | undefined;
      if (started) minStart = minStart === undefined ? started : Math.min(minStart, started);
      if (done) maxEnd = maxEnd === undefined ? done : Math.max(maxEnd, done);
      if (started && done) total += Math.max(0, done - started);
    }
    const fallback = (minStart !== undefined && maxEnd !== undefined && total === 0) ? Math.max(0, maxEnd - minStart) : total;
    return { totalDurationMs: fallback };
  }, [preTextSteps]);
  const durationLabel = preTextDurationMs > 0
    ? `Ran for ${Math.max(0, Math.round(preTextDurationMs / 100) / 10)}s`
    : 'Steps';
  const [showSteps, setShowSteps] = useState(false);
  const toggleShowSteps = useCallback(() => setShowSteps(v => !v), []);
  
  // Determine if this should be a continuation (compact view)
  // Find the previous visible assistant event, skipping tool events that are not rendered
  const previousVisibleAssistant = useMemo(() => {
    if (!allEvents) return null;
    const idx = allEvents.findIndex(e => e.id === event.id);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      const e = allEvents[i];
      if (e.role === 'tool') continue; // skip hidden tool events
      if (e.role === 'assistant') return e;
      break; // stop on any non-tool, non-assistant event
    }
    return null;
  }, [allEvents, event.id]);
  const shouldShowAsContinuation = isAssistant && !!previousVisibleAssistant;

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

  // displayEvent already computed above

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
                · {isStreamingActive
                    ? (headerStatus === 'using-tools' ? 'using tools...' : 'thinking...')
                    : formatEventDuration(event, _index)}
              </span>
              {/* Steps button in header (post-stream only) */}
              {!isStreamingActive && hasPreTextSteps && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    onClick={toggleShowSteps}
                    className={cn(
                      'text-xs transition-colors',
                      showSteps ? 'font-semibold text-foreground' : 'italic text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {durationLabel} {showSteps ? '▾' : '▸'}
                  </button>
                </>
              )}
            </div>
          )}
          {/* Continuation view: show only the steps button above content if applicable */}
          {shouldShowAsContinuation && !isStreamingActive && hasPreTextSteps && (
            <div className="mb-1">
              <button
                onClick={toggleShowSteps}
                className={cn(
                  'text-xs transition-colors',
                  showSteps ? 'font-semibold text-foreground' : 'italic text-muted-foreground hover:text-foreground'
                )}
              >
                {durationLabel} {showSteps ? '▾' : '▸'}
              </button>
            </div>
          )}

          <div className="relative">
            {isStreamingActive && !hasStreamingText && (
              <EphemeralOverlay eventId={event.id} />
            )}
            {/* Typing cursor removed; ephemeral overlay indicates activity */}

            {/* Content: render segments inline; renderer handles streaming mode */}
            {(
              <SequentialSegmentRenderer
                event={displayEvent}
                allEvents={allEvents}
                isStreaming={isStreamingActive || isStreaming}
                showSteps={!isStreamingActive && showSteps}
              />
            )}

            {/* Steps are now rendered inline within SequentialSegmentRenderer to preserve segment order */}
            
            
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
