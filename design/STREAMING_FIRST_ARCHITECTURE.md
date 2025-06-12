# Streaming-First Chat Architecture

## Design Goals

### Primary Constraints
1. **Minimize Time to First Token** - Start LLM streaming BEFORE any database operations
2. **Optimistic UI** - Instant user feedback, never block on server operations
3. **Performance** - Minimal re-renders, efficient state updates
4. **Reliability** - Handle network failures gracefully, ensure data consistency
5. **Simplicity** - Clear separation of concerns, easy to debug and maintain

### Core Principle: Stream First, Persist Later

```
User sends message → LLM starts streaming → DB operations happen in parallel
                  ↳ Immediate UI feedback    ↳ No blocking, async persistence
```

## Architecture Overview

### Route Structure
```
/new                    → NewChatPage (local state only)
/chat/[conversationId]  → ChatPage (server-synced state)
```

### Data Flow

#### 1. New Conversation Flow (`/new` route)
```typescript
// Local state only - no server dependencies
const localMessages = [
  greetingMessage,     // From bud configuration
  ...systemMessages,   // From bud prompts
  userMessage,         // Added optimistically
  placeholderAssistant // Streaming target
]

// On user message send:
1. Add user message to local state (instant UI)
2. POST to /api/chat with ALL local messages
3. Server immediately starts LLM streaming (time to first token < 100ms)
4. Server persists conversation/messages in background
5. When conversation ID available, pre-populate Zustand store
6. Navigate to /chat/[id] - zero flash, data already in store
```

#### 2. Existing Conversation Flow (`/chat/[id]` route)
```typescript
// Server-synced state
const conversation = useConversation(conversationId)

// On user message send:
1. Add optimistic message to store
2. POST to /api/chat/[id] 
3. Server starts streaming immediately
4. Server persists message updates in background
```

## Implementation Details

### 1. Local State Management (Zustand)

```typescript
interface ChatStore {
  // Real conversations (server-synced)
  conversations: Record<ConversationId, {
    id: string
    messages: Message[]
    isStreaming: boolean
    streamingMessageId?: string
    meta: ConversationMeta
  }>
  
  // Actions
  setConversation: (id: string, data: Conversation) => void
  addOptimisticMessage: (conversationId: string, message: Message) => void
  startStreaming: (conversationId: string, messageId: string) => void
  appendStream: (conversationId: string, messageId: string, content: string) => void
  finishStreaming: (conversationId: string, messageId: string, finalContent: string) => void
}

// No registry pattern, no temp IDs, no complex mappings
```

### 2. API Endpoints

#### POST /api/chat (New Conversations)
```typescript
// Request: All local messages + context
{
  messages: [greeting, system, user],
  workspaceId: string,
  budId?: string,
  model: string
}

// Response: Immediate streaming
// Side effect: Async DB operations
async function POST(request) {
  const { messages, workspaceId, budId, model } = await request.json()
  
  // Start LLM streaming immediately - NO database operations first
  const stream = await openai.chat.completions.create({
    model,
    messages,
    stream: true
  })
  
  // Stream to client immediately
  const responseStream = new ReadableStream({
    start(controller) {
      // Background: Create conversation in DB (don't await)
      createConversationInBackground(messages, workspaceId, budId)
        .then(conversationId => {
          // Send conversation ID when available
          controller.enqueue(`data: ${JSON.stringify({
            type: 'conversationCreated',
            conversationId
          })}\\n\\n`)
        })
      
      // Foreground: Stream LLM response
      streamLLMResponse(stream, controller)
    }
  })
  
  return new Response(responseStream, { headers: streamHeaders })
}
```

#### POST /api/chat/[id] (Existing Conversations)
```typescript
// Similar pattern but with existing conversation ID
// Still prioritizes streaming over persistence
```

### 3. React Components

#### NewChatPage Component
```typescript
const NewChatPage = () => {
  // Local state - no Zustand needed
  const [messages, setMessages] = useState(() => [
    createGreetingMessage(budConfig),
    ...createSystemMessages(budConfig)
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const router = useRouter()
  
  const handleSendMessage = async (content: string) => {
    // 1. Optimistic UI updates
    const userMessage = createUserMessage(content)
    const assistantPlaceholder = createAssistantPlaceholder()
    setMessages(prev => [...prev, userMessage, assistantPlaceholder])
    setIsStreaming(true)
    
    // 2. Start streaming immediately
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [...messages, userMessage],
        workspaceId,
        budId,
        model
      })
    })
    
    // 3. Handle stream
    const reader = response.body.getReader()
    let conversationId: string | null = null
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      const events = parseSSEChunk(value)
      for (const event of events) {
        if (event.type === 'conversationCreated') {
          conversationId = event.conversationId
          // Don't navigate yet - let streaming finish
        } else if (event.type === 'token') {
          // Update local streaming message
          setMessages(prev => updateStreamingMessage(prev, event.content))
        } else if (event.type === 'complete') {
          setIsStreaming(false)
          
          // CRITICAL: Seamless transition
          if (conversationId) {
            // 4. Pre-populate store with current local state
            setConversation(conversationId, {
              id: conversationId,
              messages: messages, // Current local messages
              isStreaming: false,
              meta: { title: 'New Chat', workspace_id: workspaceId }
            })
            
            // 5. Navigate - ChatPage finds data already in store (zero flash)
            router.push(`/chat/${conversationId}`)
          }
        }
      }
    }
  }
  
  return (
    <ChatInterface 
      messages={messages}
      onSendMessage={handleSendMessage}
      isStreaming={isStreaming}
    />
  )
}
```

