# Conversation Switching Performance Analysis

## Current Issue

Despite implementing cache-first conversation loading with hover preloading, conversation switching still feels slower than expected. Network logs show we're waiting for `/api/conversations` endpoint before proper rendering occurs.

## Expected vs Actual Behavior

### Expected Flow (Cache-First)
1. User hovers over conversation → Full conversation preloaded into `conversations` store
2. User clicks conversation → **Immediate render** from cached data
3. API call runs in background → Updates cache when complete
4. **Total perceived load time**: ~0ms (instant)

### Actual Flow (Current Issue)
1. User hovers over conversation → Preloading occurs ✅
2. User clicks conversation → Still waiting for API call 🚨
3. `/api/conversations` completes → Conversation renders
4. **Total perceived load time**: ~200-500ms (network dependent)

## Root Cause Hypotheses

### Hypothesis 1: Cache Miss During Click
- Preloading might not be completing before user clicks
- Cache might be getting cleared/invalidated
- Hover timeout (150ms) might be too long for quick users

### Hypothesis 2: Rendering Logic Issues
- EventStream might not be using cached data properly
- Loading states might be blocking cached rendering
- React Query might be preventing cached data usage

### Hypothesis 3: Cache Storage Issues
- Zustand persistence might be interfering
- Store updates might not be atomic
- Race conditions between preload and click

### Hypothesis 4: Component Re-render Issues
- Chat page might be re-mounting on route change
- useQuery might be forcing fresh fetches
- State changes might be triggering unnecessary re-renders

## Debugging Strategy

### Phase 1: Verify Cache Population
**Goal**: Confirm preloading is working and cache is populated

```typescript
// Add to ConversationList.tsx handleConversationHover
console.log('🐭 [HOVER] Starting preload for:', conversationId);

// Add timeout completion
console.log('📦 [PRELOAD] Completed for:', conversationId, {
  hasFullConversation: !!fullConversations[conversationId],
  eventCount: fullConversations[conversationId]?.events.length || 0,
  metadata: fullConversations[conversationId]?.meta
});
```

**Add to ConversationList.tsx render (for clicked conversation):**
```typescript
const handleConversationClick = (conversationId: string) => {
  const cachedConv = fullConversations[conversationId];
  console.log('👆 [CLICK] Conversation clicked:', conversationId, {
    hasCachedData: !!cachedConv,
    eventCount: cachedConv?.events.length || 0,
    assistantName: cachedConv?.meta.assistant_name
  });
};
```

### Phase 2: Verify Chat Page Data Flow
**Goal**: Track how cached data flows through chat page logic

```typescript
// Add to chat/[conversationId]/page.tsx at start of component
console.log('🏠 [CHAT_PAGE] Rendering for:', conversationId, {
  hasExistingConversation: !!existingConversation,
  existingEventCount: existingConversation?.events.length || 0,
  isLoading,
  hasConversationData: !!conversationData
});

// Add to chat page data passing logic
console.log('📤 [CHAT_PAGE] Passing to EventStream:', {
  shouldPassEvents,
  eventsToPassCount: eventsToPass?.length || 0,
  conversationIdPassed: shouldPassEvents ? undefined : workingConversationId,
  hasCachedConversation: !!existingConversation
});
```

### Phase 3: Verify EventStream Rendering
**Goal**: Confirm EventStream uses cached data immediately

```typescript
// Add to EventStream.tsx at start of component
console.log('🎬 [EVENT_STREAM] Rendering with:', {
  hasEvents: !!events,
  eventCount: events?.length || 0,
  hasCachedConversation: !!cachedConversation,
  cachedEventCount: cachedConversation?.events.length || 0,
  conversationId,
  renderPath: events ? 'direct-events' : 
              cachedConversation ? 'cached-conversation' : 
              conversationId ? 'store-lookup' : 'welcome'
});
```

### Phase 4: Track React Query Behavior
**Goal**: Understand if React Query is blocking cached renders

```typescript
// Add to chat page useQuery
const { data: conversationData, isLoading, error } = useQuery({
  queryKey: ['conversation', conversationId],
  queryFn: async () => {
    console.log('🔄 [REACT_QUERY] Starting fetch for:', conversationId);
    const response = await fetch(`/api/conversations/${conversationId}?include_events=true`);
    console.log('📡 [REACT_QUERY] Fetch completed for:', conversationId, {
      status: response.status,
      ok: response.ok
    });
    // ... rest of function
  },
  enabled: !isNewConversation && !isTempConversation && !!conversationId,
  staleTime: 0,
  gcTime: Infinity,
});

// Add after query definition
console.log('⚛️ [REACT_QUERY] State:', {
  conversationId,
  isLoading,
  hasData: !!conversationData,
  hasError: !!error
});
```

### Phase 5: Track Loading State Logic
**Goal**: Verify loading states don't block cached rendering

```typescript
// Add before each loading state check in chat page
const shouldShowLoading = (!isNewConversation && !isTempConversation && isLoading && !existingConversation);
console.log('⏳ [LOADING_STATE] Check:', {
  conversationId,
  isNewConversation,
  isTempConversation,
  isLoading,
  hasExistingConversation: !!existingConversation,
  shouldShowLoading,
  decision: shouldShowLoading ? 'SHOW_LOADING' : 'RENDER_CONTENT'
});
```

## Expected Debug Output Timeline

For a properly working cache-first flow:

```
🐭 [HOVER] Starting preload for: abc-123
📦 [PRELOAD] Completed for: abc-123 (hasFullConversation: true, eventCount: 15)
👆 [CLICK] Conversation clicked: abc-123 (hasCachedData: true, eventCount: 15)
🏠 [CHAT_PAGE] Rendering for: abc-123 (hasExistingConversation: true, existingEventCount: 15)
⏳ [LOADING_STATE] Check: shouldShowLoading: false, decision: RENDER_CONTENT
📤 [CHAT_PAGE] Passing to EventStream: shouldPassEvents: true, eventsToPassCount: 15
🎬 [EVENT_STREAM] Rendering with: renderPath: direct-events, eventCount: 15
🔄 [REACT_QUERY] Starting fetch for: abc-123 (background refresh)
📡 [REACT_QUERY] Fetch completed for: abc-123 (status: 200)
```

## Performance Metrics to Track

### Time-to-First-Render
- Time from click to first meaningful content display
- **Target**: <50ms (perceived instant)
- **Current**: 200-500ms

### Cache Hit Rate
- Percentage of clicks that use cached data
- **Target**: >90% (most hovers should complete)
- **Current**: Unknown

### API Call Dependency
- Whether rendering waits for API completion
- **Target**: Independent (cache-first)
- **Current**: Dependent (API-first)

## Next Steps

1. **Add logging** from Phase 1-2 to understand cache population
2. **Test with various clicking speeds** (fast vs slow after hover)
3. **Monitor network tab** to see API call timing vs render timing
4. **Profile React DevTools** to see component render timing
5. **Compare with old implementation** to identify regression points

## Success Criteria

- [ ] Cached conversations render in <50ms
- [ ] API calls run in background without blocking UI
- [ ] Cache hit rate >90% for normal usage patterns
- [ ] No perceived loading delay for preloaded conversations