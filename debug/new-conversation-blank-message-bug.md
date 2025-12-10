# Debug: Blank Assistant Message After New Conversation Streaming Completes

**Status**: Investigation in progress
**Environment**: Production
**Severity**: High (frequent user-facing bug)

## Symptom

1. User starts on `/chat/new` (stub page)
2. User sends a message
3. Conversation is created on the backend
4. Assistant response streams fully and is visible during streaming
5. When streaming completes, route transitions to `/chat/[conversationId]`
6. **BUG**: After transition, the assistant message appears blank

The user sees the full response stream in, but upon completion, the UI re-renders with an empty assistant message.

---

## Architecture Overview

### New Conversation Flow

```
User types message on /chat/new
    ↓
handleSendMessage() in page.tsx
    ↓
Creates tempConversationId (UUID)
Adds to Zustand store with user event + assistant placeholder
    ↓
POST /api/chat { mode: 'new', messages, workspaceId, budId }
    ↓
Backend creates conversation in DB
Emits SSE: conversationCreated { conversationId: realId }
Streams response tokens
    ↓
FrontendEventHandler processes stream
Updates EventBuilder draft (NOT store)
Overlays render streaming content
    ↓
Server emits: message_final { event: canonicalAssistantEvent }
Server emits: complete (done event)
    ↓
Client receives complete → builds real conversation
Calls router.replace(`/chat/${realConversationId}`)
setCurrentConversationId(realConversationId)
Removes temp conversation from store
    ↓
React re-renders with new conversationId
EventList reads from store.conversations[realConversationId]
```

### Key Files

| File | Purpose |
|------|---------|
| `app/(chat)/chat/[conversationId]/page.tsx` | Page component, handles new conversation flow |
| `state/eventChatStore.ts` | Zustand store for conversations/events |
| `lib/streaming/frontendEventHandler.ts` | Processes SSE stream events |
| `components/EventStream.tsx` | Main chat UI container |
| `components/EventList/index.tsx` | Renders event list |
| `components/EventList/EventItem.tsx` | Individual event rendering |

---

## Data Flow Analysis

### 1. Where Events Live During Streaming

**For new conversations (`/chat/new`):**
- User event + assistant placeholder stored in `conversations[tempConversationId]`
- Streaming content lives in EventBuilder draft registry (`setDraft()`)
- Store is NOT updated during streaming (optimization to prevent re-renders)
- `onMessageFinal` callback updates temp conversation with canonical event

**For existing conversations (`/chat/[id]`):**
- Events stored in `conversations[conversationId]`
- Streaming content also uses draft registry
- `onMessageFinal` commits to store

### 2. Route Transition Logic (page.tsx lines 398-467)

When `complete` event is received:
```typescript
// 1. Get latest store state
const latestStore = useEventChatStore.getState();
const tempConv = latestStore.conversations[tempConversationId];

// 2. Build real conversation from temp
const mergedEvents = lastFinalEvent
  ? tempConv.events.filter(e => e.id !== assistantPlaceholder.id && e.id !== lastFinalEvent.id).concat([lastFinalEvent])
  : [...tempConv.events.filter(e => e.id !== assistantPlaceholder.id)];

const realConv = {
  ...tempConv,
  id: realConversationId,
  events: mergedEvents,
  isStreaming: false,
  // ...
};

// 3. Set real conversation FIRST
latestStore.setConversation(realConversationId, realConv);

// 4. Update workspace conversations (replace temp ID with real ID)
// 5. Migrate summaries
// 6. Remove temp conversation
latestStore.removeConversation(tempConversationId);

// 7. Update route
router.replace(`/chat/${realConversationId}`);
setCurrentConversationId(realConversationId);
```

### 3. EventList Rendering (index.tsx lines 36-40)

```typescript
const storeConversation = useConversation(conversationId || '');
const conversation = providedConversation || storeConversation;
const displayEvents = events || conversation?.events || [];
```

---

## Hypotheses

### H1: Race Condition Between `message_final` and `complete` (LIKELY)

**Evidence from existing debug docs:** Server emits `complete` before `message_final` in some cases. The client processes `complete` first, builds the real conversation WITHOUT the canonical assistant event, then `message_final` arrives but the temp conversation is already deleted.

