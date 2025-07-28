# OpenAI Reasoning Tokens Integration Design

## Overview

This design document outlines the integration of OpenAI's new Responses API reasoning tokens into our chat application. The Responses API provides access to the internal "thinking" process of o-series models (o1, o3, o3-mini, o4-mini) through streaming reasoning summaries, which need to be captured, stored, and displayed in our UI.

## Background

### OpenAI Responses API & Reasoning Models

OpenAI's o-series models (o1, o3, o3-mini, o4-mini) perform internal reasoning before generating their final response. The new Responses API exposes this reasoning process through:

1. **Reasoning Tokens**: Hidden tokens used internally by the model for reasoning (not returned in content)
2. **Reasoning Summaries**: Natural language summaries of the model's thought process
3. **Streaming Reasoning Events**: Real-time streaming of reasoning summaries as they're generated

### Key Features
- **Reasoning Effort Parameter**: `low`, `medium`, `high` - controls reasoning depth
- **Streaming Support**: Real-time reasoning summary streaming
- **Cost Efficiency**: Reasoning tokens preserved across tool calls
- **Background Mode**: Async processing for complex reasoning tasks

### Reasoning Event Types

Based on the OpenAI documentation, the following reasoning-related events are streamed:

```typescript
// Reasoning summary events
response.reasoning_summary_part.added
response.reasoning_summary_part.done
response.reasoning_summary_text.delta
response.reasoning_summary_text.done
response.reasoning_summary.delta
response.reasoning_summary.done
```

## Current Architecture Analysis

### Database Schema (Events Table)

Our current `events` table structure:
```sql
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  segments jsonb NOT NULL DEFAULT '[]',
  ts bigint NOT NULL,
  order_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

### Current Streaming Architecture

Our `FrontendEventHandler` currently handles:
- `token`: Text streaming
- `tool_start`, `tool_finalized`, `tool_result`, `tool_complete`: Tool calls
- `complete`, `error`: Stream completion/errors

### Frontend State Management

Events are managed through:
- **Zustand Store**: `eventChatStore.ts` for conversation state
- **Local State**: Optimistic updates during streaming
- **React Query**: Server state caching

## Design Goals

1. **Capture Reasoning**: Store all reasoning tokens and summaries
2. **Stream Reasoning**: Display reasoning in real-time during generation
3. **Hide/Show Toggle**: Allow users to expand/collapse reasoning sections
4. **Preserve Context**: Maintain reasoning across tool calls and branching
5. **Performance**: Minimize impact on existing chat performance
6. **Testing**: Comprehensive logging and validation of reasoning events
7. **Backward Compatibility**: Maintain existing chat functionality

## Database Schema Changes

### Option 1: Extend Events Table (Recommended)

Add a single reasoning field to the existing `events` table:

```sql
-- Add reasoning column to events table
ALTER TABLE public.events 
ADD COLUMN reasoning jsonb DEFAULT NULL;

-- Add index for reasoning queries
CREATE INDEX idx_events_has_reasoning ON public.events 
WHERE reasoning IS NOT NULL;

-- Add GIN index for reasoning data queries
CREATE INDEX idx_events_reasoning ON public.events 
USING gin (reasoning);
```

**Reasoning Data Structure:**

The OpenAI API provides reasoning as multiple indexed **parts** that could be treated as separate events (similar to tool calls). For now, we'll store them in a single JSONB field, but we should consider splitting them into separate events in the future.

```typescript
interface ReasoningPart {
  summary_index: number; // Index of this reasoning part
  type: 'summary_text';
  text: string;
  sequence_number: number;
  is_complete: boolean; // Whether this part is done streaming
  created_at: number; // Timestamp when part was created
}

interface ReasoningData {
  item_id: string;
  output_index: number;
  
  // Parts are indexed and can stream independently
  parts: Record<number, ReasoningPart>; // Keyed by summary_index
  
  // Combined text for display (computed from parts)
  combined_text?: string;
  
  // Metadata
  effort_level?: 'low' | 'medium' | 'high';
  reasoning_tokens?: number;
  
  // Streaming state
  is_streaming?: boolean;
  streaming_part_index?: number; // Which part is currently streaming
  