#### ChatPage Component
```typescript
const ChatPage = ({ conversationId }: { conversationId: string }) => {
  const conversation = useConversation(conversationId)
  const { sendMessage, isStreaming } = useStreamingChat(conversationId)
  
  // Simple - just use Zustand store data
  return (
    <ChatInterface 
      messages={conversation?.messages || []}
      onSendMessage={sendMessage}
      isStreaming={isStreaming}
    />
  )
}
```

### 4. Background Database Operations

```typescript
// Non-blocking conversation creation
async function createConversationInBackground(
  messages: Message[],
  workspaceId: string,
  budId?: string
): Promise<string> {
  try {
    // Create conversation
    const conversation = await db.conversations.create({
      workspace_id: workspaceId,
      bud_id: budId,
      created_at: new Date()
    })
    
    // Create messages with proper ordering
    await db.messages.createMany({
      data: messages.map((msg, index) => ({
        conversation_id: conversation.id,
        order_key: generateOrderKey(index),
        role: msg.role,
        content: msg.content,
        json_meta: msg.meta || {}
      }))
    })
    
    return conversation.id
  } catch (error) {
    console.error('Background conversation creation failed:', error)
    // Handle gracefully - maybe retry, or store locally
    throw error
  }
}
```

## Seamless Route Transition

### The Critical UX Challenge
The transition from `/new` → `/chat/[id]` must be imperceptible to users. Any flash, reload, or delay breaks the conversational flow.

### Solution: Pre-populate Store Before Navigation
```typescript
// When conversation ID becomes available:
if (conversationId) {
  // 1. Transfer local state to Zustand store
  setConversation(conversationId, {
    id: conversationId,
    messages: currentLocalMessages, // Exact same messages user was seeing
    isStreaming: false,
    meta: { title: 'New Chat', workspace_id: workspaceId }
  })
  
  // 2. Navigate to real route
  router.push(`/chat/${conversationId}`)
  
  // 3. ChatPage component loads instantly with data already in store
  // Zero loading state, zero flash, perfect continuity
}
```

### Why This Works
- **No data fetching** - ChatPage finds conversation already in store
- **Identical UI** - Same messages, same state, same appearance
- **Instant interactivity** - User can immediately send next message
- **Clean architecture** - Each route maintains its clear responsibility

### Alternative Approaches Considered
1. **Keep same component, update URL** - Would break route-based architecture
2. **Fetch data on route change** - Would cause loading flash
3. **Share state between routes** - Would create complex coupling

The pre-populate approach gives us the best of all worlds: clean separation with seamless UX.

## Benefits of This Architecture

### Performance
- **Sub-100ms time to first token** - No database blocking
- **Minimal re-renders** - Simple state updates
- **Efficient navigation** - Clean route transitions

### Reliability
- **Graceful degradation** - Local state survives network issues
- **Consistent UX** - Optimistic updates always work
- **Error boundaries** - Background failures don't break UI

### Maintainability
- **Clear separation** - Local vs server state
- **Simple debugging** - Linear data flow
- **Easy testing** - Components are pure
- **Future-proof** - Easy to add features

### Developer Experience
- **Predictable behavior** - No complex state machines
- **Standard React patterns** - No anti-patterns or hacks
- **Clear error messages** - Easy to trace issues
- **Hot reload friendly** - State doesn't break on updates

## Migration Strategy

1. **Phase 1**: Implement new `/new` route with local state
2. **Phase 2**: Update API endpoints for streaming-first approach
3. **Phase 3**: Implement new `/chat/[id]` route with simple Zustand
4. **Phase 4**: Remove old complex architecture
5. **Phase 5**: Add advanced features (message editing, branching, etc.)

## Success Metrics

- **Time to first token**: < 100ms
- **Navigation speed**: < 50ms route transitions
- **Bundle size**: Smaller due to simpler state management
- **Bug reports**: Fewer due to simpler architecture
- **Developer velocity**: Faster feature development

---

This architecture prioritizes user experience while maintaining code simplicity. The key insight is that streaming should never be blocked by database operations, and local state should be the source of truth for immediate UI feedback.