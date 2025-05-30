"use client"

import { useState, useEffect, useRef, useCallback } from 'react'

interface Message {
  id: string
  clientId?: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  conversationId?: string
  isOptimistic?: boolean
  metadata?: any
  parent_id?: string
}

interface UseChatStateProps {
  conversationId?: string
  optimisticMessages?: Message[]
  workspaceId?: string
  onMessagesUpdate?: (messages: Message[]) => void
}

export function useChatState({ conversationId, optimisticMessages, workspaceId, onMessagesUpdate }: UseChatStateProps) {
  const [messages, setMessages] = useState<Message[]>([])
  
  // Track conversation ID changes to preserve state during transitions
  const prevConversationIdRef = useRef(conversationId)
  const hasInitializedRef = useRef(false)
  
  console.log('🎛️ CHAT STATE HOOK:', {
    conversationId,
    optimistic: optimisticMessages?.length,
    current: messages.length
  })
  
  // Handle conversation changes and message initialization
  useEffect(() => {
    const prevConversationId = prevConversationIdRef.current
    const isConversationIdChange = prevConversationId !== conversationId
    const isFork = conversationId?.startsWith('temp-fork-')
    const isNewChat = !conversationId && workspaceId
    const isInitialLoad = messages.length === 0 && !hasInitializedRef.current
    
    // Update refs
    prevConversationIdRef.current = conversationId
    
    console.log('🎛️ HOOK TRANSITION:', {
      prevId: prevConversationId,
      newId: conversationId,
      isIdChange: isConversationIdChange,
      isFork,
      isNewChat,
      isInitialLoad,
      hasInitialized: hasInitializedRef.current,
      optimisticLength: optimisticMessages?.length,
      currentLength: messages.length,
    })
    
    // Initialize or update messages based on context
    if (isInitialLoad && optimisticMessages && optimisticMessages.length > 0) {
      console.log('🎛️ INITIAL LOAD - USING OPTIMISTIC:', optimisticMessages.length)
      setMessages(optimisticMessages.map(msg => ({
        ...msg,
        clientId: msg.clientId || msg.id || `client-${Date.now()}-${Math.random()}`,
        conversationId: conversationId || 'new'
      })))
      hasInitializedRef.current = true
    } else if (isFork && optimisticMessages && optimisticMessages.length > 0) {
      console.log('🎛️ FORK - USING OPTIMISTIC:', optimisticMessages.length)
      setMessages(optimisticMessages.map(msg => ({
        ...msg,
        clientId: msg.clientId || msg.id || `client-${Date.now()}-${Math.random()}`,
        conversationId: conversationId || 'new'
      })))
    } else if (isConversationIdChange && optimisticMessages && optimisticMessages.length > 0) {
      // Conversation switched to a different existing conversation - load its messages
      console.log('🎛️ CONVERSATION SWITCH - USING OPTIMISTIC:', optimisticMessages.length)
      setMessages(optimisticMessages.map(msg => ({
        ...msg,
        clientId: msg.clientId || msg.id || `client-${Date.now()}-${Math.random()}`,
        conversationId: conversationId || 'new'
      })))
      // Streaming state is now managed separately
    } else if (isNewChat && isInitialLoad) {
      console.log('🎛️ NEW CHAT - SETTING GREETING')
      setMessages([{
        id: `greeting-${Date.now()}`,
        role: 'assistant',
        content: 'Hello! How can I assist you today?',
        created_at: new Date().toISOString(),
        clientId: `greeting-client-${Date.now()}`,
        conversationId: 'new',
        metadata: { isGreeting: true }
      }])
      hasInitializedRef.current = true
    } else if (isConversationIdChange && messages.length > 0) {
      console.log('🎛️ ID CHANGE - PRESERVING MESSAGES:', messages.length)
      // Only update conversation ID, preserve all other state including streaming
      setMessages(prev => prev.map(msg => ({
        ...msg,
        conversationId: conversationId || 'new'
      })))
      // Note: streaming state is now managed separately
    } else if (!conversationId && !workspaceId && messages.length > 0) {
      console.log('🎛️ CLEARING - no conversation or workspace')
      setMessages([])
      hasInitializedRef.current = false
    } else if (optimisticMessages && optimisticMessages.length > 0 && optimisticMessages.length > messages.length) {
      // SWR loaded new data for current conversation - use it
      console.log('🎛️ SWR UPDATE - USING OPTIMISTIC:', optimisticMessages.length, 'vs current:', messages.length)
      setMessages(optimisticMessages.map(msg => ({
        ...msg,
        clientId: msg.clientId || msg.id || `client-${Date.now()}-${Math.random()}`,
        conversationId: conversationId || 'new'
      })))
    } else {
      console.log('🎛️ KEEPING EXISTING STATE')
    }
  }, [conversationId, optimisticMessages, workspaceId])
  
  // Sync messages back to parent when they change
  useEffect(() => {
    if (onMessagesUpdate) {
      onMessagesUpdate(messages)
    }
  }, [messages, onMessagesUpdate])
  
  // Debug: Check if optimisticMessages reference is changing constantly
  const prevOptimisticRef = useRef(optimisticMessages)
  useEffect(() => {
    if (prevOptimisticRef.current !== optimisticMessages) {
      console.log('🎛️ OPTIMISTIC MESSAGES CHANGED:', {
        prevLength: prevOptimisticRef.current?.length,
        newLength: optimisticMessages?.length,
        sameContent: JSON.stringify(prevOptimisticRef.current) === JSON.stringify(optimisticMessages)
      })
      prevOptimisticRef.current = optimisticMessages
    }
  }, [optimisticMessages])
  
  // Add a new message to the local state
  const addMessage = useCallback((message: Message) => {
    console.log('🎛️ ADDING MESSAGE:', message.role, message.content.substring(0, 50))
    console.log('🎛️ Message details:', {
      id: message.id,
      role: message.role,
      isOptimistic: message.isOptimistic,
      clientId: message.clientId
    })
    setMessages(prev => {
      const newMessage = {
        ...message,
        clientId: message.clientId || message.id || `client-${Date.now()}-${Math.random()}`,
        conversationId: conversationId || 'new'
      }
      console.log('🎛️ Added message final form:', {
        id: newMessage.id,
        role: newMessage.role,
        isOptimistic: newMessage.isOptimistic,
        clientId: newMessage.clientId
      })
      return [...prev, newMessage]
    })
  }, [conversationId])
  
  // Update an existing message (e.g., optimistic ID -> real ID)
  const updateMessage = useCallback((messageId: string, updates: Partial<Message>) => {
    console.log('🎛️ UPDATING MESSAGE:', messageId, Object.keys(updates))
    setMessages(prev => prev.map(msg => 
      msg.id === messageId || msg.clientId === messageId 
        ? { ...msg, ...updates }
        : msg
    ))
  }, [])
  
  // Add final streaming message to messages (called from external streaming hook)
  const addStreamingResult = useCallback((finalMessage: Message) => {
    console.log('🎛️ Adding final streaming message:', finalMessage.content.substring(0, 50))
    console.log('🎛️ Final message properties:', {
      id: finalMessage.id,
      isOptimistic: finalMessage.isOptimistic,
      hasRealId: !finalMessage.id.startsWith('temp-') && !finalMessage.id.startsWith('assistant-')
    })
    setMessages(prev => {
      console.log('🎛️ Messages before adding final:', prev.length)
      const updated = [...prev, {
        ...finalMessage,
        conversationId: conversationId || 'new',
        isOptimistic: false
      }]
      console.log('🎛️ Messages after adding final:', updated.length)
      console.log('🎛️ Added message final state:', {
        id: updated[updated.length - 1].id,
        isOptimistic: updated[updated.length - 1].isOptimistic
      })
      return updated
    })
  }, [conversationId])
  
  return {
    messages,
    addMessage,
    updateMessage,
    addStreamingResult,
    setMessages, // For advanced use cases
  }
}