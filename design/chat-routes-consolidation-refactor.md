# Chat Routes Consolidation Refactor Plan

## Current State Analysis

We have two chat API routes with significant code duplication:

1. **`/api/chat-new/route.ts`** (804 lines) - Creates new conversations
2. **`/api/chat/[conversationId]/route.ts`** (652 lines) - Continues existing conversations

### Code Duplication Issues

**Identical Logic (~80% overlap):**
- Authentication and workspace validation
- Model provider detection (Anthropic/OpenAI/OpenAI-Responses)
- Provider-specific message conversion (`eventsToAnthropicMessages`, `eventsToOpenAIMessages`)
- Tool execution (`executeMCPToolCalls`)
- Streaming loop with tool call handling
- Event building and finalization
- Reasoning data collection and processing
- Error handling patterns

**Key Differences:**
- **New route**: Creates conversation in background, batch saves events, generates title
- **Existing route**: Loads existing events, saves events individually during streaming

### Problems with Current Approach

1. **Maintenance Burden**: Bug fixes and features must be applied twice
2. **Divergent Behavior**: Routes can get out of sync over time
3. **Code Complexity**: 1456 total lines for what should be shared logic
4. **Testing Overhead**: Need to test the same logic in two places
5. **Feature Drift**: New features might only be added to one route

## Proposed Refactor Architecture

### Core Idea: Shared Chat Engine + Route-Specific Adapters

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Chat Engine                      │
│  - Authentication & validation                             │
│  - Provider detection & message conversion                 │
│  - Streaming loop with tool execution                      │
│  - Event building & reasoning processing                   │
│  - Error handling                                          │
└─────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
   ┌─────────────────────────┐     ┌─────────────────────────┐
   │    New Chat Adapter     │     │  Existing Chat Adapter  │
   │  - Create conversation  │     │  - Load existing events │
   │  - Batch save events    │     │  - Save events during   │
   │  - Generate title       │     │    streaming             │
   └─────────────────────────┘     └─────────────────────────┘
```

## Implementation Plan

### Phase 1: Extract Shared Chat Engine

Create `/lib/chat/ChatEngine.ts` with:

```typescript
export interface ChatEngineConfig {
  // Event management
  eventLoader?: (conversationId: string) => Promise<Event[]>;
  eventSaver?: (event: Event, conversationId: string) => Promise<void>;
  batchEventSaver?: (events: Event[], conversationId: string) => Promise<void>;
  
  // Conversation management  
  conversationCreator?: (events: Event[], workspaceId: string, budId?: string) => Promise<string>;
  titleGenerator?: (conversationId: string, events: Event[]) => Promise<void>;
  
  // Streaming configuration
  streamingMode: 'individual' | 'batch'; // How to save events during streaming
}

export class ChatEngine {
  constructor(
    private config: ChatEngineConfig,
    private supabase: SupabaseClient,
    private openai: OpenAI,
    private anthropic: Anthropic
  ) {}

  async processChat(request: {
    messages: Event[];
    workspaceId: string;
    budId?: string;
    model: string;
    conversationId?: string;
  }): Promise<ReadableStream> {
    // All the shared logic here
  }
}
```

### Phase 2: Create Route Adapters

**New Chat Route Adapter:**
```typescript
// /lib/chat/NewChatAdapter.ts
export class NewChatAdapter {
  static createConfig(): ChatEngineConfig {
    return {
      eventLoader: undefined, // No existing events to load
      eventSaver: undefined,  // No individual saving during streaming
      batchEventSaver: async (events, conversationId) => {
        // Batch save all events at end
      },
      conversationCreator: async (events, workspaceId, budId) => {
        // Create conversation in background
      },
      titleGenerator: async (conversationId, events) => {
        // Generate title in background
      },
      streamingMode: 'batch'
    };
  }
}
```

**Existing Chat Route Adapter:**
```typescript
// /lib/chat/ExistingChatAdapter.ts
export class ExistingChatAdapter {
  static createConfig(conversationId: string): ChatEngineConfig {
    return {
      eventLoader: async () => await getConversationEvents(conversationId),
      eventSaver: async (event) => await saveEvent(event, { conversationId }),
      batchEventSaver: undefined, // No batch saving needed
      conversationCreator: undefined, // Conversation already exists
      titleGenerator: undefined, // No title generation needed
      streamingMode: 'individual'
    };
  }
}
```

### Phase 3: Refactor Route Files

**New `/api/chat-new/route.ts` (reduced from 804 to ~100 lines):**
```typescript
import { ChatEngine } from '@/lib/chat/ChatEngine';
import { NewChatAdapter } from '@/lib/chat/NewChatAdapter';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  
  // Authentication & validation (shared helper)
  const { user, workspaceId, messages, model, budId } = await validateChatRequest(request, supabase);
  
  // Create chat engine with new chat configuration
  const engine = new ChatEngine(
    NewChatAdapter.createConfig(),
    supabase, openai, anthropic
  );
  
  // Process chat with shared engine
  return new Response(await engine.processChat({
    messages, workspaceId, budId, model
  }));
}
```

**New `/api/chat/[conversationId]/route.ts` (reduced from 652 to ~100 lines):**
```typescript
import { ChatEngine } from '@/lib/chat/ChatEngine';
import { ExistingChatAdapter } from '@/lib/chat/ExistingChatAdapter';

