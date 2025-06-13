import { Message } from '@/state/simpleChatStore'

export function createGreetingMessage(): Message {
  const now = new Date().toISOString()
  return {
    id: 'greeting-message',
    conversation_id: 'local', // Will be updated when conversation is created
    role: 'assistant',
    content: 'How can I help you today?',
    created_at: now,
    updated_at: now,
    order_key: 'greeting',
    json_meta: { isGreeting: true }
  }
}

export function createUserMessage(content: string, conversationId: string = 'local'): Message {
  const now = new Date().toISOString()
  const timestamp = Date.now()
  
  return {
    id: `user-${timestamp}`,
    conversation_id: conversationId,
    role: 'user',
    content,
    created_at: now,
    updated_at: now,
    order_key: `user-${timestamp}`,
    json_meta: {}
  }
}

export function createAssistantPlaceholder(conversationId: string = 'local'): Message {
  const now = new Date().toISOString()
  const timestamp = Date.now()
  
  return {
    id: `assistant-${timestamp}`,
    conversation_id: conversationId,
    role: 'assistant',
    content: '',
    created_at: now,
    updated_at: now,
    order_key: `assistant-${timestamp}`,
    json_meta: { isStreaming: true }
  }
}

export function createSystemMessages(budConfig?: any): Message[] {
  // TODO: Implement based on bud configuration
  // For now, return empty array
  return []
}

// Helper to update conversation_id for all messages when transitioning from local to real
export function updateMessagesConversationId(messages: Message[], newConversationId: string): Message[] {
  return messages.map(message => ({
    ...message,
    conversation_id: newConversationId
  }))
}