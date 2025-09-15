# Vendor-Agnostic Message Schema Design

## Problem Statement

Currently, our codebase has tight coupling between vendor-specific tool calling paradigms (Anthropic vs OpenAI) and our message storage/display logic. This creates:

- Complex conditional logic scattered throughout the codebase
- Difficulty adding new model providers
- Inconsistent tool calling UX between providers
- Complex message reconstruction after database storage

## Solution: Event-Based Message Schema

### Core Event Schema

```typescript
type Role = 'system' | 'user' | 'assistant' | 'tool';

type Segment = 
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: object }
  | { type: 'tool_result'; id: string; output: object };

interface Event {
  id: string;           // uuid
  role: Role;
  segments: Segment[];  // ordered – may contain 1-N segments
  ts: number;          // unix millis
}
```

### Key Benefits

1. **Vendor Agnostic**: Single representation for all providers
2. **Tool Call Matching**: `tool_call` and `tool_result` share same ID
3. **Streamable**: Can be built incrementally during streaming
4. **Deterministic**: Perfect replay and debugging capabilities
5. **Future Proof**: Ready for new providers and tool paradigms

## Mapping to Current Database Schema

### Current Schema
```sql
-- Current messages table
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id),
  role text NOT NULL,
  content text NOT NULL,
  json_meta jsonb DEFAULT '{}',
  order_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### New Events Table Schema

```sql
-- New events table - clean event-driven design
CREATE TABLE events (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id),
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  segments jsonb NOT NULL DEFAULT '[]',
  ts bigint NOT NULL,
  order_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_events_conversation_id ON events(conversation_id);
CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_order_key ON events(order_key);
CREATE INDEX idx_events_role ON events(role);

-- GIN index for efficient segment queries
CREATE INDEX idx_events_segments ON events USING gin (segments);
```

### Migration Strategy

Since we're not in production yet, we can implement a straightforward migration:

1. **Create Events Table**: Add new events table alongside existing messages
2. **Dual Write Period**: Write to both tables during transition
3. **Migrate Existing Data**: Convert current messages to events
4. **Update Application**: Switch all reads to events table
5. **Remove Messages Table**: Drop old table after verification

#### Migration Script Structure
```sql
-- Step 1: Create events table
-- (schema above)

-- Step 2: Migrate existing data
INSERT INTO events (id, conversation_id, role, segments, ts, order_key, created_at)
SELECT 
  gen_random_uuid() as id,
  conversation_id,
  role,
  CASE 
    WHEN json_meta ? 'tool_calls' THEN 
      -- Convert tool calls to segments
      (SELECT jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', content),
        -- Add tool_call segments from json_meta
      ))
    ELSE 
      -- Simple text message
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', content))
  END as segments,
  EXTRACT(epoch FROM created_at) * 1000 as ts,
  order_key,
  created_at
FROM messages;

-- Step 3: Verify migration
SELECT 
  (SELECT COUNT(*) FROM messages) as old_count,
  (SELECT COUNT(*) FROM events) as new_count;