**Code path:**
1. `complete` arrives → builds `realConv` from `tempConv.events`
2. If `lastFinalEvent` is null (not received yet), `mergedEvents` only has events from temp (which may only have the placeholder)
3. `removeConversation(tempConversationId)` deletes temp
4. `message_final` arrives → `onMessageFinal` tries to update temp conversation → **temp doesn't exist**
5. Result: `realConv` has placeholder (empty) instead of canonical event

**Why it's "frequent in production":** Network latency varies; production may have more SSE buffering/batching differences than local dev.

### H2: Placeholder Not Being Replaced by Canonical Event

**Location:** `handleSendMessage()` in page.tsx, `onMessageFinal` callback

The `onMessageFinal` callback (lines 346-365) filters and replaces events:
```typescript
onMessageFinal: (finalEvent) => {
  const safeFinal = finalEvent.role === 'assistant' ? finalEvent : { ...finalEvent, role: 'assistant' as const };
  const store = useEventChatStore.getState();
  const tempConv = store.conversations[tempConversationId];
  if (!tempConv) return; // PROBLEM: temp may already be deleted
  const filtered = tempConv.events.filter(e => e.id !== safeFinal.id && e.id !== assistantPlaceholder.id);
  const events = [...filtered, safeFinal];
  store.setConversation(tempConversationId, { ...tempConv, events });
}
```

**Issue:** If temp conversation is deleted before this runs, the canonical event is lost.

### H3: Stale Closure in Real Conversation Assembly

**Location:** Complete handler (lines 406-420)

```typescript
const mergedEvents = lastFinalEvent
  ? tempConv.events.filter(e => e.id !== assistantPlaceholder.id && e.id !== lastFinalEvent!.id).concat([lastFinalEvent])
  : [...tempConv.events.filter(e => e.id !== assistantPlaceholder.id)];
```

**Issue:** `lastFinalEvent` is captured in closure. If the wait for final didn't resolve correctly:
```typescript
if (!finalReceived) {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 800));
  await Promise.race([waitForFinal, timeout]);
}
```

800ms timeout may not be enough in production, or the promise resolution may have a race.

### H4: EventBuilder Draft Not Merged Into Store

**For new conversations**, the streaming text accumulates in the EventBuilder draft, NOT in the store. The draft is accessed via `getDraft(eventId)` by rendering components.

When `complete` fires:
1. We build `realConv` from `tempConv.events` (store data)
2. But streaming text may still only be in the draft registry
3. If `message_final` hasn't arrived, `tempConv.events` still has the original placeholder (empty segments)

**Evidence:** The `lastFinalEvent` tracking (lines 336-364) was added to address this, but the timing is still fragile.

### H5: React Query Cache Mismatch

**Location:** page.tsx useQuery (lines 125-140)

```typescript
const { data: conversationData, isLoading, error } = useQuery({
  queryKey: ['conversation', conversationId],
  queryFn: async () => { /* fetch from API */ },
  enabled: !isNewConversation && !isTempConversation && !!conversationId && !existingConversation && !realConversation,
  staleTime: 5 * 60 * 1000,
});
```

**Issue:** After route change to `/chat/[realId]`:
- `isNewConversation` becomes false
- `existingConversation` checks `conversations[realId]`
- If the real conversation wasn't set properly, React Query may try to fetch
- But the store may have a partial/stale version

### H6: Zustand Subscriber Timing Issue

**Location:** EventList useConversation hook

```typescript
const storeConversation = useConversation(conversationId || '');
```

**Issue:** When `conversationId` prop changes (temp → real), the Zustand selector re-runs. If the real conversation was set but the component re-rendered before Zustand notified subscribers, it could read stale/undefined data.

**Mitigation check:** The existing code uses `setCurrentConversationId` to update local state AND `setSelectedConversation`, which should trigger proper re-renders.

### H7: Duplicate Event IDs Causing Filter Issues

**Location:** mergedEvents construction

