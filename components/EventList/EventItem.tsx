'use client';

import React, { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import MarkdownRenderer from '@/components/markdown-renderer';
import { Event, Conversation } from '@/state/eventChatStore';
import { ToolCallId } from '@/lib/types/branded';
import { cn } from '@/lib/utils';
import StepsDropdown from '@/components/Steps/StepsDropdown';
import StepsOverlay from '@/components/Steps/StepsOverlay';
import StreamingTextSegment from '@/components/EventList/StreamingTextSegment';
import {
  Copy,
  Edit,
  Trash2,
  GitBranch,
  MoreHorizontal,
  AlertCircle,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2
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

export const EventItem = memo(function EventItem({
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
  
  // Extract content from event segments
  const textContent = event.segments
    .filter(s => s.type === 'text')
    .map(s => s.text)
    .join('');
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const [localTextContent, setLocalTextContent] = useState(textContent);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const [showReasoning, setShowReasoning] = useState(false);
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
  
  // Extract tool calls, results, and reasoning segments
  const toolCalls = event.segments.filter(s => s.type === 'tool_call');
  const toolResults = event.segments.filter(s => s.type === 'tool_result');
  const reasoningSegments = event.segments.filter(s => s.type === 'reasoning');
  
  
  const isToolCall = toolCalls.length > 0;
  const isToolResult = toolResults.length > 0;
  const hasReasoningSegments = reasoningSegments.length > 0;
  
  // Get assistant identity - all events in a conversation should show the same identity
  // The conversation meta should already have the resolved identity (overrides or bud defaults)
  const assistantName = conversation?.meta?.assistant_name || 'Assistant';
  const assistantAvatar = conversation?.meta?.assistant_avatar || '🤖';

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

  // const isOptimistic = false; // Events don't have optimistic state like messages did
  const isPending = false;
  const canEdit = isUser && !isPending;
  const canDelete = !isPending;
  const canBranch = !isPending && !isSystem;
  
  // Unified reasoning logic - supports both new reasoning segments AND legacy reasoning field
  const hasReasoning = hasReasoningSegments || !!event.reasoning;
  
  // Check if reasoning is complete - prioritize reasoning segments over legacy field
  const isReasoningComplete = useMemo(() => {
    if (hasReasoningSegments) {
      // New unified segments model: check if all reasoning segments are complete
      return reasoningSegments.every(segment => {
        if (segment.type === 'reasoning') {
          return !segment.streaming && (
            !!segment.combined_text ||
            segment.parts.every(part => part.is_complete)
          );
        }
        return true;
      });
    } else if (event.reasoning) {
      // Legacy reasoning field: use existing logic
      return (
        !!event.reasoning.combined_text ||
        (event.reasoning.parts && Object.values(event.reasoning.parts).every(part => part.is_complete)) ||
        !event.reasoning.streaming_part_index
      );
    }
    return false;
  }, [hasReasoningSegments, reasoningSegments, event.reasoning]);
  
  // Reasoning is streaming if we have reasoning data but it's not complete
  const isReasoningStreaming = hasReasoning && !isReasoningComplete;
  
  // Get combined reasoning content from segments or legacy field
  const reasoningContent = useMemo(() => {
    if (hasReasoningSegments) {
      // New segments model: combine all reasoning segments that have content
      return reasoningSegments
        .sort((a, b) => {
          if (a.type === 'reasoning' && b.type === 'reasoning') {
            return (a.sequence_number || 0) - (b.sequence_number || 0);
          }
          return 0;
        })
        .map(segment => {
          if (segment.type === 'reasoning') {
            const content = segment.combined_text || segment.parts.map(part => part.text).join('\n');
            return content.trim();
          }
          return '';
        })
        .filter(content => content.length > 0) // Filter out empty content
        .join('\n\n');
    } else if (event.reasoning) {
      // Legacy reasoning field
      return event.reasoning.combined_text || 
        Object.values(event.reasoning.parts || {})
          .sort((a, b) => a.summary_index - b.summary_index)
          .map(part => part.text)
          .join('\n\n');
    }
    return '';
  }, [hasReasoningSegments, reasoningSegments, event.reasoning]);
  
  // Get reasoning effort level from segments or legacy field
  const reasoningEffortLevel = useMemo(() => {
    if (hasReasoningSegments) {
      // Find the first reasoning segment with effort level
      const segmentWithEffort = reasoningSegments.find(segment => 
        segment.type === 'reasoning' && segment.effort_level
      );
      return segmentWithEffort?.type === 'reasoning' ? segmentWithEffort.effort_level : undefined;
    }
    return event.reasoning?.effort_level;
  }, [hasReasoningSegments, reasoningSegments, event.reasoning]);
  
  
  // Auto-collapse logic: show reasoning while streaming, collapse when complete and other content exists
  const hasOtherContent = useMemo(() => {
    return event.segments.some(s => 
      s.type === 'text' && s.text.trim() || 
      s.type === 'tool_call' || 
      s.type === 'tool_result'
    );
  }, [event.segments]);
  
  // Show reasoning automatically while streaming, or manually when user toggles
  // Priority: manual toggle > auto-collapse logic
  const shouldShowReasoning = isReasoningStreaming || // Always show while streaming
    showReasoning || // Always show when user manually toggles it
    (hasReasoning && !hasOtherContent); // Auto-show if reasoning is the only content
    
  
  
  
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
                    // Optimistically update the local content
                    setLocalTextContent(editingContent);
                    
                    // Save the edited content
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
                    setEditingContent(localTextContent); // Reset to local content
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
  
  // Don't render standalone tool result events (they're now shown within tool calls)
  if (isTool || isToolResult) {
    return null;
  }

  // Render continuation view for assistant messages following other assistant/tool messages
  if (shouldShowAsContinuation) {
    const containerClasses = cn(
      'group @[768px]:pr-[42px]'
    );
    
    return (
      <div className={containerClasses}>
        <div className="flex items-start gap-3">
          {/* Invisible avatar for spacing */}
          <div className="w-8 h-8 opacity-0">
            <div className="w-8 h-8 rounded-full"></div>
          </div>
          
          <div className="flex-1 min-w-0">
            {/* Invisible header for spacing */}
            <div className="flex items-center gap-2 mb-1 hidden">
              <span className="text-sm font-medium">
                {assistantName}
              </span>
              <span className="text-xs text-muted-foreground">
                · {formatEventDuration(event, _index)}
              </span>
            </div>
            <div className="relative">
              {/* Streaming text handled by StreamingTextSegment; remove cursor */}
            
  
              {/* legacy reasoning UI removed */}
              {false && hasReasoning && (
                <div className="hidden">
                  {/* Only show toggle button when not streaming */}
                  {!isReasoningStreaming && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowReasoning(!showReasoning)}
                      className="reasoning-toggle text-xs px-2 py-1 h-auto"
                    >
                      {showReasoning ? 'Hide' : 'Show'} Reasoning
                      <ChevronDown className={cn(
                        "h-3 w-3 ml-1 transition-transform",
                        showReasoning && "rotate-180"
                      )} />
                    </Button>
                  )}
                  
                  {shouldShowReasoning && (
                    <div className="reasoning-content mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
                      <div className="reasoning-header mb-2 flex items-center gap-2">
                        {isReasoningStreaming && (
                          <Loader2 className="h-3 w-3 animate-spin inline text-muted-foreground" />
                        )}
                        {reasoningEffortLevel && (
                          <Badge variant="outline" className="text-xs py-0 px-1 h-auto">
                            {reasoningEffortLevel} effort
                          </Badge>
                        )}
                      </div>
                      
                      <div className="reasoning-text prose prose-xs max-w-none dark:prose-invert">
                        {reasoningContent && (
                          <MarkdownRenderer content={reasoningContent} />
                        )}
                        
                        {/* Show individual parts during streaming if no combined content yet */}
                        {!reasoningContent && hasReasoningSegments && reasoningSegments.some(segment => segment.type === 'reasoning') && (
                          <div className="reasoning-parts space-y-2">
                            {reasoningSegments
                              .filter(segment => segment.type === 'reasoning')
                              .sort((a, b) => {
                                if (a.type === 'reasoning' && b.type === 'reasoning') {
                                  return (a.sequence_number || 0) - (b.sequence_number || 0);
                                }
                                return 0;
                              })
                              .map((segment, index) => {
                                if (segment.type !== 'reasoning') return null;
                                return (
                                  <div key={segment.id || index} className="reasoning-part">
                                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                      <span>Reasoning {index + 1}</span>
                                      {segment.streaming && (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      )}
                                    </div>
                                    <div className="text-xs">
                                      {segment.parts.map((part, partIndex) => (
                                        <div key={partIndex} className="mb-2">
                                          <MarkdownRenderer content={part.text} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                        
                        {/* Legacy fallback for old reasoning format */}
                        {(() => {
                          const legacyParts = event.reasoning?.parts;
                          const legacyCount = Object.keys(legacyParts || {}).length;
                          const hasLegacy = !reasoningContent && !hasReasoningSegments && legacyCount > 0;
                          if (!hasLegacy || !legacyParts) return null;
                          const partsArray = Object.values(legacyParts || {});
                          return (
                          <div className="reasoning-parts space-y-2">
                            {partsArray
                              .sort((a, b) => a.summary_index - b.summary_index)
                              .map((part) => (
                                <div key={part.summary_index} className="reasoning-part">
                                  {!part.is_complete && (
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
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            
              {/* legacy tool call UI removed */}
              {false && isToolCall && toolCalls.length > 0 && (
                <div className="hidden">
                  {toolCalls.map((toolCall, index) => {
                    const toolCallSegment = toolCall as { type: 'tool_call'; id: string; name: string; args: object };
                    const toolResult = allEvents?.find(event => 
                      event.segments.some(segment => 
                        segment.type === 'tool_result' && segment.id === toolCallSegment.id
                      )
                    );
                    const resultSegment = toolResult?.segments.find(s => s.type === 'tool_result' && s.id === toolCallSegment.id) as 
                    { type: 'tool_result'; id: string; output: object } | undefined;
                  
                    const hasResult = resultSegment !== undefined;
                    const hasError = resultSegment && resultSegment.output && typeof resultSegment.output === 'object' && 'error' in resultSegment.output;
                    const resultContent = hasError 
                      ? (resultSegment.output as { error?: string }).error 
                      : resultSegment ? ((resultSegment.output as { content?: string }).content || JSON.stringify(resultSegment.output, null, 2)) : null;
                  
                    const isExpanded = expandedToolCalls.has(toolCallSegment.id);
                  
                    const toggleExpanded = () => {
                      const newExpanded = new Set(expandedToolCalls);
                      if (isExpanded) {
                        newExpanded.delete(toolCallSegment.id);
                      } else {
                        newExpanded.add(toolCallSegment.id);
                      }
                      setExpandedToolCalls(newExpanded);
                    };
                  
                    return (
                      <div key={index} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                          Tool Call: {toolCall.name}
                          </span>
                          {!hasResult && (
                            <div className="flex space-x-1 items-end">
                              <div className="w-1 h-1 bg-blue-500 rounded-full animate-high-bounce [animation-delay:-0.3s]"></div>
                              <div className="w-1 h-1 bg-blue-500 rounded-full animate-high-bounce [animation-delay:-0.15s]"></div>
                              <div className="w-1 h-1 bg-blue-500 rounded-full animate-high-bounce"></div>
                            </div>
                          )}
                          {hasResult && (
                            <div className="flex items-center">
                              {hasError ? (
                                <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
                              ) : (
                                <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
                              )}
                            </div>
                          )}
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
                                  {JSON.stringify(toolCall.args, null, 2)}
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
                    );
                  })}
                </div>
              )}
              {/* Steps overlay during streaming; steps dropdown for finalized */}
              {isStreaming ? (
                <StepsOverlay eventId={event.id} segments={event.segments} isStreaming={true} />
              ) : (
                <StepsDropdown event={event} />
              )}

              {/* Message text */}
              {isStreaming ? (
                <StreamingTextSegment eventId={event.id} baseText={textContent || ''} isStreaming={true} />
              ) : (
                textContent && <MarkdownRenderer content={textContent} />
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
  }

  const regularContainerClasses = cn(
    'group @[768px]:pr-[42px]'
  );

  return (
    <div className={regularContainerClasses}>
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8">
          {isUser ? (
            <AvatarFallback>
              U
            </AvatarFallback>
          ) : isTool || isToolResult ? (
            <AvatarFallback>
              <Wrench className="h-4 w-4" />
            </AvatarFallback>
          ) : (
            <AvatarFallback>
              <span className="text-lg">{assistantAvatar}</span>
            </AvatarFallback>
          )}
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">
              {isUser ? 'You' : (isTool || isToolResult) ? 'Tool' : assistantName}
            </span>
            <span className="text-xs text-muted-foreground">
              · {isStreaming ? (isReasoningStreaming || (isToolCall && !textContent) ? 'thinking...' : 'typing...') : formatEventDuration(event, _index)}
            </span>
          </div>
          <div className="relative">
            {/* Streaming text handled by StreamingTextSegment; remove cursor */}
            
  
              {/* legacy reasoning UI removed */}
            
            {/* Tool Call Display - should appear before text content */}
            {/* legacy tool call UI removed */}
            
              {/* Steps: overlay during streaming, dropdown after finalized */}
              {isStreaming ? (
                <StepsOverlay eventId={event.id} segments={event.segments} isStreaming={true} />
              ) : (
                <StepsDropdown event={event} />
              )}

              {/* Message Content */}
              {isStreaming ? (
                <StreamingTextSegment eventId={event.id} baseText={textContent || ''} isStreaming={true} />
              ) : (
                textContent && <MarkdownRenderer content={textContent} />
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

export default EventItem;
