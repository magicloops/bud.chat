'use client'

import { memo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import MarkdownRenderer from '@/components/markdown-renderer'
import { Message, Conversation } from '@/state/simpleChatStore'
import { cn } from '@/lib/utils'
import {
  Copy,
  Edit,
  Trash2,
  GitBranch,
  MoreHorizontal,
  Bot,
  AlertCircle
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface MessageItemProps {
  message: Message
  conversation?: Conversation | null
  index?: number
  isLast?: boolean
  isStreaming?: boolean
  onEdit?: (messageId: string, newContent: string) => void
  onDelete?: (messageId: string) => void
  onBranch?: (messageId: string) => void
}

export const MessageItem = memo(function MessageItem({
  message,
  conversation,
  index = 0,
  isLast,
  isStreaming = false,
  onEdit,
  onDelete,
  onBranch,
}: MessageItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const error = null // TODO: Implement error handling in new architecture

  const isOptimistic = message.json_meta?.isOptimistic || false
  const isPending = message.json_meta?.isPending || false
  const isSystem = message.role === 'system'
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  
  // Get assistant identity - all messages in a conversation should show the same identity
  // The conversation meta should already have the resolved identity (overrides or bud defaults)
  const assistantName = conversation?.meta?.assistant_name || 'Assistant'
  const assistantAvatar = conversation?.meta?.assistant_avatar || '🤖'
  

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
  }, [message.content])

  const handleEdit = useCallback(() => {
    if (onEdit) {
      setIsEditing(true)
    }
  }, [onEdit])

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(message.id)
    }
  }, [onDelete, message.id])

  const handleBranch = useCallback(() => {
    if (onBranch) {
      onBranch(message.id)
    }
  }, [onBranch, message.id])

  const formatMessageDuration = useCallback((message: Message, index: number) => {
    // For user messages, always show time since sent
    if (message.role === 'user') {
      const date = new Date(message.created_at)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffSecs = Math.floor(diffMs / 1000)
      const diffMins = Math.floor(diffSecs / 60)
      const diffHours = Math.floor(diffMins / 60)
      
      if (diffSecs < 60) return `${diffSecs}s ago`
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      return date.toLocaleDateString()
    }
    
    // For assistant messages, show duration from previous message or time since created
    const date = new Date(message.updated_at || message.created_at)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    
    if (diffSecs < 1) return '0s'
    if (diffSecs < 60) return `${diffSecs}s ago`
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return date.toLocaleDateString()
  }, [])

  const canEdit = isUser && !isPending
  const canDelete = !isPending
  const canBranch = !isPending && !isSystem

  // Don't render system messages in the old style
  if (isSystem) {
    return (
      <div className="mb-6 group">
        <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded-lg">
          <div className="text-sm text-muted-foreground font-mono">
            {message.content}
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
          ) : (
            <AvatarFallback>
              <span className="text-lg">{assistantAvatar}</span>
            </AvatarFallback>
          )}
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">
              {isUser ? 'You' : assistantName}
            </span>
            {isAssistant && message.json_meta?.model && message.json_meta.model !== 'greeting' && (
              <span className="text-xs text-muted-foreground/60">{message.json_meta.model}</span>
            )}
            <span className="text-xs text-muted-foreground">
              · {isStreaming ? 'typing...' : formatMessageDuration(message, index)}
            </span>
          </div>
          <div className="relative">
            {isStreaming && !message.content && (
              <span className="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>
            )}
            <MarkdownRenderer content={message.content} />
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
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" />
              <span>Copy</span>
            </DropdownMenuItem>
            {canBranch && (
              <DropdownMenuItem onClick={handleBranch}>
                <GitBranch className="mr-2 h-4 w-4" />
                <span>Branch</span>
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem onClick={handleEdit}>
                <Edit className="mr-2 h-4 w-4" />
                <span>Edit</span>
              </DropdownMenuItem>
            )}
            {canDelete && canEdit && <DropdownMenuSeparator />}
            {canDelete && (
              <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Re-render if message content, streaming state, conversation identity, or position changes
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.updated_at === nextProps.message.updated_at &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.index === nextProps.index &&
    prevProps.isLast === nextProps.isLast &&
    // IMPORTANT: Check conversation assistant identity for re-rendering
    prevProps.conversation?.meta?.assistant_name === nextProps.conversation?.meta?.assistant_name &&
    prevProps.conversation?.meta?.assistant_avatar === nextProps.conversation?.meta?.assistant_avatar
  )
})