# MCP Output Capture Issues - Analysis & Solutions

## Problem Summary

Our MCP integration is working but has two critical issues:
1. **Duplicate tool result events** - tools are saved twice (first without output, then with output)
2. **Unnecessary second OpenAI stream** - system thinks tools are unresolved and triggers another API call

## Root Cause Analysis

### Issue 1: Duplicate Tool Result Events

**What's happening:**
1. `response.mcp_call.completed` event fires → we create a tool result event **without output**
2. `response.output_item.done` event fires → we create **another** tool result event **with output**

**Evidence from logs:**
```
🎯 MCP call completed: {
  tool_id: 'mcp_688959b3505881a2841ada6ea15ef60006349e1b3823bf6f',
  has_output: false,  // ❌ First event - no output
  has_error: false
}
📝 Adding event to EventLog: { id: '9452d500-c7c0-4fdb-b17c-607fd5619bef', role: 'tool' }

// Later...
🌐 [MCP-TRANSFORMER] ✅ MCP CALL DONE WITH OUTPUT: {
  tool_id: 'mcp_688959b3505881a2841ada6ea15ef60006349e1b3823bf6f',
  has_output: true,   // ✅ Second event - with output
  output_length: 6776,
  has_error: false
}
📝 Adding event to EventLog: { id: '57803a76-228e-4df5-9ca7-f66d13cdc46a', role: 'tool' }
```

**Root Cause:**
- `mcp_call.completed` events don't contain output data
- Output data comes through `output_item.done` events with `type: 'mcp_call'`
- We're handling both events and creating duplicate tool results

### Issue 2: Second OpenAI Stream

**What's happening:**
1. First stream completes with tool calls but **first tool result has no output**
2. `getUnresolvedToolCalls()` logic doesn't find matching tool results (or finds empty ones)
3. System thinks tools are still unresolved → triggers second OpenAI stream
4. Second stream just returns text response (no new tool calls needed)

**Evidence from logs:**
```
Tool result (mcp_688959b3505881a2841ada6ea15ef60006349e1b3823bf6f): {"result":"Tool executed by OpenAI - results included in response text"}
Tool result (mcp_688959b3505881a2841ada6ea15ef60006349e1b3823bf6f): "The React.js repository has recently released version `19.1.0`..."
```

## Architectural Issues

### 1. Event Processing Order
- OpenAI sends events in this order:
  1. `mcp_call.completed` (no output)
  2. `output_item.done` with `type: 'mcp_call'` (with output)
- We process both, creating duplicate results

### 2. Tool Resolution Logic
- `EventLog.getUnresolvedToolCalls()` checks for tool results by ID
- If first result has no meaningful output, system may not consider tool "resolved"
- This triggers unnecessary conversation continuation

### 3. Mixed Event Sources
- Some MCP data comes from lifecycle events (`mcp_call.completed`)
- Other MCP data comes from output events (`output_item.done`)
- We're not properly consolidating these

### 4. **Database Event Ordering Issue** ⭐ **CRITICAL**
- **Current flow**: Tool results saved during streaming → Assistant message saved at end
- **Problem**: Assistant message gets later fractional index than tool results
- **Expected order**: Assistant (with tool calls) → Tool results → Next assistant response
- **Actual order**: Tool results → Assistant (with tool calls) → Next assistant response

**Evidence:**
```
During streaming:
  ✅ User message (index: 1.0)
  ❌ Tool result (index: 1.1) - saved immediately
  ❌ Tool result (index: 1.2) - saved immediately
  ❌ Assistant message (index: 1.3) - saved at end ← WRONG ORDER

Should be:
  ✅ User message (index: 1.0)
  ✅ Assistant message (index: 1.1) - created early, updated later
  ✅ Tool result (index: 1.2) - saved during streaming
  ✅ Tool result (index: 1.3) - saved during streaming
```

## Proposed Solutions

### Solution 1: Skip mcp_call.completed Events ⭐ **RECOMMENDED**