```typescript
const mergedEvents = lastFinalEvent
  ? tempConv.events.filter(e => e.id !== assistantPlaceholder.id && e.id !== lastFinalEvent!.id).concat([lastFinalEvent])
  : [...tempConv.events.filter(e => e.id !== assistantPlaceholder.id)];
```

**Issue:** If the server uses the same event ID for streaming as the final event, and the `event_start` renamed the placeholder to match, we might filter out both and only add one back.

The `handleEventStart` in FrontendEventHandler renames placeholder:
```typescript
if (placeholderId && placeholderId !== serverId && streamingId === placeholderId) {
  const events = conv.events.map(e => e.id === placeholderId ? { ...e, id: serverId } : e);
  // ...
}
```

But this happens to `tempConversationId`, not tracked in `assistantPlaceholder.id` reference.

### H8: Realtime INSERT Overwriting Real Conversation

**Location:** eventChatStore.ts realtime handler (lines 380-463)

When a conversation is INSERTed via realtime:
```typescript
if (existingConversation && existingConversation.events.length > 0) {
  // Skip INSERT - just update metadata
} else {
  // Create new conversation with empty events
  const conversation: EventConversation = {
    id: conversationMeta.id,
    events: [], // EMPTY!
    isStreaming: false,
    meta: conversationMeta
  };
  state.conversations[conversationMeta.id] = conversation;
}
```

**Scenario:**
1. Client sets `realConv` with events
2. Realtime INSERT notification arrives (from DB insert)
3. If there's a timing window where `existingConversation.events.length === 0` (before client-side set completes), realtime handler creates conversation with empty events

**Guard exists:** Check for `existingConversation.events.length > 0`, but timing could still be an issue.

---

## Rendering Path Analysis

### EventStream Component

```typescript
// For new conversations (conversationId undefined):
<EventList
  events={events}  // From local state / existingConversation?.events
  conversation={localConversation}  // Optimistic meta
  autoScroll={true}
  isStreaming={isStreaming}
/>

// For existing conversations:
<EventList
  conversationId={conversationId}  // Real ID
  autoScroll={true}
/>
```

**Key observation:** After route change, EventStream switches from `events` prop to `conversationId` prop. The EventList then reads from store instead of props.

### EventList Component

```typescript
const displayEvents = events || conversation?.events || [];
```

If `events` prop is undefined and `conversation?.events` is empty array, renders nothing.

### EventItem Component

For streaming:
```typescript
{isStreaming ? (
  <StreamingTextSegment eventId={event.id} baseText={textContent || ''} isStreaming={true} />
) : (
  textContent && <MarkdownRenderer content={textContent} />
)}
```

If `textContent` is empty string and not streaming, nothing renders.

---

## Root Cause Hypothesis (Most Likely)

**The race condition between `message_final` and `complete` is the primary cause.**

Sequence:
1. Stream completes on server
2. Server emits `complete` (processed by client immediately)
3. Client builds real conversation from temp (which may only have placeholder)
4. Client deletes temp conversation and swaps route
5. Server emits `message_final` (processed after temp is deleted)
6. `onMessageFinal` callback tries to update non-existent temp conversation → no-op
7. Real conversation in store has placeholder with empty segments
8. UI renders blank message

**Why the 800ms timeout doesn't help:**
```typescript
if (!finalReceived) {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 800));
  await Promise.race([waitForFinal, timeout]);
}
```
- If `complete` arrives before `message_final`, we wait up to 800ms
- But `message_final` may arrive AFTER `complete` processing completes
- The wait happens INSIDE the complete handler, so we're waiting for something that hasn't been emitted yet

---

## Proposed Investigation Steps

### 1. Add Logging to Confirm Race Condition
```typescript
// In complete handler:
console.log('[NEW-CHAT] complete received', {
  finalReceived,
  lastFinalEvent: !!lastFinalEvent,
  tempConvEventCount: tempConv?.events.length,
  tempConvEventIds: tempConv?.events.map(e => e.id),
});

// In onMessageFinal:
console.log('[NEW-CHAT] message_final callback', {
  tempConvExists: !!store.conversations[tempConversationId],
  finalEventId: finalEvent.id,
  finalEventSegments: finalEvent.segments.length,
});
```

