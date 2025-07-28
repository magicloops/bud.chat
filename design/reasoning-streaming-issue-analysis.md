# Reasoning Streaming Issue Analysis

## Problem Statement

The reasoning section in the UI behaves incorrectly:
1. ✅ **Shows during streaming** - reasoning section becomes visible when o-series model starts reasoning
2. ❌ **Never auto-hides** - reasoning section stays visible indefinitely after reasoning completes
3. ❌ **Spinner never stops** - "Model Reasoning" spinner continues indefinitely
4. ❌ **No combined_text** - reasoning data never gets `combined_text` field populated

## Current State Analysis

Based on debug logs, the reasoning data structure shows:
```javascript
{
  hasReasoning: true,
  partsCount: 1, 
  hasCombinedText: false,        // ❌ Always false
  streamingPartIndex: undefined, // ❌ Always undefined  
  isReasoningStreaming: true,    // ❌ Always true
  shouldShowReasoning: true,     // ❌ Always true
  reasoningSection: "VISIBLE"    // ❌ Never hides
}
```

## OpenAI Reasoning Events Flow

According to OpenAI docs, the event sequence should be:

### During Reasoning:
1. `response.reasoning_summary_part.added` - New reasoning part created (empty text)
2. `response.reasoning_summary_text.delta` - Reasoning text being streamed in chunks
3. `response.reasoning_summary_text.done` - Reasoning text for this part is complete
4. `response.reasoning_summary_part.done` - This reasoning part is fully complete

### Reasoning Completion:
5. `response.reasoning_summary.done` - **FINAL EVENT** - All reasoning is complete with full text

### After Reasoning:
6. `response.output_text.delta` - Assistant response starts streaming
7. `response.completed` - Entire response (reasoning + output) is complete

## Hypotheses

### Hypothesis 1: Missing `response.reasoning_summary.done` Detection
**Theory**: We're not properly detecting or handling the final `response.reasoning_summary.done` event that should signal reasoning completion.

**Evidence**: 
- `combined_text` is always undefined (should be set when reasoning completes)
- `streamingPartIndex` is always undefined (should be cleared when reasoning completes)

**Investigation**: Check if `reasoning_summary_done` event handler is being called.

### Hypothesis 2: Event Processing Order Issue
**Theory**: The `response.reasoning_summary.done` event happens but gets processed after we've already finalized the event for database storage.

**Evidence**: 
- Backend shows reasoning finalization logic exists
- But database contains `is_streaming: true` (old data issue we addressed)

**Investigation**: Add backend logging to see exact event processing order.

### Hypothesis 3: Frontend State Update Timing
**Theory**: The reasoning completion updates the backend event but doesn't properly update the frontend UI state.

**Evidence**: 
- Reasoning section renders based on frontend event data
- If backend event gets updated but frontend state doesn't, UI stays in streaming state

**Investigation**: Check if reasoning completion updates are reaching the frontend component.

### Hypothesis 4: Multiple Event Streams Confusion
**Theory**: We have multiple events for the same reasoning (different `item_id`s) and we're mixing them up.

**Evidence**: 
- OpenAI can emit multiple reasoning parts with different `summary_index` values
- Our collector might be managing multiple reasoning datasets incorrectly

**Investigation**: Log all `item_id` and `summary_index` values to see if we have conflicts.

## Current Code Flow Analysis

### Backend (chat-new route):
```javascript
// ✅ Creates reasoning collector
const reasoningCollector = new Map<string, any>()

// ✅ Handles reasoning events  
if (event.type.includes('reasoning_summary')) {
  // Creates/updates reasoning data
}

// ✅ Has reasoning_summary_done handler
else if (event.type === 'reasoning_summary_done') {
  reasoningData.combined_text = text || /* combine parts */
  // ❌ But does this actually get called?
}

// ✅ Attaches reasoning to event on finalize_only
else if (event.type === 'finalize_only') {
  eventBuilder.setReasoningData(reasoningData)
}
```

### Frontend (EventItem):
```javascript
// ✅ Detects reasoning exists
const hasReasoning = !!event.reasoning

// ❌ Logic always shows streaming=true  
const isReasoningStreaming = hasReasoning && (
  event.reasoning?.streaming_part_index !== undefined || 
  !event.reasoning?.combined_text  // This is always true!
)
```

## Action Plan

### Phase 1: Backend Event Flow Verification
1. Add debug logging to see which reasoning events are actually being processed
2. Verify `reasoning_summary_done` handler is being called  
3. Check if `combined_text` is being set in reasoning data
4. Confirm event processing order vs finalization timing

### Phase 2: Frontend State Debugging  
1. Add logging to show when reasoning data changes in the UI
2. Verify if completed reasoning data reaches the component
3. Check if there are multiple competing reasoning data sources

### Phase 3: Fix Implementation
Based on findings from phases 1-2, implement the correct fix:
- If backend issue: Fix event processing order or completion detection
- If frontend issue: Fix state computation logic
- If timing issue: Ensure proper event sequencing

## Success Criteria

After fix, reasoning should behave as:
1. **During streaming**: `isReasoningStreaming: true`, section visible, spinner showing
2. **After completion**: `isReasoningStreaming: false`, section hidden, no spinner  
3. **Manual toggle**: User can click "Show Reasoning" to reveal completed reasoning
4. **Database**: No `is_streaming` field stored, only content data

## Next Steps

1. Implement Phase 1 backend debugging
2. Test with o-series model and analyze logs
3. Proceed with Phase 2 if backend looks correct
4. Implement targeted fix based on findings