```

## Implementation Plan

### Phase 1: Core Infrastructure

1. **Create Event Types** (`/lib/types/events.ts`)
   ```typescript
   export interface Event {
     id: string;
     role: Role;
     segments: Segment[];
     ts: number;
   }
   
   export interface EventLog {
     events: Event[];
     addEvent(event: Event): void;
     getUnresolvedToolCalls(): ToolCall[];
     toProviderMessages(provider: 'anthropic' | 'openai'): any[];
   }
   ```

2. **Create Provider Mappers** (`/lib/providers/`)
   ```typescript
   // /lib/providers/anthropic.ts
   export function eventsToAnthropicMessages(events: Event[]): AnthropicMessage[]
   export function anthropicResponseToEvents(response: AnthropicResponse): Event[]
   
   // /lib/providers/openai.ts  
   export function eventsToOpenAIMessages(events: Event[]): OpenAIMessage[]
   export function openaiResponseToEvents(response: OpenAIResponse): Event[]
   ```

3. **Update Database Layer** (`@budchat/data`)
   ```typescript
   // Repository-style helpers accept a Supabase client
   export async function saveEvent(supabase, event: Event, opts: { conversationId: string; orderKey?: string | null }): Promise<DatabaseEvent>
   export async function getConversationEvents(supabase, conversationId: string): Promise<DatabaseEvent[]>
   export async function loadConversationEvents(supabase, conversationId: ConversationId): Promise<Event[]>
   export async function updateEventSegments(supabase, eventId: string, segments: Segment[]): Promise<void>
   ```

### Phase 2: Streaming Integration

1. **Event Stream Builder** (`/lib/streaming/eventBuilder.ts`)
   ```typescript
   export class EventStreamBuilder {
     private currentEvent: Partial<Event> | null = null;
     
     addTextChunk(text: string): void;
     addToolCall(id: string, name: string, args: object): void;
     addToolResult(id: string, output: object): void;
     finalize(): Event;
   }
   ```

2. **Update Chat API** (`/app/api/chat-new/route.ts`)
   ```typescript
   // Replace current streaming logic with event-based approach
   const eventLog = new EventLog();
   const eventBuilder = new EventStreamBuilder();
   
   // During streaming:
   eventBuilder.addTextChunk(delta.text);
   
   // On tool call:
   eventBuilder.addToolCall(toolId, toolName, toolArgs);
   
   // On completion:
   const event = eventBuilder.finalize();
   eventLog.addEvent(event);
   await saveEvent(conversationId, event);
   ```

### Phase 3: Frontend Integration

1. **Event-Based Message Components** (`/components/EventMessage.tsx`)
   ```typescript
   export function EventMessage({ event }: { event: Event }) {
     return (
       <div className="message">
         {event.segments.map((segment, i) => (
           <SegmentRenderer key={i} segment={segment} />
         ))}
       </div>
     );
   }
   
   function SegmentRenderer({ segment }: { segment: Segment }) {
     switch (segment.type) {
       case 'text': return <TextSegment text={segment.text} />;
       case 'tool_call': return <ToolCallSegment {...segment} />;
       case 'tool_result': return <ToolResultSegment {...segment} />;
     }
   }
   ```

2. **Real-time Event Updates** (`/components/EventStream.tsx`)
   ```typescript
   // Handle streaming events in real-time
   useEffect(() => {
     const eventSource = new EventSource('/api/events/stream');
     eventSource.onmessage = (event) => {
       const eventData = JSON.parse(event.data);
       updateEventInUI(eventData);
     };
   }, []);
   ```

### Phase 4: Migration and Cleanup

1. **Database Migration** (`/supabase/migrations/`)
   ```sql
   -- Create events table and migrate data
   -- Full migration script provided in schema section above
   ```

2. **Application Migration** (`/scripts/migrate-to-events.ts`)
   ```typescript
   // Switch application to use events table
   async function migrateApplication() {
     // 1. Update all queries to use events table
     // 2. Update streaming to create events
     // 3. Update UI components to render events
     // 4. Test all functionality
   }
   ```

3. **Remove Legacy Code**
   - Remove vendor-specific message handling
   - Remove complex tool call reconstruction logic
   - Simplify streaming implementation
   - Remove provider-specific UI components
   - Drop messages table after verification

## Benefits After Migration

### For Developers
- **Single Source of Truth**: All tool interactions follow same pattern
- **Easier Testing**: Deterministic event replay
- **Simpler Code**: No vendor-specific conditionals
- **Better Debugging**: Complete event history

### For Users
- **Consistent UX**: Same tool calling experience across providers
- **Better Performance**: More efficient streaming and storage
- **Reliable Persistence**: No more lost tool call information
- **Rich History**: Complete interaction timeline

### For Operations
- **Vendor Flexibility**: Easy to switch or add providers
- **Better Analytics**: Unified event tracking
- **Simplified Debugging**: Single event log to analyze
- **Cost Optimization**: Efficient token usage tracking

## Implementation Timeline

- **Week 1**: Core event types and provider mappers
- **Week 2**: Database migration and event storage
- **Week 3**: Streaming integration and API updates
- **Week 4**: Frontend event components and UI updates
- **Week 5**: Data migration and legacy code removal
- **Week 6**: Testing, optimization, and documentation

## Risk Mitigation

1. **Backward Compatibility**: Keep existing message table during migration
2. **Feature Flags**: Gradual rollout of event-based system
3. **Data Integrity**: Comprehensive migration testing
4. **Performance**: Benchmark event storage vs current approach
5. **Rollback Plan**: Ability to revert to current system if needed

## Next Steps

1. **Validate Design**: Review with team and gather feedback
2. **Prototype Core**: Build minimal event system proof of concept
3. **Performance Testing**: Benchmark event storage and retrieval
4. **Migration Planning**: Detailed data migration strategy
5. **Implementation**: Begin Phase 1 development

This design provides a clean, vendor-agnostic foundation that will simplify our codebase while providing better user experience and developer productivity.
