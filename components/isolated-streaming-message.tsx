"use client"

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bot } from "lucide-react"
import MarkdownRenderer from "./markdown-renderer"
import { useStreamingState } from "@/hooks/use-streaming-state"

export default function IsolatedStreamingMessage({ 
  assistantName,
  targetContainerId 
}: { 
  assistantName: string
  targetContainerId: string
}) {
  const { streamingMessage, isStreaming } = useStreamingState()
  const portalContainer = useRef<HTMLDivElement | null>(null)
  
  useEffect(() => {
    // Create or find the portal container
    let container = document.getElementById(targetContainerId) as HTMLDivElement
    if (!container) {
      container = document.createElement('div')
      container.id = targetContainerId
      container.className = 'streaming-message-portal'
      document.body.appendChild(container)
    }
    portalContainer.current = container
    
    return () => {
      // Clean up the container when component unmounts
      if (container && !streamingMessage) {
        container.remove()
      }
    }
  }, [targetContainerId, streamingMessage])
  
  if (!streamingMessage || !portalContainer.current) {
    return null
  }
  
  const streamingContent = (
    <div className="mb-6 group">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback>
            <Bot className="h-5 w-5 text-green-500" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{assistantName}</span>
            {streamingMessage.metadata?.model && streamingMessage.metadata.model !== 'greeting' && (
              <span className="text-xs text-muted-foreground/60">{streamingMessage.metadata.model}</span>
            )}
            <span className="text-xs text-muted-foreground">
              · {isStreaming ? 'typing...' : 'just now'}
            </span>
          </div>
          <div className="relative">
            <MarkdownRenderer content={streamingMessage.content} />
            {isStreaming && (
              <span className="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>
            )}
          </div>
        </div>
        {/* Placeholder for dropdown menu to prevent layout shift */}
        <div className="h-6 w-6 opacity-0">
          {/* Hidden placeholder that matches dropdown button dimensions */}
        </div>
      </div>
    </div>
  )
  
  return createPortal(streamingContent, portalContainer.current)
}