import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface StreamMessage {
  type: 'token' | 'complete' | 'error'
  content?: string
  messageId?: string
  error?: string
}

interface UseChatStreamProps {
  onToken?: (content: string, messageId: string) => void
  onComplete?: (content: string, messageId: string) => void
  onError?: (error: string) => void
}

export function useChatStream({ onToken, onComplete, onError }: UseChatStreamProps = {}) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)

  const sendMessage = useCallback(async (
    conversationId: string,
    message: string,
    workspaceId: string,
    parentPath?: string
  ) => {
    setIsStreaming(true)
    setStreamingMessageId(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversationId,
          message,
          workspaceId,
          parentPath
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data: StreamMessage = JSON.parse(line.slice(6))
              
              if (data.type === 'token' && data.content && data.messageId) {
                setStreamingMessageId(data.messageId)
                onToken?.(data.content, data.messageId)
              } else if (data.type === 'complete' && data.content && data.messageId) {
                onComplete?.(data.content, data.messageId)
                setStreamingMessageId(null)
              } else if (data.type === 'error') {
                onError?.(data.error || 'Unknown error')
                setStreamingMessageId(null)
              }
            } catch (err) {
              console.error('Error parsing SSE data:', err)
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat stream error:', error)
      onError?.(error instanceof Error ? error.message : 'Unknown error')
      setStreamingMessageId(null)
    } finally {
      setIsStreaming(false)
      setStreamingMessageId(null)
    }
  }, [onToken, onComplete, onError])

  return {
    sendMessage,
    isStreaming,
    streamingMessageId
  }
}