**Approach:** Only process `output_item.done` events for MCP tools, ignore `mcp_call.completed`

**Changes needed:**
```typescript
// In openaiResponses.ts
case 'response.mcp_call.completed':
  console.log('🌐 [MCP-TRANSFORMER] mcp_call.completed - SKIPPING (output comes via output_item.done)');
  return null; // Don't process these events
```

**Pros:**
- Simple, surgical fix
- Eliminates duplicate tool results
- Aligns with OpenAI's event model (output data flows through output_item.done)

**Cons:**
- Relies on output_item.done events containing all necessary data

### Solution 2: Consolidate MCP Events

**Approach:** Collect MCP lifecycle events and consolidate them into single tool results

**Changes needed:**
- Track MCP call state across multiple events
- Only emit final result when output_item.done arrives
- Implement event deduplication logic

**Pros:**
- More robust handling of complex event flows
- Better error handling if events arrive out of order

**Cons:**
- More complex implementation
- Requires state management across events

### Solution 3: Fix Tool Resolution Logic

**Approach:** Improve `getUnresolvedToolCalls()` to properly detect resolved MCP tools

**Changes needed:**
- Check if tool result has meaningful output (not just existence)
- Consider MCP tools resolved if they have any output data
- Improve matching logic between tool calls and results

**Pros:**
- Addresses second stream issue directly
- Maintains current event processing

**Cons:**
- Doesn't fix duplicate events issue
- More complex logic changes needed

### Solution 4: Fix Database Event Ordering ⭐ **CRITICAL**

**Approach:** Create assistant message early, update it when streaming completes

**Changes needed:**
1. **Create placeholder assistant event** when streaming starts (before tool calls)
2. **Save placeholder to database** with correct fractional index
3. **Stream normally** and save tool results as they come
4. **Update assistant event** in database when streaming completes

**Implementation:**
```typescript
// When streaming starts (in ChatEngine)
const placeholderAssistant = createTextEvent('assistant', 'thinking...');
await this.config.eventSaver(placeholderAssistant, conversationId); // Gets index 1.1

// During streaming - tool results get later indexes
// Tool result 1: index 1.2
// Tool result 2: index 1.3

// When streaming completes
const finalAssistant = { ...placeholderAssistant, segments: finalSegments };
await this.config.eventUpdater(finalAssistant, conversationId); // Keep index 1.1
```

**Pros:**
- Maintains correct conversation order in database
- Frontend streaming still works perfectly
- Future conversation context is properly ordered
- No impact on user experience

**Cons:**
- Requires database update functionality
- Slightly more complex streaming logic

## Recommended Implementation Plan

### Phase 1: Fix Duplicate Events (High Priority) ✅ **COMPLETED**
1. ✅ **Skip mcp_call.completed events** - only process output_item.done
2. ✅ **Test tool result creation** - ensure single event per tool
3. ✅ **Verify output data flows correctly**

### Phase 2: Fix Database Event Ordering (High Priority) 🚧 **NEXT**
1. **Create database event update functionality**
2. **Modify ChatEngine to create placeholder assistant event early**
3. **Update assistant event when streaming completes**
4. **Test correct conversation order in database**

### Phase 3: Fix Second Stream Issue (High Priority)  
1. **Check EventLog.getUnresolvedToolCalls()** - ensure MCP tools are properly resolved
2. **Test conversation flow** - single stream should complete conversation
3. **Add better logging** for tool resolution decisions

### Phase 4: Architecture Cleanup (Medium Priority)
1. **Consolidate MCP event handling** - single source of truth for each tool
2. **Improve error handling** - handle missing or malformed output gracefully
3. **Add comprehensive tests** - prevent regressions

## Code Changes Required

### 1. Skip mcp_call.completed Events ✅ **COMPLETED**
```typescript
// /lib/providers/openaiResponses.ts
case 'response.mcp_call.completed':
  console.log('🌐 [MCP-TRANSFORMER] mcp_call.completed - SKIPPING (output handled by output_item.done)');
  return null;
```