export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const supabase = await createClient();
  const { conversationId } = await params;
  
  // Authentication & validation (shared helper)
  const { user, workspaceId, message, model } = await validateChatRequest(request, supabase);
  
  // Create chat engine with existing chat configuration
  const engine = new ChatEngine(
    ExistingChatAdapter.createConfig(conversationId),
    supabase, openai, anthropic
  );
  
  // Process chat with shared engine
  return new Response(await engine.processChat({
    messages: [message], // Single new message
    workspaceId, model, conversationId
  }));
}
```

## Detailed Extraction Strategy

### 1. Shared Core Functions

Extract these identical functions to `/lib/chat/shared.ts`:
- `executeMCPToolCalls()`
- `validateChatRequest()` (auth + workspace validation)
- Provider detection logic
- Message conversion utilities
- Error response formatting

### 2. Shared Streaming Loop

The main streaming loop is 90% identical. Extract to `ChatEngine.processChat()`:
- Provider-specific streaming setup
- Tool call execution loop
- Event building and finalization
- Reasoning data processing
- Complete event emission

### 3. Configurable Differences

Use the adapter pattern for:
- **Event Loading**: New chat has no events, existing chat loads from DB
- **Event Saving**: New chat batches at end, existing chat saves individually  
- **Conversation Creation**: New chat creates, existing chat skips
- **Title Generation**: New chat generates, existing chat skips

### 4. Shared Types and Interfaces

Create `/lib/chat/types.ts`:
```typescript
export interface ChatRequest {
  messages?: Event[];
  message?: string;
  workspaceId: string;
  budId?: string;
  model: string;
  conversationId?: string;
}

export interface ValidatedChatRequest {
  user: User;
  workspaceId: string;
  messages: Event[];
  model: string;
  budId?: string;
}
```

## Benefits of This Refactor

### 1. Maintainability
- **Single source of truth** for chat logic
- **Bug fixes applied once** and work everywhere
- **New features added once** and available to both routes

### 2. Consistency  
- **Identical behavior** between new and existing chats
- **Same error handling** and edge case management
- **Consistent streaming patterns**

### 3. Code Reduction
- **~1200 lines reduced to ~400 lines** (70% reduction)
- **Shared logic extracted** to reusable engine
- **Route files become simple adapters**

### 4. Testing
- **Test shared engine once** with different configurations
- **Route tests become integration tests** of adapters
- **Easier to mock** and test individual components

### 5. Future Extensibility
- **Easy to add new chat types** (e.g., `/api/chat-branch`)
- **Plugin architecture** for different behaviors
- **Cleaner separation of concerns**

## Migration Strategy

### Phase 1: Extract Core (Week 1)
1. Create `ChatEngine` class with shared streaming loop
2. Extract shared utilities and validation
3. Add comprehensive tests for `ChatEngine`

### Phase 2: Create Adapters (Week 1)  
1. Build `NewChatAdapter` and `ExistingChatAdapter`
2. Test adapters independently
3. Verify identical behavior to current routes

### Phase 3: Replace Routes (Week 2)
1. Replace `/api/chat-new/route.ts` with adapter-based version
2. Replace `/api/chat/[conversationId]/route.ts` with adapter-based version  
3. Run integration tests to ensure no regression

### Phase 4: Cleanup (Week 2)
1. Remove duplicate code from old routes
2. Update documentation
3. Add performance monitoring

## Risk Mitigation

### 1. Gradual Migration
- Keep old routes as fallback during migration
- Use feature flags to switch between old/new implementations
- Roll back quickly if issues arise

### 2. Comprehensive Testing
- Unit tests for `ChatEngine` with different adapter configs
- Integration tests for both route behaviors
- Load testing to ensure no performance regression

### 3. Backward Compatibility
- Ensure identical API contracts
- Same response formats and error codes
- Same streaming behavior and timing

## Success Metrics

- **Lines of Code**: Reduce from 1456 to ~400 lines (70% reduction)
- **Code Duplication**: Eliminate 80% of duplicated logic
- **Test Coverage**: Maintain 100% coverage with fewer tests
- **Bug Fixes**: Apply once instead of twice
- **Feature Development**: Add once instead of twice

## Conclusion

This refactor transforms two large, duplicated route files into a clean, shared engine with simple adapters. The result is more maintainable, consistent, and extensible code that follows DRY principles while preserving all existing functionality.

The adapter pattern allows us to keep the specific behaviors needed by each route type while sharing the complex streaming, provider, and tool execution logic that should be identical between routes.