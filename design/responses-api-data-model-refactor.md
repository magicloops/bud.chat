# OpenAI Responses API Data Model Refactor

## Executive Summary

This document outlines a comprehensive refactor of our event data model to properly support the dynamic, interspersed nature of events from OpenAI's Responses API (used by o-series reasoning models with MCP integration). The current model fails to persist all reasoning events and lacks proper ordering/indexing for complex response streams.

## Current State & Problems

### Current Data Model
```sql
-- events table
CREATE TABLE events (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  role text NOT NULL, -- 'system', 'user', 'assistant', 'tool'
  segments jsonb NOT NULL, -- Array of segments (text, tool_call, tool_result)
  reasoning jsonb, -- Reasoning data for o-series models
  order_key text NOT NULL, -- Fractional indexing
  ts bigint NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

### Current Event Types
```typescript
type Segment = 
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: object; server_label?: string; }
  | { type: 'tool_result'; id: string; output: object; error?: string };

interface ReasoningData {
  item_id: string;
  output_index: number;
  parts: Record<number, ReasoningPart>;
  combined_text?: string;
  effort_level?: 'low' | 'medium' | 'high';
  reasoning_tokens?: number;
  streaming_part_index?: number;
}
```

### Identified Problems

1. **Missing Reasoning Events**: Only the first reasoning event is persisted to database, subsequent reasoning events are lost
2. **Missing Sequence Metadata**: `output_index` and `sequence_number` from OpenAI stream not always captured
3. **Rigid Data Model**: Current segments/reasoning split doesn't match the dynamic, interspersed nature of Responses API
4. **Ordering Issues**: No proper way to order interspersed reasoning and tool calls within a single assistant response
5. **Incomplete Persistence**: Frontend shows correct streaming but database only contains partial data after refresh

### OpenAI Responses API Event Flow
From the provided logs, we can see the typical flow:
```
1. reasoning (output_index: 9) 
2. tool_call (output_index: 10)
3. reasoning (output_index: 11)
4. tool_call (output_index: 12)
5. text content (output_index: 13)
```

Each event has:
- `sequence_number`: Overall ordering within the response
- `output_index`: Index of this particular output item
- `item_id`: Unique identifier for the item
- Item-specific data (reasoning summary, tool call args, etc.)

## Proposed Solution

### New Unified Data Model

#### 1. Enhanced Segments-Only Approach
Replace the current `segments` + `reasoning` dual-column approach with a unified, extensible `segments` column that can handle all response types:

```typescript
type UnifiedSegment = 
  // Existing segments (unchanged for compatibility)
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: object; server_label?: string; display_name?: string; server_type?: string; }
  | { type: 'tool_result'; id: string; output: object; error?: string }
  
  // New reasoning segments  
  | { 
      type: 'reasoning'; 
      id: string; // item_id from OpenAI
      output_index: number;
      sequence_number: number;
      parts: ReasoningPart[];
      combined_text?: string;
      effort_level?: 'low' | 'medium' | 'high';
      reasoning_tokens?: number;
    }
  
  // Future extensibility for other response types
  | { 
      type: 'completion_status';
      status: 'complete' | 'partial' | 'error';
      metadata?: Record<string, any>;
    };

interface ReasoningPart {
  summary_index: number;
  type: 'summary_text';
  text: string;
  sequence_number: number;
  is_complete: boolean;
  created_at: number;
}
```

#### 2. Enhanced Event Structure
```typescript
interface EnhancedEvent {
  id: string;
  role: Role;
  segments: UnifiedSegment[]; // Now handles ALL content types
  
