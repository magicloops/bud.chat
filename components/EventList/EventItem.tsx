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
  Wrench
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
}: EventItemProps) {
  const [isEditing, setIsEditing] = useState(false)
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

  return (
    <div className={`mb-6 group ${index === 0 ? "pt-4" : ""}`}>
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
            
            {/* Tool Call Display */}
            {isToolCall && toolCalls.length > 0 && (
              <div className="mb-2 space-y-2">
                {toolCalls.map((toolCall, index) => (
                  <div key={index} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        Tool Call: {toolCall.name}
                      </span>
                      {isStreaming && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">executing...</span>
                      )}
                    </div>
                    <pre className="text-xs text-muted-foreground bg-background/50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(toolCall.args, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
            
            {/* Tool Result Display */}
            {isToolResult && toolResults.length > 0 && (
              <div className="mb-2 space-y-2">
                {toolResults.map((toolResult, index) => (
                  <div key={index} className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-3 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-4 w-4 text-green-600 dark:text-green-400">✓</div>
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">
                        Tool Result
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground bg-background/50 p-2 rounded">
                      <pre className="whitespace-pre-wrap overflow-x-auto">
                        {typeof toolResult.output === 'string' ? toolResult.output : JSON.stringify(toolResult.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Regular Content */}
            {!isToolCall && !isToolResult && textContent && (
              <MarkdownRenderer content={textContent} />
            )}
            
            {/* Regular Content for Tool Call Events with additional content */}
            {isToolCall && textContent && (
              <div className="mt-2">
                <MarkdownRenderer content={textContent} />
              </div>
            )}
            
          </div>
          
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
  )
})

export default EventItem