### 2. Verify Event Content at Each Stage
- After `onMessageFinal`: log the updated temp conversation events
- Before building `realConv`: log `tempConv.events` and `lastFinalEvent`
- After setting `realConv`: log the events in store

### 3. Check Network Timing in Production
- Use browser DevTools to capture SSE event timing
- Compare `message_final` and `complete` event timestamps

---

## Potential Fixes (For Review)

### Fix 1: Wait for message_final Before Route Swap (Recommended)

Gate the route swap on having received `message_final`:
```typescript
// Don't swap route until message_final is received
if (!finalReceived) {
  await Promise.race([waitForFinal, new Promise(resolve => setTimeout(resolve, 2000))]);
}

// Now build real conversation with guaranteed lastFinalEvent
if (lastFinalEvent) {
  // Build with canonical event
} else {
  // Fallback: fetch from API
}
```

### Fix 2: Update Real Conversation When message_final Arrives Late

Modify `onMessageFinal` to also update the real conversation:
```typescript
onMessageFinal: (finalEvent) => {
  // Try temp first
  let conv = store.conversations[tempConversationId];
  if (!conv) {
    // Temp deleted, try real
    conv = store.conversations[realConversationId];
  }
  if (!conv) return;

  // Update whichever exists
  const convId = conv.id;
  const filtered = conv.events.filter(e => e.id !== safeFinal.id && e.id !== assistantPlaceholder.id);
  store.setConversation(convId, { ...conv, events: [...filtered, safeFinal] });
}
```

### Fix 3: Don't Delete Temp Until After message_final

Keep temp conversation in store until we've confirmed the canonical event is committed to real:
```typescript
// In complete handler:
// 1. Wait for message_final
await Promise.race([waitForFinal, timeout]);

// 2. Build real conversation
latestStore.setConversation(realConversationId, realConv);

// 3. Swap route
router.replace(...);

// 4. THEN delete temp (after render has switched to real)
setTimeout(() => latestStore.removeConversation(tempConversationId), 100);
```

### Fix 4: Server-Side Fix - Emit message_final Before complete

Ensure the backend always emits events in order:
```typescript
// In done case:
send({ type: 'message_final', event: currentEvent });  // First
sendSSE(streamingFormat.formatSSE(streamingFormat.done()));  // Second
```

**Current code (route.ts line 1247-1254):**
```typescript
if (currentEvent) {
  send({ type: 'message_final', event: currentEvent });
}
sendSSE(streamingFormat.formatSSE(streamingFormat.done()));
```

This looks correct, but SSE buffering may reorder. Consider flushing between events.

---

## Success Criteria

After fix:
1. Stream content visible during streaming (as before)
2. Route swaps to `/chat/[realId]`
3. Assistant message remains visible with full content
4. "Show Reasoning" button appears if reasoning was present
5. No blank messages in any timing scenario
6. Works consistently in production environment

---

## Related Debug Documents

- `debug/new-chat-show-reasoning-hypotheses.md` - Similar race condition for reasoning segments
- `debug/frontend-rendering-pipeline-overview.md` - Rendering pipeline details
- `debug/multi-turn-streaming-investigation.md` - Multi-turn streaming issues
- `debug/sidebar-flash-during-convo-switch.md` - Related race condition with realtime

---

## Additional Context: Dual-Registry Architecture

### Why Events Look Different During vs After Streaming

The system uses a **dual-registry architecture**:

| Layer | Purpose | Location |
|-------|---------|----------|
| **Zustand Store** | Canonical state, persisted events | `state/eventChatStore.ts` |
| **Draft Registry** | High-frequency streaming updates | `packages/streaming/src/eventBuilderRegistry.ts` |

**During streaming:**
- Tokens accumulate in the **Draft Registry** (`setDraft(eventId, draft)`)
- Leaf components poll the draft via `getDraft(eventId)`
- Store is NOT updated (prevents re-render storms)

**After streaming completes:**
- `message_final` triggers `onMessageFinal` callback
- Callback writes canonical event to Zustand store
- Draft is cleared via `clearDraft(eventId)`

