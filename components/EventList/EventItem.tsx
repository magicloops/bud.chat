'use client'

import { memo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import MarkdownRenderer from '@/components/markdown-renderer'
import { Event, Conversation } from '@/state/eventChatStore'
import { cn } from '@/lib/utils'
import {
  Copy,
  Edit,
  Trash2,
  GitBranch,
  MoreHorizontal,
  Bot,
  AlertCircle,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  index = 0,
  isLast,
  isStreaming = false,
  onEdit,
  onDelete,
  onBranch,
  allEvents,
  previousEvent,
}: EventItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const error = null // TODO: Implement error handling in new architecture

  const isSystem = event.role === 'system'
  const isUser = event.role === 'user'
  const isAssistant = event.role === 'assistant'
  const isTool = event.role === 'tool'
  
  // Extract content from event segments
  const textContent = event.segments
    .filter(s => s.type === 'text')
    .map(s => s.text)
    .join('')
  
  // Extract tool calls and results
  const toolCalls = event.segments.filter(s => s.type === 'tool_call')
  const toolResults = event.segments.filter(s => s.type === 'tool_result')
  
  const isToolCall = toolCalls.length > 0
  const isToolResult = toolResults.length > 0
  
  // Get assistant identity - all events in a conversation should show the same identity
  // The conversation meta should already have the resolved identity (overrides or bud defaults)
  const assistantName = conversation?.meta?.assistant_name || 'Assistant'
  const assistantAvatar = conversation?.meta?.assistant_avatar || '🤖'

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(textContent)
  }, [textContent])

  const handleEdit = useCallback(() => {
    if (onEdit) {
      setIsEditing(true)
    }
  }, [onEdit])

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(event.id)
    }
  }, [onDelete, event.id])

  const handleBranch = useCallback(() => {
    if (onBranch) {
      onBranch(event.id)
    }
  }, [onBranch, event.id])

  const formatEventDuration = useCallback((event: Event, index: number) => {
    const now = new Date()
    const eventDate = new Date(event.ts)
    const diffMs = now.getTime() - eventDate.getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays > 0) {
      return `${diffDays}d ago`
    } else if (diffHours > 0) {
      return `${diffHours}h ago`
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m ago`
    } else {
      return 'just now'
    }
  }, [])

  const isOptimistic = false // Events don't have optimistic state like messages did
  const isPending = false
  const canEdit = isUser && !isPending
  const canDelete = !isPending
  const canBranch = !isPending && !isSystem
  
  // Determine if this should be a continuation (compact view)
  const shouldShowAsContinuation = isAssistant && previousEvent && 
    (previousEvent.role === 'assistant' || previousEvent.role === 'tool')

  // Don't render system messages in the old style
  if (isSystem) {
    return (
      <div className="mb-6 group">
        <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded-lg">
          <div className="text-sm text-muted-foreground font-mono">
            {textContent}
          </div>
        </div>
      </div>
    )
  }
  
  // Don't render standalone tool result events (they're now shown within tool calls)
  if (isTool || isToolResult) {
    return null
  }

  // Render continuation view for assistant messages following other assistant/tool messages
  if (shouldShowAsContinuation) {
    return (
      <div className={`mb-6 group @md:pr-[42px] ${index === 0 ? "pt-4" : ""}`}>
        <div className="flex items-start gap-3">
          {/* Empty space for avatar alignment */}
          <div className="w-8 h-8"></div>
          
          <div className="flex-1 min-w-0">
            <div className="relative">
            {isStreaming && !textContent && (
              <span className="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>
            )}
            
            {/* Regular Content First */}
            {textContent && (
              <MarkdownRenderer content={textContent} />
            )}
            
            {/* Tool Call Display (moved to end) */}
            {isToolCall && toolCalls.length > 0 && (
              <div className="mt-4 space-y-2">
                {toolCalls.map((toolCall, index) => {
                  const toolCallSegment = toolCall as { type: 'tool_call'; id: string; name: string; args: object }
                  const toolResult = allEvents?.find(event => 
                    event.segments.some(segment => 
                      segment.type === 'tool_result' && segment.id === toolCallSegment.id
                    )
                  )
                  const resultSegment = toolResult?.segments.find(s => s.type === 'tool_result' && s.id === toolCallSegment.id) as 
                    { type: 'tool_result'; id: string; output: object } | undefined
                  
                  const hasResult = resultSegment !== undefined
                  const hasError = resultSegment && resultSegment.output && typeof resultSegment.output === 'object' && 'error' in resultSegment.output
                  const resultContent = hasError 
                    ? (resultSegment.output as any).error 
                    : resultSegment ? ((resultSegment.output as any).content || JSON.stringify(resultSegment.output, null, 2)) : null
                  
                  const isExpanded = expandedToolCalls.has(toolCallSegment.id)
                  
                  const toggleExpanded = () => {
                    const newExpanded = new Set(expandedToolCalls)
                    if (isExpanded) {
                      newExpanded.delete(toolCallSegment.id)
                    } else {
                      newExpanded.add(toolCallSegment.id)
                    }
                    setExpandedToolCalls(newExpanded)
                  }
                  
                  return (
                    <div key={index} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                          Tool Call: {toolCall.name}
                        </span>
                        {!hasResult && (
                          <div className="flex space-x-1">
                            <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"></div>
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
                                  "rounded p-2 text-xs overflow-x-auto max-h-[500px] overflow-y-auto",
                                  hasError 
                                    ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                                    : "bg-background/50"
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
                  )
                })}
              </div>
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
      </div>
    )
  }

  return (
    <div className={`mb-6 group @md:pr-[42px] ${index === 0 ? "pt-4" : ""}`}>
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
              · {isStreaming ? 'typing...' : formatEventDuration(event, index)}
            </span>
          </div>
          <div className="relative">
            {isStreaming && !textContent && (
              <span className="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>
            )}
            
            {/* Regular Content First */}
            {textContent && (
              <MarkdownRenderer content={textContent} />
            )}
            
            {/* Tool Call Display (moved to end) */}
            {isToolCall && toolCalls.length > 0 && (
              <div className="mt-4 space-y-2">
                {toolCalls.map((toolCall, index) => {
                  const toolCallSegment = toolCall as { type: 'tool_call'; id: string; name: string; args: object }
                  const toolResult = allEvents?.find(event => 
                    event.segments.some(segment => 
                      segment.type === 'tool_result' && segment.id === toolCallSegment.id
                    )
                  )
                  const resultSegment = toolResult?.segments.find(s => s.type === 'tool_result' && s.id === toolCallSegment.id) as 
                    { type: 'tool_result'; id: string; output: object } | undefined
                  
                  const hasResult = resultSegment !== undefined
                  const hasError = resultSegment && resultSegment.output && typeof resultSegment.output === 'object' && 'error' in resultSegment.output
                  const resultContent = hasError 
                    ? (resultSegment.output as any).error 
                    : resultSegment ? ((resultSegment.output as any).content || JSON.stringify(resultSegment.output, null, 2)) : null
                  
                  const isExpanded = expandedToolCalls.has(toolCallSegment.id)
                  
                  const toggleExpanded = () => {
                    const newExpanded = new Set(expandedToolCalls)
                    if (isExpanded) {
                      newExpanded.delete(toolCallSegment.id)
                    } else {
                      newExpanded.add(toolCallSegment.id)
                    }
                    setExpandedToolCalls(newExpanded)
                  }
                  
                  return (
                    <div key={index} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                          Tool Call: {toolCall.name}
                        </span>
                        {!hasResult && (
                          <div className="flex space-x-1">
                            <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"></div>
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
                                  "rounded p-2 text-xs overflow-x-auto max-h-[500px] overflow-y-auto",
                                  hasError 
                                    ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                                    : "bg-background/50"
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
                  )
                })}
              </div>
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
  )
})

export default EventItem