  // Debug info
  raw_events: Array<{
    type: string;
    data: any;
    sequence_number: number;
    timestamp: number;
  }>;
}
```

**Future Consideration**: Each reasoning part could be stored as a separate `reasoning` role event with a `reasoning_part` segment type, similar to how tool calls are handled:

```typescript
// Future approach - separate events per reasoning part
interface ReasoningPartEvent extends Event {
  role: 'reasoning';
  segments: [{
    type: 'reasoning_part';
    item_id: string;
    output_index: number;
    summary_index: number;
    text: string;
    is_complete: boolean;
  }];
}
```

### Option 2: Separate Reasoning Table (Alternative)

Create a dedicated table for reasoning data:

```sql
CREATE TABLE public.reasoning_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  output_index integer NOT NULL DEFAULT 0,
  summary_index integer NOT NULL DEFAULT 0,
  summary_text text,
  raw_events jsonb NOT NULL DEFAULT '[]',
  effort_level text CHECK (effort_level IN ('low', 'medium', 'high')),
  reasoning_tokens integer,
  created_at timestamptz DEFAULT now()
);
```

**Recommendation**: Use Option 1 (extend events table) for simplicity and to maintain the event-centric architecture.

## Frontend Event Handling Changes

### New Event Types

Extend `StreamEvent` interface in `frontendEventHandler.ts`:

```typescript
export interface StreamEvent {
  // Existing types
  type: 'token' | 'tool_start' | 'tool_finalized' | 'tool_result' | 'tool_complete' | 'complete' | 'error'
    // New reasoning types
    | 'reasoning_summary_part_added' | 'reasoning_summary_part_done'
    | 'reasoning_summary_text_delta' | 'reasoning_summary_text_done'
    | 'reasoning_summary_delta' | 'reasoning_summary_done';
  
  // Existing fields
  content?: string;
  tool_id?: string;
  tool_name?: string;
  args?: object;
  output?: object;
  error?: string;
  
  // New reasoning fields
  item_id?: string;
  output_index?: number;
  summary_index?: number;
  part?: {
    type: string;
    text: string;
  };
  delta?: string | { text: string };
  text?: string;
  sequence_number?: number;
}
```

### Reasoning Event Handlers

Add new methods to `FrontendEventHandler`:

```typescript
class FrontendEventHandler {
  // ... existing methods

  private currentReasoningData: Map<string, ReasoningData> = new Map();

  // NOTE: Update the handleStreamEvent switch statement to include:
  // case 'reasoning_summary_part_added': await this.handleReasoningSummaryPartAdded(data); break;  
  // case 'reasoning_summary_part_done': await this.handleReasoningSummaryPartDone(data); break;
  // case 'reasoning_summary_text_delta': await this.handleReasoningSummaryTextDelta(data); break;
  // case 'reasoning_summary_text_done': await this.logReasoningEvent(data); break;
  // case 'reasoning_summary_delta': await this.handleReasoningSummaryTextDelta(data); break;
  // case 'reasoning_summary_done': await this.handleReasoningSummaryDone(data); break;

  private async handleReasoningSummaryPartAdded(data: StreamEvent): Promise<void> {
    const { item_id, output_index, summary_index, part, sequence_number } = data;
    
    if (!item_id || !part || summary_index === undefined) return;
    
    // Initialize or get existing reasoning data
    let reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) {
      reasoningData = {
        item_id,
        output_index: output_index || 0,
        parts: {},
        raw_events: [],
        is_streaming: true
      };
      this.currentReasoningData.set(item_id, reasoningData);
    }
    
    // Create or update the reasoning part
    reasoningData.parts[summary_index] = {
      summary_index,
      type: part.type,
      text: part.text,
      sequence_number: sequence_number || 0,
      is_complete: false,
      created_at: Date.now()
    };
    
    // Update streaming state
    reasoningData.streaming_part_index = summary_index;
    
    // Log raw event for debugging
    reasoningData.raw_events.push({
      type: 'reasoning_summary_part_added',
      data: { ...data },
      sequence_number: sequence_number || 0,
      timestamp: Date.now()
    });
    
