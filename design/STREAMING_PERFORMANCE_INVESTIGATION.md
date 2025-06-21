# Streaming Performance Investigation

## Problem Statement
Streaming feels slow and unresponsive. Should feel snappy with sub-100ms time to first token and smooth character-by-character updates.

## Investigation Hypotheses

### 🔍 **Hypothesis 1: React Re-render Storm** ⚠️ HIGH PRIORITY
**Issue**: Every token update triggers a full React re-render of the entire message list.

**Evidence**: 
- Line 98-104 in `/new/page.tsx`: `setMessages(prevMessages => prevMessages.map(...))` 
- This creates a new array on every token, causing all messages to re-render
- MessageList depends on `displayMessages` which changes on every character

**Impact**: High - Could cause 50+ re-renders per second during streaming

**Test Plan**: Use React DevTools Profiler to measure re-render frequency

---

### 🔍 **Hypothesis 2: Database Operations Blocking Token Flow**
**Issue**: Database writes might be creating backpressure on the stream.

**Evidence**:
- Line 202: `createConversationInBackground()` runs in parallel but still needs DB writes
- Line 225-230: `Promise.race` with timeout=0 might be checking DB status too frequently  
- Background conversation creation + message insertion could compete for DB connections

**Impact**: Medium - Could delay chunks by 100-500ms

**Test Plan**: Add timing logs around database operations in server streaming

---

### 🔍 **Hypothesis 3: Client-Side Stream Processing Overhead**  
**Issue**: Client stream parsing and state updates are synchronous and blocking.

**Evidence**:
- Line 82-88: `chunk.split('\n')` and `JSON.parse()` run on main thread
- Line 98-104: Complex state update with array mapping
- No batching - every single token processes immediately

**Impact**: Medium - Could add 10-50ms per token

**Test Plan**: Add performance.now() timers around stream processing

---

### 🔍 **Hypothesis 4: Auto-Scroll Thrashing**
**Issue**: Scroll position updates every 100ms regardless of content changes.

**Evidence**:
- Line 78-80: `setInterval(() => scrollToBottom(), 100)` 
- This runs constantly during streaming even if no new tokens arrive
- `scrollToBottom()` forces DOM layout calculations

**Impact**: Low-Medium - Could cause visual jank and CPU usage

**Test Plan**: Monitor scroll performance and frequency

---

### 🔍 **Hypothesis 5: Network/SSE Buffering** ⚠️ HIGH PRIORITY
**Issue**: Server-Sent Events might be getting buffered by browser or network.

**Evidence**:
- Using ReadableStream instead of native EventSource
- No explicit flush instructions to prevent buffering
- Browser might batch small chunks for efficiency

**Impact**: High - Could cause 200-1000ms delays in token delivery

**Test Plan**: Check Network tab timing, compare with EventSource implementation

---

## Investigation Order

1. **Performance Timers** - Add comprehensive timing measurements
2. **React DevTools Profiler** - Measure re-render frequency during streaming  
3. **Network Timing Analysis** - Monitor browser DevTools Network tab
4. **Server Database Timing** - Check DB operation timing in server logs

## Expected Outcomes

- **Time to First Token**: < 200ms
- **Token Frequency**: 20-50 tokens/second
- **React Re-renders**: < 5 re-renders/second during streaming
- **Client Processing**: < 5ms per token
- **Network Latency**: < 50ms per chunk

## Files to Investigate

- `/app/api/chat-new/route.ts` - Server streaming implementation
- `/app/(chat)/new/page.tsx` - Client streaming handling  
- `/components/NewMessageList/index.tsx` - Message rendering and scroll
- `/components/NewChatArea/index.tsx` - Chat area container

## Next Steps

1. [ ] Add performance timing instrumentation
2. [ ] Test with React DevTools Profiler
3. [ ] Analyze network timing patterns
4. [ ] Optimize based on findings
5. [ ] Re-test and measure improvements