### 2. Ensure output_item.done Handles MCP Tools ✅ **COMPLETED**
```typescript
// Verify this case properly creates tool result events
} else if (doneItem?.type === 'mcp_call') {
  return {
    type: 'mcp_tool_complete',
    tool_id: doneItem.id as string,
    output: doneItem.output || undefined, // ✅ This should have the real output
    error: doneItem.error || undefined
  };
}
```

### 3. Debug Tool Resolution ✅ **COMPLETED**
```typescript
// /lib/types/events.ts - Add logging to getUnresolvedToolCalls()
getUnresolvedToolCalls(): ToolCall[] {
  // ... existing logic ...
  console.log('🔧 Tool resolution check:', {
    totalToolCalls: toolCalls.size,
    resolvedToolCalls: resolvedIds.size,
    unresolvedCount: unresolvedCalls.length,
    unresolvedToolIds: unresolvedCalls.map(t => t.id)
  });
  return unresolvedCalls;
}
```

### 4. Add Database Event Update Functionality 🚧 **NEEDED**
```typescript
// No separate API needed! Just update Supabase directly in ChatEngine
// Update in the existing eventSaver logic when streaming completes
```

### 5. Modify ChatEngine for Early Assistant Creation 🚧 **NEEDED**
```typescript
// /lib/chat/ChatEngine.ts - In handleOpenAIResponsesStream()
async handleOpenAIResponsesStream(...) {
  // Create placeholder assistant event BEFORE streaming starts
  const placeholderAssistant = createTextEvent('assistant', '');
  
  // Save placeholder to database immediately (gets correct fractional index)
  if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
    await this.config.eventSaver(placeholderAssistant, conversationId);
  }
  
  // Store placeholder ID for later updates
  let assistantEventId = placeholderAssistant.id;
  
  // ... existing streaming logic ...
  
  // When streaming completes, update the placeholder
  if (event.type === 'finalize_only' && !eventFinalized) {
    const finalEvent = eventBuilder.finalize();
    
    // Update database record directly (no EventLog update needed)
    if (this.config.streamingMode === 'individual' && conversationId) {
      const { error } = await supabase
        .from('messages')
        .update({ 
          segments: JSON.stringify(finalEvent.segments),
          reasoning: finalEvent.reasoning ? JSON.stringify(finalEvent.reasoning) : null,
          updated_at: new Date().toISOString()
        })
        .eq('conversation_id', conversationId)
        .eq('id', assistantEventId);
        
      if (error) {
        console.error('Failed to update assistant event in database:', error);
      } else {
        console.log('✅ Updated assistant event in database');
      }
    }
    
    // Don't add event to EventLog or call eventSaver again - just update database
    eventFinalized = true;
  }
}
```

## Success Criteria

1. ✅ **Single tool result per MCP tool call** - no duplicates in database
2. **Correct database event ordering** - Assistant message before tool results  
3. **Single OpenAI stream per user message** - no unnecessary API calls  
4. **Tool outputs properly captured** - MCP results available for future conversation turns
5. **Frontend displays tool calls correctly** - with proper output data

### Database Order Verification
```sql
-- Should show correct order:
SELECT id, role, segments, order_key, created_at 
FROM messages 
WHERE conversation_id = 'test-conv-id' 
ORDER BY order_key;

-- Expected result:
-- 1. user message (order_key: 1.0)
-- 2. assistant message with tool calls (order_key: 1.1) ← Created early
-- 3. tool result 1 (order_key: 1.2) ← Saved during streaming  
-- 4. tool result 2 (order_key: 1.3) ← Saved during streaming
-- 5. next user message (order_key: 2.0)
```

## Testing Plan

1. **Make MCP request** - trigger DeepWiki tool call
2. **Check database** - verify single tool result event with output
3. **Verify no second stream** - conversation should complete after first stream
4. **Test follow-up questions** - ensure MCP results are available for context

---

*This analysis is based on the server logs showing duplicate tool result creation and unnecessary second OpenAI API calls during MCP tool usage.*