    // Update UI state
    this.updateReasoningInState(item_id, reasoningData);
  }

  private async handleReasoningSummaryTextDelta(data: StreamEvent): Promise<void> {
    const { item_id, delta, summary_index, sequence_number } = data;
    
    if (!item_id || !delta || summary_index === undefined) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
    // Find the reasoning part to update by index
    const reasoningPart = reasoningData.parts[summary_index];
    if (!reasoningPart) {
      // Create part if it doesn't exist (defensive programming)
      reasoningData.parts[summary_index] = {
        summary_index,
        type: 'summary_text',
        text: '',
        sequence_number: sequence_number || 0,
        is_complete: false,
        created_at: Date.now()
      };
    }
    
    // Append delta text
    const deltaText = typeof delta === 'string' ? delta : delta.text || '';
    reasoningData.parts[summary_index].text += deltaText;
    
    // Update streaming state
    reasoningData.streaming_part_index = summary_index;
    
    // Log raw event
    reasoningData.raw_events.push({
      type: 'reasoning_summary_text_delta',
      data: { ...data },
      sequence_number: sequence_number || 0,
      timestamp: Date.now()
    });
    
    // Update UI state
    this.updateReasoningInState(item_id, reasoningData);
  }

  private async handleReasoningSummaryPartDone(data: StreamEvent): Promise<void> {
    const { item_id, summary_index, sequence_number } = data;
    
    if (!item_id || summary_index === undefined) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData || !reasoningData.parts[summary_index]) return;
    
    // Mark this specific part as complete
    reasoningData.parts[summary_index].is_complete = true;
    
    // Log raw event
    reasoningData.raw_events.push({
      type: 'reasoning_summary_part_done',
      data: { ...data },
      sequence_number: sequence_number || 0,
      timestamp: Date.now()
    });
    
    // Update UI state
    this.updateReasoningInState(item_id, reasoningData);
  }

  private async handleReasoningSummaryDone(data: StreamEvent): Promise<void> {
    const { item_id, text, sequence_number } = data;
    
    if (!item_id) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
    // Finalize all reasoning - combine all parts
    const sortedParts = Object.values(reasoningData.parts)
      .sort((a, b) => a.summary_index - b.summary_index);
    
    reasoningData.combined_text = text || sortedParts
      .map(part => part.text)
      .join('\n\n');
    
    // Mark all streaming as complete
    reasoningData.is_streaming = false;
    reasoningData.streaming_part_index = undefined;
    
    // Mark all parts as complete
    Object.values(reasoningData.parts).forEach(part => {
      part.is_complete = true;
    });
    
    // Log raw event
    reasoningData.raw_events.push({
      type: 'reasoning_summary_done',
      data: { ...data },
      sequence_number: sequence_number || 0,
      timestamp: Date.now()
    });
    
    // Update UI state and mark as complete
    this.updateReasoningInState(item_id, reasoningData, true);
    
    // Clean up after completion
    this.currentReasoningData.delete(item_id);
  }

  // Helper method for logging reasoning events that don't need special handling
  private async logReasoningEvent(data: StreamEvent): Promise<void> {
    const { item_id, sequence_number } = data;
    
    if (!item_id) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
    // Just log the event for debugging
    reasoningData.raw_events.push({
      type: data.type,
      data: { ...data },
      sequence_number: sequence_number || 0,
      timestamp: Date.now()
    });
  }

  private updateReasoningInState(item_id: string, reasoningData: ReasoningData, isComplete = false): void {
    if (this.isLocalState()) {
      this.updateLocalStateReasoning(item_id, reasoningData, isComplete);
    } else {
      this.updateStoreStateReasoning(item_id, reasoningData, isComplete);
    }
  }

  private updateLocalStateReasoning(item_id: string, reasoningData: ReasoningData, isComplete: boolean): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              reasoning: reasoningData,
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateStoreStateReasoning(item_id: string, reasoningData: ReasoningData, isComplete: boolean): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    // Find the assistant event being streamed
    const streamingEventId = conversation.streamingEventId;
    if (!streamingEventId) return;

    const updatedEvents = conversation.events.map(event =>
      event.id === streamingEventId
        ? {
            ...event,
            reasoning: reasoningData,
            ts: Date.now()
          }
        : event
    );

    store.setConversation(this.conversationId, {
      ...conversation,
      events: updatedEvents
    });
  }
}
```

## UI Components Design

### Event Item Enhancement

Extend `EventItem` component to display reasoning:

```typescript
// components/EventList/EventItem.tsx
interface EventItemProps {
  event: Event & {
    reasoning?: ReasoningData;
  };
  // ... existing props
}

