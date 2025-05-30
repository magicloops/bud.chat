"use client"

import React, { createContext, useContext, ReactNode } from 'react'
import { useStreamingState } from '@/hooks/use-streaming-state'

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

interface StreamingContextType {
  streamingMessage: StreamingMessage | null
  isStreaming: boolean
  startStreaming: (message: StreamingMessage) => void
  updateStreamingMessage: (content: string) => void
  completeStreaming: (onComplete?: (finalMessage: StreamingMessage) => void) => void
  cancelStreaming: () => void
}

const StreamingContext = createContext<StreamingContextType | undefined>(undefined)

export function StreamingProvider({ children }: { children: ReactNode }) {
  const streamingState = useStreamingState()
  
  return (
    <StreamingContext.Provider value={streamingState}>
      {children}
    </StreamingContext.Provider>
  )
}

export function useStreamingContext() {
  const context = useContext(StreamingContext)
  if (context === undefined) {
    throw new Error('useStreamingContext must be used within a StreamingProvider')
  }
  return context
}