**The Bug Connection:** If `complete` is processed before `message_final`:
1. Real conversation is built from Zustand store (which has placeholder, not streamed content)
2. Draft registry has the actual content but it's not consulted during `realConv` assembly
3. `clearDraft` is called, losing the content
4. `message_final` arrives but temp conversation is gone

### Race Guard Mechanisms (Currently in Place)

```typescript
// Guard 1: activeTempConversation flag
if (state.activeTempConversation) {
  return  // Skip realtime updates during optimistic flow
}

// Guard 2: Event count check for realtime INSERTs
if (existingConversation && existingConversation.events.length > 0) {
  // Only update metadata, preserve events
  return
}
```

These guards prevent realtime from overwriting optimistic data, but they don't address the `message_final` vs `complete` race

---

## Rendering Layer Analysis

### How Streaming Content Gets to the UI

**During Streaming:**
```typescript
// StreamingTextSegment.tsx (lines 21-46)
useEffect(() => {
  if (!isStreaming) return;

  const update = () => {
    const draft = getDraft(eventId);
    const seg = draft?.segments?.find(s => s.type === 'text');
    const next = (baseText || '') + (seg?.text || '');
    setText(prev => prev === next ? prev : next);
  };

  intervalRef.current = setInterval(update, 50);  // Poll every 50ms
  return () => clearInterval(intervalRef.current);
}, [eventId, baseText, isStreaming]);
```

**Critical:** When `isStreaming` becomes `false`, polling stops immediately.

### EventItemSequential Display Logic

```typescript
// EventItemSequential.tsx (line 120)
const isStreamingActive = isAssistant &&
  !!conversation?.isStreaming &&
  conversation?.streamingEventId === event.id;

const displayEvent = isStreamingActive
  ? (getDraft(event.id) || event)  // Use draft during streaming
  : event;                          // Use store event after
```

### Conditional Rendering Switch

```typescript
// SequentialSegmentRenderer.tsx
{isStreaming ? (
  <StreamingTextSegment eventId={event.id} baseText={textContent} isStreaming={true} />
) : (
  textContent && <MarkdownRenderer content={textContent} />  // Only renders if textContent exists
)}
```

### The Rendering Race Condition (Additional to H1)

**H9: Draft Cleared Before Final Render**

In `FrontendEventHandler.ts` line 156:
```typescript
onFinalize: (finalEvent: Event) => {
  clearDraft(placeholder.id);  // ← Draft cleared IMMEDIATELY
  if (this.options.onMessageFinal) {
    this.options.onMessageFinal(finalEvent);
  }
}
```

**Race Sequence:**
1. `message_final` arrives → `clearDraft()` called
2. `StreamingTextSegment` is still polling `getDraft()` every 50ms
3. Next poll: `getDraft()` returns `undefined` → text becomes empty string
4. Component renders blank before `isStreaming` flag updates to `false`
5. When `isStreaming` finally becomes `false`, conditional render switches to `<MarkdownRenderer>`
6. But if the event in store still has empty text segment, nothing renders

**H10: Streaming Flag Race with Content**

```typescript
const isStreamingActive = isAssistant &&
  !!conversation?.isStreaming &&
  conversation?.streamingEventId === event.id;
```

If `isStreaming` flips to `false` BEFORE the final event with content is in the store:
- Component switches from `StreamingTextSegment` (which had content from draft)
- To `MarkdownRenderer` (which reads from store event)
- But store event still has empty placeholder segments

### Empty Content Filtering

Both text renderers filter empty content:

```typescript
// TextSegment.tsx lines 22-25
if (!segment.text || !segment.text.trim()) {
  return null;  // Renders nothing
}

// StreamingTextSegment.tsx lines 48-50
if (!text || !text.trim()) return null;
```

If the final event's text segment is empty, nothing renders.

---

## Appendix: Key Code Locations

### Temp Conversation Creation
`page.tsx` lines 302-314

### message_final Handling
`page.tsx` lines 346-365

### Complete Handler / Real Conversation Assembly
`page.tsx` lines 398-467

### Store setConversation
`eventChatStore.ts` lines 129-143

### Realtime INSERT Handler
`eventChatStore.ts` lines 380-463

### EventList Event Resolution
`EventList/index.tsx` lines 36-40