export function EventItem({ event, ...props }: EventItemProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  
  const hasReasoning = event.reasoning;
  const isReasoningStreaming = event.reasoning?.is_streaming;
  
  // Show reasoning automatically during streaming, hide when complete
  const shouldShowReasoning = showReasoning || isReasoningStreaming;
  
  return (
    <div className="event-item">
      {/* Existing event content */}
      <div className="event-content">
        {/* Render regular segments */}
      </div>
      
      {/* Reasoning section */}
      {hasReasoning && (
        <div className="reasoning-section">
          {/* Only show toggle button when not streaming */}
          {!isReasoningStreaming && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReasoning(!showReasoning)}
              className="reasoning-toggle"
            >
              <Brain className="h-4 w-4 mr-2" />
              {showReasoning ? 'Hide' : 'Show'} Reasoning
              <ChevronDown className={cn(
                "h-4 w-4 ml-2 transition-transform",
                showReasoning && "rotate-180"
              )} />
            </Button>
          )}
          
          {shouldShowReasoning && (
            <div className="reasoning-content mt-3 p-4 bg-muted/50 rounded-lg border">
              <div className="reasoning-header mb-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Model Reasoning
                  {isReasoningStreaming && (
                    <Loader2 className="h-3 w-3 ml-2 animate-spin inline" />
                  )}
                </span>
                {event.reasoning.effort_level && (
                  <Badge variant="outline" className="ml-2">
                    {event.reasoning.effort_level} effort
                  </Badge>
                )}
              </div>
              
              <div className="reasoning-text prose prose-sm max-w-none">
                {event.reasoning.combined_text && (
                  <ReactMarkdown>{event.reasoning.combined_text}</ReactMarkdown>
                )}
                
                {/* Show individual parts during streaming if combined_text not ready */}
                {!event.reasoning.combined_text && Object.keys(event.reasoning.parts).length > 0 && (
                  <div className="reasoning-parts space-y-3">
                    {Object.values(event.reasoning.parts)
                      .sort((a, b) => a.summary_index - b.summary_index)
                      .map((part) => (
                        <div key={part.summary_index} className="reasoning-part">
                          <div className="text-xs text-muted-foreground mb-1">
                            Part {part.summary_index + 1}
                            {!part.is_complete && (
                              <Loader2 className="h-3 w-3 ml-1 animate-spin inline" />
                            )}
                          </div>
                          <ReactMarkdown className="text-sm">
                            {part.text}
                          </ReactMarkdown>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              
              {/* Debug info in development */}
              {process.env.NODE_ENV === 'development' && event.reasoning && (
                <details className="mt-4">
                  <summary className="text-xs text-muted-foreground cursor-pointer">
                    Debug: Raw Reasoning Events ({event.reasoning.raw_events.length})
                  </summary>
                  <pre className="text-xs mt-2 p-2 bg-background rounded overflow-auto">
                    {JSON.stringify(event.reasoning.raw_events, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Streaming Reasoning Display

Add a streaming indicator for reasoning:

```typescript
// components/ReasoningIndicator.tsx
interface ReasoningIndicatorProps {
  isStreaming: boolean;
  currentText?: string;
}

export function ReasoningIndicator({ isStreaming, currentText }: ReasoningIndicatorProps) {
  if (!isStreaming && !currentText) return null;
  
  return (
    <div className="reasoning-indicator p-3 bg-blue-50 border-l-4 border-blue-400 rounded-r-lg">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-medium text-blue-800">
          Thinking...
        </span>
        {isStreaming && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
      </div>
      
      {currentText && (
        <div className="text-sm text-blue-700 font-mono whitespace-pre-wrap">
          {currentText}
        </div>
      )}
    </div>
  );
}
```

## Backend API Changes

### Responses API Integration

Update the chat API to use OpenAI's Responses API:

```typescript
// app/api/chat-new/route.ts or similar
export async function POST(request: Request) {
  // ... existing setup

  // Detect if model supports reasoning
  const isReasoningModel = ['o1', 'o3', 'o3-mini', 'o4-mini'].some(
    model => selectedModel.includes(model)
  );

  if (isReasoningModel) {
    // Use Responses API for reasoning models
    const response = await openai.beta.responses.create({
      model: selectedModel,
      messages: messages,
      stream: true,
      reasoning_effort: budConfig?.reasoning_effort || 'medium'
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const event of response) {
              // Transform OpenAI reasoning events to our format
              const transformedEvent = transformReasoningEvent(event);
              
              if (transformedEvent) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(transformedEvent)}\n\n`)
                );
              }
            }
          } catch (error) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
            );
          } finally {
            controller.close();
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        }
      }
    );
  } else {
    // Use regular Chat Completions API for non-reasoning models
    // ... existing implementation
  }
}

function transformReasoningEvent(openaiEvent: any): StreamEvent | null {
  switch (openaiEvent.type) {
    case 'response.reasoning_summary_part.added':
      return {
        type: 'reasoning_summary_part_added',
        item_id: openaiEvent.item_id,
        output_index: openaiEvent.output_index,
        summary_index: openaiEvent.summary_index,
        part: openaiEvent.part,
        sequence_number: openaiEvent.sequence_number
      };
      
    case 'response.reasoning_summary_text.delta':
      return {
        type: 'reasoning_summary_text_delta',
        item_id: openaiEvent.item_id,
        output_index: openaiEvent.output_index,
        summary_index: openaiEvent.summary_index,
        delta: openaiEvent.delta,
        sequence_number: openaiEvent.sequence_number
      };
      
    case 'response.reasoning_summary.done':
      return {
        type: 'reasoning_summary_done',
        item_id: openaiEvent.item_id,
        output_index: openaiEvent.output_index,
        summary_index: openaiEvent.summary_index,
        text: openaiEvent.text,
        sequence_number: openaiEvent.sequence_number
      };
      
    // Handle other reasoning events...
    
    default:
      // Log unknown events for debugging
      console.log('🤖 Unknown reasoning event:', openaiEvent.type, openaiEvent);
      return null;
  }
}
```

## Testing Strategy

### 1. Event Logging & Validation

Implement comprehensive logging to ensure no reasoning events are missed:

```typescript
// lib/reasoning/eventLogger.ts
export class ReasoningEventLogger {
  private static loggedEvents: Set<string> = new Set();
  private static unknownEvents: Array<{ type: string, data: any, timestamp: number }> = [];
  
  static logEvent(event: any): void {
    const eventId = `${event.type}-${event.sequence_number}-${event.item_id}`;
    
    if (this.loggedEvents.has(eventId)) {
      console.warn('🔄 Duplicate reasoning event:', eventId);
      return;
    }
    
    this.loggedEvents.add(eventId);
    
    const knownTypes = [
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_part.done',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_summary.delta',
      'response.reasoning_summary.done'
    ];
    
    if (!knownTypes.includes(event.type)) {
      this.unknownEvents.push({
        type: event.type,
        data: event,
        timestamp: Date.now()
      });
      console.warn('🚨 Unknown reasoning event type:', event.type, event);
    } else {
      console.log('✅ Processed reasoning event:', event.type, {
        item_id: event.item_id,
        sequence_number: event.sequence_number,
        summary_index: event.summary_index
      });
    }
  }
  
  static getUnknownEvents(): Array<{ type: string, data: any, timestamp: number }> {
    return [...this.unknownEvents];
  }
  
  static exportEventLog(): string {
    return JSON.stringify({
      processedEvents: Array.from(this.loggedEvents),
      unknownEvents: this.unknownEvents,
      timestamp: Date.now()
    }, null, 2);
  }
}
```

### 2. Unit Tests

```typescript
// __tests__/reasoning/eventHandler.test.ts
describe('Reasoning Event Handler', () => {
  let handler: FrontendEventHandler;
  
  beforeEach(() => {
    handler = new FrontendEventHandler('test-conversation', mockStore);
  });
  
  test('should handle reasoning_summary_part_added event', async () => {
    const event = {
      type: 'reasoning_summary_part_added',
      item_id: 'test-item',
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: 'Test reasoning' },
      sequence_number: 1
    };
    
    await handler.handleStreamEvent(event);
    
    // Assert reasoning data was stored correctly
    expect(handler.currentReasoningData.get('test-item')).toBeDefined();
  });
  
  test('should accumulate reasoning text deltas', async () => {
    // Test delta accumulation logic
  });
  
  test('should handle unknown reasoning events gracefully', async () => {
    const unknownEvent = {
      type: 'response.reasoning_unknown',
      item_id: 'test',
      data: { custom: 'data' }
    };
    
    await handler.handleStreamEvent(unknownEvent);
    
    // Should not throw and should log the unknown event
    expect(ReasoningEventLogger.getUnknownEvents()).toHaveLength(1);
  });
});
```

### 3. Integration Tests

```typescript
// __tests__/reasoning/integration.test.ts
describe('Reasoning Integration', () => {
  test('should stream reasoning from o3-mini model', async () => {
    const response = await fetch('/api/chat-new', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Explain quantum computing' }],
        model: 'o3-mini',
        reasoning_effort: 'high'
      })
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    let hasReasoningEvents = false;
    let reasoningComplete = false;
    
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          
          if (data.type?.includes('reasoning')) {
            hasReasoningEvents = true;
          }
          
          if (data.type === 'reasoning_summary_done') {
            reasoningComplete = true;
          }
        }
      }
    }
    
    expect(hasReasoningEvents).toBe(true);
    expect(reasoningComplete).toBe(true);
  });
});
```

### 4. Debug Tools

Add debugging components for development:

```typescript
// components/debug/ReasoningDebugPanel.tsx
export function ReasoningDebugPanel() {
  const [showDebug, setShowDebug] = useState(false);
  const unknownEvents = ReasoningEventLogger.getUnknownEvents();
  
  if (process.env.NODE_ENV !== 'development') return null;
  
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDebug(!showDebug)}
      >
        🧠 Debug ({unknownEvents.length})
      </Button>
      
      {showDebug && (
        <Card className="absolute bottom-12 right-0 w-96 max-h-96 overflow-auto">
          <CardHeader>
            <CardTitle className="text-sm">Reasoning Debug</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button
                size="sm"
                onClick={() => {
                  const log = ReasoningEventLogger.exportEventLog();
                  navigator.clipboard.writeText(log);
                  toast('Event log copied to clipboard');
                }}
              >
                Export Event Log
              </Button>
              
              {unknownEvents.length > 0 && (
                <div>
                  <h4 className="font-medium text-destructive">
                    Unknown Events ({unknownEvents.length})
                  </h4>
                  <div className="space-y-1 mt-2">
                    {unknownEvents.map((event, i) => (
                      <div key={i} className="text-xs p-2 bg-destructive/10 rounded">
                        <div className="font-mono">{event.type}</div>
                        <pre className="text-xs mt-1 overflow-hidden">
                          {JSON.stringify(event.data, null, 2).slice(0, 200)}...
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

## Migration Plan

### Phase 1: Database Schema (Week 1)
1. Create migration to add reasoning columns to events table
2. Update TypeScript types and interfaces
3. Deploy database changes to staging

### Phase 2: Backend Integration (Week 1-2)
1. Implement Responses API integration
2. Add reasoning event transformation logic
3. Update chat API endpoints
4. Add comprehensive logging

### Phase 3: Frontend Streaming (Week 2)
1. Extend FrontendEventHandler with reasoning events
2. Update streaming logic to handle reasoning
3. Add local state management for reasoning

### Phase 4: UI Components (Week 2-3)
1. Create reasoning display components
2. Add toggle functionality
3. Implement streaming indicators
4. Style reasoning sections

### Phase 5: Testing & Debugging (Week 3)
1. Implement event logging and validation
2. Add unit and integration tests
3. Create debug tools
4. Test with various reasoning models

### Phase 6: Deployment & Monitoring (Week 4)
1. Deploy to staging environment
2. Performance testing and optimization
3. Production deployment
4. Monitor reasoning event processing

## Performance Considerations

### Database
- Index reasoning data fields for efficient queries
- Consider partitioning for high-volume reasoning data
- Monitor JSONB performance with large reasoning objects

### Frontend
- Lazy load reasoning content (only when expanded)
- Debounce reasoning text delta updates
- Use virtual scrolling for conversations with extensive reasoning

### Memory Management
- Clear reasoning data from memory after streaming completes
- Implement cleanup for abandoned reasoning sessions
- Monitor memory usage during long reasoning sessions

## Security & Privacy

### Data Handling
- Reasoning summaries may contain sensitive information
- Apply same RLS policies as regular events
- Consider encryption for sensitive reasoning data

### Rate Limiting
- Reasoning models may have different rate limits
- Implement proper error handling for reasoning failures
- Fall back to regular chat completion if reasoning fails

## Future Enhancements

### Advanced Features
1. **Reasoning Highlighting**: Highlight specific parts of reasoning
2. **Reasoning Search**: Search within reasoning summaries
3. **Reasoning Export**: Export reasoning data for analysis
4. **Reasoning Analytics**: Track reasoning patterns and effectiveness

### Model Support
1. **Multi-Model Reasoning**: Support reasoning from different providers
2. **Reasoning Comparison**: Compare reasoning approaches
3. **Custom Reasoning Prompts**: Allow users to influence reasoning style

## Conclusion

This design provides a comprehensive approach to integrating OpenAI's reasoning tokens into our chat application. The implementation maintains backward compatibility while adding powerful new reasoning capabilities that enhance the user experience with o-series models.

The phased approach ensures systematic implementation with proper testing and validation at each step. The extensive logging and debugging tools will help identify and resolve any issues with reasoning event processing.

The UI design balances discoverability with usability, allowing users to access reasoning information when needed without cluttering the main chat interface.