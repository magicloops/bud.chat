# Debug: React Maximum Update Depth Exceeded

## Problem Summary
- **Streaming works correctly** ✅ - tokens arrive and display properly
- **React throws infinite update error** ❌ - "Maximum update depth exceeded"
- **Error location**: `setStreamingEvents` in chat page `stableUpdater` function
- **Trigger**: Token updates during streaming cause cascading state updates

## Error Details

### Stack Trace
```
Maximum update depth exceeded. This can happen when a component calls setState 
inside useEffect, but useEffect either doesn't have a dependency array, or one 
of the dependencies changes on every render.

app/(chat)/chat/[conversationId]/page.tsx (342:9) @ stableUpdater
> 342 |         setStreamingEvents(prevEvents => {
```

### Call Chain
```
ChatPage.handleSendMessage.stableUpdater
  ↓ 
FrontendEventHandler.updateLocalStateToken (line 735)
  ↓
FrontendEventHandler.handleTokenEvent (line 273)
  ↓  
FrontendEventHandler.handleStreamEvent (line 160)
  ↓
ChatPage.handleSendMessage (line 425)
```

## Root Cause Analysis

### Theory 1: Cascading State Updates ⭐ Most Likely
**Issue**: Each token update triggers a new render, which somehow triggers more updates
- Token arrives → `setStreamingEvents` → re-render → triggers more `setStreamingEvents`
- Could be caused by dependencies in useEffect or other hooks changing on every render
- `finalStreamingEvents = updated` assignment might be causing issues

### Theory 2: useEffect Dependency Issues
**Issue**: Some useEffect has missing/incorrect dependencies that change every render
- `streamingEvents` changing triggers useEffect
- useEffect modifies state that triggers more `streamingEvents` updates  
- Infinite loop: state → useEffect → state → useEffect

### Theory 3: Reference Instability
**Issue**: Objects/functions being recreated on every render
- `stableUpdater` function recreated every time `handleSendMessage` is called
- `finalStreamingEvents` reference changing triggers updates
- Event objects not properly memoized

### Theory 4: Event Handler Issues
**Issue**: Event processing logic triggering additional state updates
- `FrontendEventHandler.updateLocalStateToken` modifying state beyond `streamingEvents`
- Other parts of the component reacting to streaming state changes
- Store updates happening simultaneously with local state updates

## Investigation Points

### 1. Check useEffect Dependencies
Look for useEffects in ChatPage that depend on `streamingEvents`:
```typescript
// Find patterns like this:
useEffect(() => {
  // Some logic that modifies state
}, [streamingEvents]) // ← Could cause infinite loop if logic modifies streamingEvents
```

### 2. Examine finalStreamingEvents Usage
```typescript
finalStreamingEvents = updated; // ← This assignment might be problematic
```
- Is `finalStreamingEvents` being read somewhere that triggers re-renders?
- Should this be in a ref instead of a variable?

### 3. Check stableUpdater Scope
```typescript
const stableUpdater = (updater: (events: Event[]) => Event[]) => {
  // Is this function stable? Or recreated on every render?
}
```

### 4. Verify Event Object Stability
- Are Event objects being recreated unnecessarily?
- Is the `updated === prevEvents` check working correctly?
- Are nested objects in events causing reference changes?

## Potential Solutions

### Solution 1: Use useRef for finalStreamingEvents
```typescript
const finalStreamingEventsRef = useRef<Event[]>(newEvents);

const stableUpdater = useCallback((updater: (events: Event[]) => Event[]) => {
  setStreamingEvents(prevEvents => {
    if (!prevEvents) return prevEvents;
    const updated = updater(prevEvents);
    if (updated === prevEvents) return prevEvents;
    
    finalStreamingEventsRef.current = updated; // Use ref instead
    return updated;
  });
}, []); // Empty deps to make it truly stable
```

