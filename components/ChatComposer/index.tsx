'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send, Square } from 'lucide-react'
import { 
  useConversation,
  useAddMessage,
  useStartStreaming,
  useAppendToStreamingMessage,
  useFinishStreaming,
  useSelectedWorkspace,
  Message
} from '@/state/simpleChatStore'
import { createUserMessage, createAssistantPlaceholder } from '@/lib/messageHelpers'

interface ChatComposerProps {
  conversationId: string
  className?: string
  placeholder?: string
  onMessageSent?: (messageId: string) => void
}

export function ChatComposer({ 
  conversationId, 
  className, 
  placeholder = "Type your message...",
  onMessageSent
}: ChatComposerProps) {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const conversation = useConversation(conversationId)
  const selectedWorkspace = useSelectedWorkspace()
  const addMessage = useAddMessage()
  const startStreaming = useStartStreaming()
  const appendToStreamingMessage = useAppendToStreamingMessage()
  const finishStreaming = useFinishStreaming()
  
  const isStreaming = conversation?.isStreaming || false

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    
    if (!input.trim() || isSubmitting || isStreaming || !selectedWorkspace) return

    const messageContent = input.trim()
    setInput('')
    setIsSubmitting(true)

    try {
      
      // 1. Add optimistic messages
      const userMessage = createUserMessage(messageContent, conversationId)
      const assistantMessage = createAssistantPlaceholder(conversationId)
      
      addMessage(conversationId, userMessage)
      addMessage(conversationId, assistantMessage)
      
      // 2. Start streaming state
      startStreaming(conversationId, assistantMessage.id)
      
      // 3. Send to server
      const response = await fetch(`/api/chat/${conversationId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: messageContent,
          workspaceId: selectedWorkspace,
          model: 'gpt-4o'
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // 4. Handle streaming response with performance tracking
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let tokenCount = 0
      let streamStartTime = performance.now()
      let lastTokenTime = performance.now()

      while (true) {
        const chunkStartTime = performance.now()
        const { done, value } = await reader.read()
        if (done) break

        const parseStartTime = performance.now()
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonParseStart = performance.now()
              const data = JSON.parse(line.slice(6))
              const jsonParseTime = performance.now() - jsonParseStart
              
              if (jsonParseTime > 2) {
                console.log('🐌 PERF: Slow JSON parse:', jsonParseTime.toFixed(2), 'ms')
              }
              
              switch (data.type) {
                case 'token':
                  // Performance: Track token timing
                  tokenCount++
                  const currentTime = performance.now()
                  const timeSinceStart = currentTime - streamStartTime
                  const timeSinceLastToken = currentTime - lastTokenTime
                  lastTokenTime = currentTime
                  
                  if (tokenCount === 1) {
                    console.log('⚡ PERF: Time to first token:', timeSinceStart.toFixed(2), 'ms')
                  }
                  
                  if (tokenCount % 10 === 0) {
                    console.log(`⚡ PERF: Token ${tokenCount} - Inter-token delay:`, timeSinceLastToken.toFixed(2), 'ms')
                  }
                  
                  // Performance: Time React state update
                  const reactUpdateStart = performance.now()
                  appendToStreamingMessage(conversationId, data.content)
                  const reactUpdateTime = performance.now() - reactUpdateStart
                  
                  if (reactUpdateTime > 5) {
                    console.log('🐌 PERF: Slow React update:', reactUpdateTime.toFixed(2), 'ms')
                  }
                  break
                  
                case 'complete':
                  finishStreaming(conversationId, data.content)
                  onMessageSent?.(assistantMessage.id)
                  break
                  
                case 'error':
                  console.error('Streaming error:', data.error)
                  finishStreaming(conversationId, 'Sorry, there was an error processing your message.')
                  break
              }
            } catch (e) {
              console.error('Error parsing stream data:', e)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      finishStreaming(conversationId, 'Sorry, there was an error sending your message.')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    input, 
    isSubmitting, 
    isStreaming, 
    selectedWorkspace, 
    conversationId,
    addMessage,
    startStreaming,
    appendToStreamingMessage,
    finishStreaming,
    onMessageSent
  ])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleStop = useCallback(() => {
    // TODO: Implement stream stopping
  }, [])

  return (
    <div className={`border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${className}`}>
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isSubmitting || isStreaming}
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
          />
          {isStreaming ? (
            <Button
              type="button"
              onClick={handleStop}
              size="sm"
              variant="outline"
              className="h-11 px-3"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim() || isSubmitting}
              size="sm"
              className="h-11 px-3"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}