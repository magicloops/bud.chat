'use client'

import { memo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import MarkdownRenderer from '@/components/markdown-renderer'
import { UnifiedMessage } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  Copy,
  Edit,
  Trash2,
  GitBranch,
  MoreHorizontal,
  User,
  Bot,
  Settings,
  CheckCircle,
  AlertCircle,
  Loader2
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChatError } from '@/state/chatStore'

interface MessageItemProps {
  message: UnifiedMessage
  isLast?: boolean
  onEdit?: (messageId: string, newContent: string) => void
  onDelete?: (messageId: string) => void
  onBranch?: (messageId: string) => void
}

export const MessageItem = memo(function MessageItem({
  message,
  isLast,
  onEdit,
  onDelete,
  onBranch,
}: MessageItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const error = useChatError(message.id)

  const isOptimistic = 'isOptimistic' in message && message.isOptimistic
  const isPending = 'isPending' in message && message.isPending
  const isSystem = message.role === 'system'
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

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

  const getStatusIcon = () => {
    if (error) {
      return <AlertCircle className="h-3 w-3 text-destructive" />
    }
    if (isPending) {
      return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
    }
    if (isOptimistic) {
      return <div className="h-3 w-3 rounded-full bg-yellow-500 animate-pulse" />
    }
    return <CheckCircle className="h-3 w-3 text-green-500" />
  }

  const getRoleIcon = () => {
    switch (message.role) {
      case 'user':
        return <User className="h-4 w-4" />
      case 'assistant':
        return <Bot className="h-4 w-4" />
      case 'system':
        return <Settings className="h-4 w-4" />
      default:
        return null
    }
  }

  const getRoleLabel = () => {
    switch (message.role) {
      case 'user':
        return 'You'
      case 'assistant':
        return 'Assistant'
      case 'system':
        return 'System'
      default:
        return message.role
    }
  }

  const canEdit = isUser && !isPending
  const canDelete = !isPending
  const canBranch = !isPending && !isSystem

  console.log("message rendered: " + message.id)

  return (
    <div className={cn(
      "group relative flex gap-3 p-4 rounded-lg transition-colors",
      isUser && "bg-primary/5 ml-8",
      isAssistant && "bg-muted/50 mr-8",
      isSystem && "bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800",
      error && "bg-destructive/5 border border-destructive/20"
    )}>
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full",
        isUser && "bg-primary text-primary-foreground",
        isAssistant && "bg-muted text-muted-foreground",
        isSystem && "bg-yellow-500 text-white"
      )}>
        {getRoleIcon()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {getRoleLabel()}
            </span>
            {getStatusIcon()}
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 w-6 p-0"
            >
              <Copy className="h-3 w-3" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onClick={handleEdit}>
                    <Edit className="h-3 w-3 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canBranch && (
                  <DropdownMenuItem onClick={handleBranch}>
                    <GitBranch className="h-3 w-3 mr-2" />
                    Branch from here
                  </DropdownMenuItem>
                )}
                {(canEdit || canBranch) && canDelete && <DropdownMenuSeparator />}
                {canDelete && (
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                    <Trash2 className="h-3 w-3 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Message Content */}
        <div className="prose prose-sm max-w-none dark:prose-invert">
          {isSystem ? (
            <div className="text-sm text-muted-foreground font-mono">
              {message.content}
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
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

        {/* Metadata */}
        {/*
        {(isOptimistic || isPending) && (
          <div className="mt-2 text-xs text-muted-foreground">
            {isPending && "Generating response..."}
            {isOptimistic && !isPending && "Sending..."}
          </div>
        )}
        */}
      </div>
    </div>
  )
})
