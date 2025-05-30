"use client"

import { useState, useCallback, useRef, useMemo } from 'react'

interface StreamingMessage {
  id: string
  clientId?: string
  role: 'assistant'
  content: string
  created_at: string
  conversationId?: string
  isOptimistic?: boolean
  metadata?: any
}

export function useStreamingState() {
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  
  // Use ref to get current streaming message without dependency issues
  const streamingMessageRef = useRef(streamingMessage)
  streamingMessageRef.current = streamingMessage
  
  const startStreaming = useCallback((message: StreamingMessage) => {
    console.log('🎬 START STREAMING (isolated):', message.id)
    setStreamingMessage(message)
    setIsStreaming(true)
  }, [])
  
  // Throttled update to reduce re-renders
  const updateStreamingMessage = useCallback((content: string) => {
    console.log('📝 UPDATE STREAMING (isolated):', content.length, 'chars')
    setStreamingMessage(prev => prev ? { ...prev, content } : null)
  }, [])
  
  // Throttled version for high-frequency updates (every 50ms max)
  /*
  const throttledUpdate = useRef<NodeJS.Timeout>()
  const throttledUpdateStreamingMessage = useCallback((content: string) => {
    if (throttledUpdate.current) {
      clearTimeout(throttledUpdate.current)
    }
    
    throttledUpdate.current = setTimeout(() => {
      updateStreamingMessage(content)
    }, 16) // ~60fps
  }, [updateStreamingMessage])
  */
  
  const completeStreaming = useCallback((onComplete?: (finalMessage: StreamingMessage) => void) => {
    const currentStreamingMessage = streamingMessageRef.current
    console.log('✅ COMPLETE STREAMING (isolated):', !!currentStreamingMessage)
    
    if (currentStreamingMessage && onComplete) {
      onComplete(currentStreamingMessage)
    }
    
    setStreamingMessage(null)
    setIsStreaming(false)
  }, [])
  
  const cancelStreaming = useCallback(() => {
    console.log('❌ CANCEL STREAMING (isolated)')
    setStreamingMessage(null)
    setIsStreaming(false)
  }, [])
  
  return {
    streamingMessage,
    isStreaming,
    startStreaming,
    updateStreamingMessage,
    completeStreaming,
    cancelStreaming
  }
}
