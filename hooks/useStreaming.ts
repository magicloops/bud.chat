import { useEffect, useRef, useCallback } from 'react'
import { useStartStreaming, useAppendStreamDelta, useFinishStreaming, useAddError, useUpdateMessage, useAddMessage } from '@/state/chatStore'
import { ConversationId, MessageId, StreamEvent } from '@/lib/types'

interface UseStreamingOptions {
  chatId: ConversationId
  onComplete?: (messageId: MessageId, content: string) => void
  onError?: (error: string) => void
}

export function useStreaming({ chatId, onComplete, onError }: UseStreamingOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const startStreaming = useStartStreaming()
  const appendStreamDelta = useAppendStreamDelta()
  const finishStreaming = useFinishStreaming()
  const addError = useAddError()
  const updateMessage = useUpdateMessage()
  const addMessage = useAddMessage()
  
  const connect = useCallback((streamChatId: ConversationId, content: string, model = 'gpt-4o') => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    
    // Add optimistic user and assistant messages immediately for better UX
    const timestamp = Date.now()
    const tempUserMessageId = `temp-user-${timestamp}`
    const tempAssistantMessageId = `temp-assistant-${timestamp}`
    const now = new Date().toISOString()
    
    // Use sequential order keys to ensure proper ordering (user first, then assistant)
    // Use 'z' prefix to ensure these come after existing fractional keys (a0, a1, aa, etc.)
    const userOrderKey = `ztemp-${timestamp}-1`
    const assistantOrderKey = `ztemp-${timestamp}-2`
    
    const optimisticUserMessage = {
      id: tempUserMessageId,
      conversation_id: streamChatId,
      order_key: userOrderKey,
      role: 'user',
      content,
      json_meta: {},
      version: 1,
      created_at: now,
      updated_at: now,
      isOptimistic: true,
    } as any
    
    const optimisticAssistantMessage = {
      id: tempAssistantMessageId,
      conversation_id: streamChatId,
      order_key: assistantOrderKey,
      role: 'assistant',
      content: '',
      json_meta: { model, isPending: true },
      version: 1,
      created_at: now,
      updated_at: now,
      isOptimistic: true,
    } as any
    
    console.log('Adding optimistic messages:', {
      userMessage: { id: optimisticUserMessage.id, content: optimisticUserMessage.content, orderKey: optimisticUserMessage.order_key },
      assistantMessage: { id: optimisticAssistantMessage.id, content: optimisticAssistantMessage.content, orderKey: optimisticAssistantMessage.order_key }
    })
    
    addMessage(streamChatId, optimisticUserMessage)
    addMessage(streamChatId, optimisticAssistantMessage)
    
    // Start streaming state immediately for better UX
    startStreaming(streamChatId, tempAssistantMessageId)
    
    // Store the temp IDs for replacement later
    const tempMessageRef = { tempUserMessageId, tempAssistantMessageId }
    
    // Create new streaming connection with POST
    fetch(`/api/stream/${streamChatId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, model }),
    }).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }
      
      const decoder = new TextDecoder()
      
      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))
                  handleStreamEvent(data, streamChatId, tempMessageRef)
                } catch (e) {
                  console.error('Error parsing stream data:', e)
                }
              }
            }
          }
        } catch (error) {
          console.error('Stream reading error:', error)
          addError('stream-error', 'Connection error')
          onError?.('Connection error')
        }
      }
      
      readStream()
    }).catch(error => {
      console.error('Fetch error:', error)
      addError('stream-error', 'Failed to start streaming')
      onError?.('Failed to start streaming')
    })
  }, [addError, onError])
  
  const handleStreamEvent = useCallback((data: any, streamChatId: ConversationId, tempMessageRef?: { tempUserMessageId: string, tempAssistantMessageId: string }) => {
    switch (data.type) {
      case 'messagesCreated':
        // Both messages created successfully
        console.log('Messages created:', data)
        
        // Replace optimistic messages with real server data
        if (data.userMessage && data.assistantMessage) {
          // Replace the optimistic user message with the real one
          if (tempMessageRef?.tempUserMessageId) {
            updateMessage(streamChatId, tempMessageRef.tempUserMessageId, {
              id: data.userMessage.id,
              order_key: data.userMessage.order_key,
              isOptimistic: false,
              created_at: data.userMessage.created_at,
              updated_at: data.userMessage.updated_at,
            })
          }
          
          // Replace the optimistic assistant message with the real one
          if (tempMessageRef?.tempAssistantMessageId) {
            updateMessage(streamChatId, tempMessageRef.tempAssistantMessageId, {
              id: data.assistantMessage.id,
              order_key: data.assistantMessage.order_key,
              isOptimistic: false,
              json_meta: data.assistantMessage.json_meta,
              created_at: data.assistantMessage.created_at,
              updated_at: data.assistantMessage.updated_at,
            })
            
            // Update streaming to use the real assistant message ID
            startStreaming(streamChatId, data.assistantMessage.id)
          }
        }
        break
        
      case 'token':
        // Append token to streaming message
        if (data.content && data.messageId) {
          console.log('Appending token:', { messageId: data.messageId, content: data.content.substring(0, 20) })
          appendStreamDelta(streamChatId, {
            id: data.messageId,
            content: data.content,
          })
        }
        break
        
      case 'complete':
        // Streaming complete
        if (data.messageId && data.content !== undefined) {
          console.log('Finishing streaming:', { messageId: data.messageId, contentLength: data.content.length })
          finishStreaming(streamChatId, data.messageId, data.content)
          onComplete?.(data.messageId, data.content)
        }
        break
        
      case 'error':
        // Streaming error
        const errorMsg = data.error || 'Unknown streaming error'
        addError('stream-error', errorMsg)
        onError?.(errorMsg)
        break
    }
  }, [startStreaming, appendStreamDelta, finishStreaming, addError, addMessage, onComplete, onError])
  
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])
  
  return {
    connect,
    disconnect,
    isConnected: !!eventSourceRef.current,
  }
}

// Hook for manually managing streaming connections
export function useStreamingManager() {
  const activeStreams = useRef<Map<string, EventSource>>(new Map())
  const startStreaming = useStartStreaming()
  const appendStreamDelta = useAppendStreamDelta()
  const finishStreaming = useFinishStreaming()
  const addError = useAddError()
  
  const startStream = useCallback((chatId: ConversationId, messageId: MessageId) => {
    const streamKey = `${chatId}-${messageId}`
    
    // Close existing stream for this chat/message
    const existing = activeStreams.current.get(streamKey)
    if (existing) {
      existing.close()
    }
    
    // Create new stream
    const eventSource = new EventSource(`/api/stream/${chatId}`)
    activeStreams.current.set(streamKey, eventSource)
    
    startStreaming(chatId, messageId)
    
    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data)
        
        switch (data.type) {
          case 'token':
            if (data.content && data.messageId) {
              appendStreamDelta(chatId, {
                id: data.messageId,
                content: data.content,
              })
            }
            break
            
          case 'complete':
            if (data.messageId && data.content !== undefined) {
              finishStreaming(chatId, data.messageId, data.content)
            }
            eventSource.close()
            activeStreams.current.delete(streamKey)
            break
            
          case 'error':
            const errorMsg = data.error || 'Unknown streaming error'
            addError(messageId, errorMsg)
            eventSource.close()
            activeStreams.current.delete(streamKey)
            break
        }
      } catch (error) {
        console.error('Error parsing stream data:', error)
        addError(messageId, 'Failed to parse stream data')
      }
    }
    
    eventSource.onerror = () => {
      addError(messageId, 'Connection error')
      eventSource.close()
      activeStreams.current.delete(streamKey)
    }
    
    return eventSource
  }, [startStreaming, appendStreamDelta, finishStreaming, addError])
  
  const stopStream = useCallback((chatId: ConversationId, messageId: MessageId) => {
    const streamKey = `${chatId}-${messageId}`
    const stream = activeStreams.current.get(streamKey)
    
    if (stream) {
      stream.close()
      activeStreams.current.delete(streamKey)
    }
  }, [])
  
  const stopAllStreams = useCallback(() => {
    activeStreams.current.forEach((stream) => {
      stream.close()
    })
    activeStreams.current.clear()
  }, [])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllStreams()
    }
  }, [stopAllStreams])
  
  return {
    startStream,
    stopStream,
    stopAllStreams,
    activeStreamCount: activeStreams.current.size,
  }
}

export default useStreaming