### Solution 2: Debounce State Updates
```typescript
const debouncedSetStreamingEvents = useMemo(
  () => debounce((updater: (events: Event[]) => Event[]) => {
    setStreamingEvents(prevEvents => {
      // ... update logic
    });
  }, 10), // 10ms debounce
  []
);
```

### Solution 3: Batch Updates with useTransition
```typescript
const [isPending, startTransition] = useTransition();

const stableUpdater = useCallback((updater: (events: Event[]) => Event[]) => {
  startTransition(() => {
    setStreamingEvents(prevEvents => {
      // ... update logic
    });
  });
}, []);
```

### Solution 4: Separate Token Accumulation from Display
```typescript
// Keep tokens in a ref for accumulation
const tokenBufferRef = useRef<string>('');
const flushTimeoutRef = useRef<NodeJS.Timeout>();

const stableUpdater = useCallback((updater: (events: Event[]) => Event[]) => {
  // Accumulate tokens without immediate state update
  // Flush periodically to prevent infinite updates
}, []);
```

### Solution 5: Check and Fix useEffect Dependencies
Find and fix any useEffects with problematic dependencies:
```typescript
// Instead of:
useEffect(() => {
  // logic
}, [streamingEvents]) // Changes every token

// Use:
useEffect(() => {
  // logic  
}, [streamingEvents?.length]) // Only changes when events added/removed
```

## Investigation Steps

### Step 1: Add Debug Logging
```typescript
const stableUpdater = useCallback((updater: (events: Event[]) => Event[]) => {
  console.log('🔄 stableUpdater called');
  setStreamingEvents(prevEvents => {
    console.log('📝 setStreamingEvents callback running', { 
      prevEventsLength: prevEvents?.length 
    });
    // ... rest of logic
  });
}, []);
```

### Step 2: Check All useEffects
Search for all useEffect hooks in ChatPage that might depend on streaming state:
- `useEffect(..., [streamingEvents])`
- `useEffect(..., [..., existingConversation, ...])`
- Any useEffect without dependencies `useEffect(() => {})` 

### Step 3: Trace Event Object Creation
Verify that Event objects are not being unnecessarily recreated:
```typescript
const updated = updater(prevEvents);
console.log('Events changed:', updated !== prevEvents, {
  prevLength: prevEvents?.length,
  newLength: updated.length,
  lastEventChanged: updated[updated.length - 1] !== prevEvents?.[prevEvents.length - 1]
});
```

### Step 4: Check Store vs Local State Conflicts
Ensure the FrontendEventHandler isn't simultaneously updating both:
- Local state (streamingEvents)
- Global store (useEventChatStore)

## Success Criteria
- Streaming continues to work correctly
- No more "Maximum update depth exceeded" errors
- React DevTools Profiler shows reasonable update frequency
- UI remains responsive during streaming

## Files to Investigate
1. `/app/(chat)/chat/[conversationId]/page.tsx` - Main component with the error
2. `/lib/streaming/frontendEventHandler.ts` - Event processing logic
3. `/state/eventChatStore.ts` - Global state management
4. `/components/EventStream.tsx` - Display component

## Quick Fixes to Try

### Immediate (Low Risk)
1. **useRef for finalStreamingEvents**: Convert variable to ref
2. **Add useCallback**: Ensure stableUpdater is truly stable
3. **Review useEffect deps**: Look for streaming-related dependencies

### Medium Risk  
1. **Debounce updates**: Add small delay to batch rapid updates
2. **useTransition**: Mark updates as non-urgent
3. **Separate accumulation**: Use ref for token buffering

### High Risk (Last Resort)
1. **Rewrite streaming logic**: Different architecture for token handling
2. **Move to store-only**: Remove local state completely
3. **Custom hook**: Extract streaming logic to isolated hook

## Next Actions
1. Add debug logging to identify exact trigger
2. Review all useEffect dependencies in ChatPage  
3. Convert finalStreamingEvents to useRef
4. Test with simple streaming example