  // Response-level metadata (for Responses API)
  response_metadata?: {
    total_output_items?: number;
    completion_status?: 'complete' | 'partial' | 'interrupted';
    usage?: {
      reasoning_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  
  ts: number;
}
```

#### 3. Database Schema Changes
```sql
-- Migration: Remove reasoning column, enhance segments
ALTER TABLE events 
  DROP COLUMN reasoning,
  ADD COLUMN response_metadata jsonb;

-- Add indexes for querying segments by type
CREATE INDEX idx_events_segments_type ON events 
  USING GIN ((segments::jsonb)) 
  WHERE segments IS NOT NULL;

-- Add index for output_index ordering within responses
CREATE INDEX idx_events_response_ordering ON events 
  USING BTREE (conversation_id, created_at, ((response_metadata->>'total_output_items')::int));
```

### Streaming Persistence Strategy

#### Incremental Database Updates
To ensure no data loss during streaming, we'll implement incremental updates to the assistant message as each segment is received:

```typescript
// In ChatEngine streaming handler
async handleReasoningComplete(reasoningData: ReasoningData) {
  // Add reasoning segment to event builder
  this.eventBuilder.addReasoningSegment(reasoningData);
  
  // Immediately persist to database
  await this.updateAssistantEventInDatabase();
}

async handleToolCallComplete(toolCallData: ToolCallData) {
  // Add tool call segment to event builder  
  this.eventBuilder.addToolCallSegment(toolCallData);
  
  // Immediately persist to database
  await this.updateAssistantEventInDatabase();
}

async updateAssistantEventInDatabase() {
  const currentSegments = this.eventBuilder.getSegments();
  const responseMetadata = this.eventBuilder.getResponseMetadata();
  
  const { error } = await this.supabase
    .from('events')
    .update({
      segments: currentSegments,
      response_metadata: responseMetadata,
      ts: Date.now()
    })
    .eq('conversation_id', this.conversationId)
    .eq('id', this.assistantEventId);
    
  if (error) {
    console.error('Failed to update assistant event:', error);
    // Continue streaming but log the error
  }
}
```

#### Persistence Timeline
1. **Event Creation**: Assistant placeholder created with empty segments before streaming starts
2. **Reasoning Updates**: Each completed reasoning segment immediately saved to DB
3. **Tool Call Updates**: Each tool call segment immediately saved to DB  
4. **Text Updates**: Text segments saved as they're completed
5. **Final Update**: Response metadata and completion status saved at stream end

#### Recovery Strategy  
If connection drops during streaming:
- Database contains all segments received up to that point
- Frontend can resume from last known state
- No reasoning or tool interaction data is lost
- User sees partial response with clear indication of interruption

#### Database Update Optimization
```typescript
// Batch updates for performance while maintaining safety
class StreamingPersistence {
  private pendingUpdate = false;
  private updateQueue: Segment[] = [];
  
  async queueSegmentUpdate(segment: UnifiedSegment) {
    this.updateQueue.push(segment);
    
    if (!this.pendingUpdate) {
      this.pendingUpdate = true;
      // Debounce for performance but ensure updates happen quickly
      setTimeout(() => this.flushUpdates(), 100);
    }
  }
  
  async flushUpdates() {
    if (this.updateQueue.length === 0) return;
    
    const segments = [...this.eventBuilder.getSegments(), ...this.updateQueue];
    await this.updateAssistantEventInDatabase(segments);
    
    this.updateQueue = [];
    this.pendingUpdate = false;
  }
}
```

### Implementation Strategy

#### Phase 1: Data Model Extension (Week 1)
1. **Extend segment types** to include reasoning segments
2. **Update TypeScript interfaces** for unified segments
3. **Create migration scripts** to move existing reasoning data into segments
4. **Update database schema** with new indexes

#### Phase 2: Backend Transformation (Week 1-2)
1. **Enhance OpenAI Responses transformer** to create reasoning segments instead of separate reasoning data
2. **Update ChatEngine** to handle unified segments throughout the pipeline
3. **Modify database persistence** to store all segments in unified format
4. **Add response metadata** tracking for completion status and usage stats

#### Phase 3: Frontend Adaptation (Week 2)
1. **Update EventItem component** to render reasoning segments like other segments
2. **Modify reasoning display logic** to work with segment-based data
3. **Ensure backward compatibility** for existing conversations
4. **Update streaming handlers** to work with new segment types

#### Phase 4: Migration & Cleanup (Week 2-3)
1. **Run data migration** on existing conversations
2. **Remove deprecated reasoning column** after successful migration
3. **Update API endpoints** to return unified format
4. **Add comprehensive tests** for all event types

### Detailed Implementation Plan

#### 1. OpenAI Responses API Transformer Changes

```typescript
// In openaiResponses.ts transformer
case 'response.output_item.added':
  if (event.item.type === 'reasoning') {
    return {
      type: 'reasoning_start',
      reasoning: {
        id: event.item.id,
        output_index: event.output_index,
        sequence_number: event.sequence_number,
        parts: [],
        streaming: true
      }
    };
  }
  break;

case 'response.output_item.done':
  if (event.item.type === 'reasoning') {
    return {
      type: 'reasoning_complete',
      reasoning: {
        id: event.item.id,
        output_index: event.output_index,
        sequence_number: event.sequence_number,
        parts: event.item.summary.map(part => ({
          summary_index: part.summary_index,
          type: part.type,
          text: part.text,
          sequence_number: part.sequence_number,
          is_complete: true,
          created_at: Date.now()
        })),
        combined_text: event.item.summary.map(p => p.text).join('\n'),
        streaming: false
      }
    };
  }
  break;
```

#### 2. ChatEngine Event Builder Changes

```typescript
// In ChatEngine.ts
class EventBuilder {
  private segments: UnifiedSegment[] = [];
  private responseMetadata: ResponseMetadata = {};
  
  addReasoningSegment(reasoningData: ReasoningData) {
    const reasoningSegment: UnifiedSegment = {
      type: 'reasoning',
      id: reasoningData.id,
      output_index: reasoningData.output_index,
      sequence_number: reasoningData.sequence_number,
      parts: reasoningData.parts,
      combined_text: reasoningData.combined_text,
      effort_level: reasoningData.effort_level,
      reasoning_tokens: reasoningData.reasoning_tokens
    };
    
    this.segments.push(reasoningSegment);
    this.sortSegmentsBySequence();
  }
  
  private sortSegmentsBySequence() {
    this.segments.sort((a, b) => {
      const aSeq = 'sequence_number' in a ? a.sequence_number : 0;
      const bSeq = 'sequence_number' in b ? b.sequence_number : 0;
      return aSeq - bSeq;
    });
  }
}
```

#### 3. Database Migration Script

```sql
-- Step 1: Add new columns
ALTER TABLE events 
  ADD COLUMN response_metadata jsonb,
  ADD COLUMN new_segments jsonb;

-- Step 2: Migrate existing data
UPDATE events 
SET new_segments = CASE
  WHEN reasoning IS NOT NULL THEN
    segments::jsonb || jsonb_build_array(
      jsonb_build_object(
        'type', 'reasoning',
        'id', reasoning->>'item_id',
        'output_index', (reasoning->>'output_index')::int,
        'sequence_number', 0, -- Default for migrated data
        'parts', reasoning->'parts',
        'combined_text', reasoning->>'combined_text',
        'effort_level', reasoning->>'effort_level',
        'reasoning_tokens', (reasoning->>'reasoning_tokens')::int
      )
    )
  ELSE segments::jsonb
END;

-- Step 3: Replace columns
ALTER TABLE events 
  DROP COLUMN segments,
  DROP COLUMN reasoning;

ALTER TABLE events 
  RENAME COLUMN new_segments TO segments;

-- Step 4: Add constraints and indexes
ALTER TABLE events 
  ALTER COLUMN segments SET NOT NULL;

CREATE INDEX idx_events_segments_gin ON events USING GIN (segments);
CREATE INDEX idx_events_response_metadata ON events USING GIN (response_metadata);
```

### Compatibility Strategy

#### Backward Compatibility
1. **API Compatibility**: Existing API endpoints continue to work by transforming unified segments back to old format when needed
2. **Frontend Compatibility**: EventItem component handles both old and new segment formats during transition
3. **Data Migration**: Existing reasoning data is automatically converted to reasoning segments

#### Forward Compatibility  
1. **Extensible Segment Types**: New segment types can be added without schema changes
2. **Response Metadata**: Flexible JSONB field for future OpenAI API enhancements
3. **Provider Support**: Design supports future providers with similar streaming patterns

### Success Metrics

#### Technical Metrics
- **Data Completeness**: 100% of reasoning events persisted (vs current ~10-20%)
- **Ordering Accuracy**: All segments properly ordered by sequence_number
- **Performance**: No degradation in query performance for event retrieval
- **Compatibility**: Zero breaking changes for existing functionality

#### User Experience Metrics
- **Consistency**: Frontend display matches database state after refresh
- **Completeness**: All reasoning steps visible in conversation history  
- **Performance**: No slowdown in conversation loading or streaming

### Risks & Mitigations

#### Data Migration Risks
- **Risk**: Large table migration causes downtime
- **Mitigation**: Online migration with background processing, rollback scripts

#### Performance Risks  
- **Risk**: Larger JSONB segments impact query performance
- **Mitigation**: Targeted GIN indexes, query optimization, monitoring

#### Compatibility Risks
- **Risk**: Breaking changes affect existing integrations
- **Mitigation**: Dual-format support during transition, comprehensive testing

### Timeline

| Week | Phase | Deliverables |
|------|-------|-------------|
| 1 | Data Model & Backend | New segment types, migration scripts, ChatEngine updates |
| 2 | Frontend & Testing | EventItem updates, streaming fixes, integration tests |
| 3 | Migration & Launch | Data migration, monitoring, documentation |

### Conclusion

This refactor addresses the core data persistence issues with OpenAI Responses API while maintaining full backward compatibility. The unified segment approach provides a solid foundation for future API enhancements while ensuring all reasoning and tool interaction data is properly captured and ordered.

The key benefits:
1. **Complete Data Persistence**: All reasoning events saved to database
2. **Proper Ordering**: Sequence-aware segment ordering
3. **Future-Proof**: Extensible design for new response types
4. **Zero Downtime**: Online migration with backward compatibility
5. **Enhanced User Experience**: Consistent frontend/database state

This solution ensures our application can fully leverage the rich interaction patterns of OpenAI's o-series models while maintaining reliability and performance.