# Streaming UI Architecture: React-Friendly, Fast, and Stable

This doc outlines the problem we’re seeing with streaming chat updates, why it’s happening in the new app, and a React-friendly architecture that updates only the last message while keeping streaming fast and correct (markdown, code blocks, etc.).

## Problem
- Runtime error: “Maximum update depth exceeded” during streaming.
- Rendering updates are tied to parent-level state that changes per token, causing re-renders of the whole list and effect churn.
- We only want the last message to re-render (or even better: only the last message’s text segment), and we want streaming to feel instant.

## Likely Root Causes (New App)
- Per-token state updates in a parent component (e.g., `EventStream` or page) via intervals or per-token `setState`, causing:
  - Re-creation of effects and intervals in Strict Effects (React 18/19 + Next 15) dev mode.
  - Re-renders of the full conversation list.
  - Event-handler closures capturing stale state/flags, contributing to loops.
- Using arrays as state for streaming where each token update creates a new array/object tree, invalidating memoization and causing broad re-renders.
- Strict Mode double-invokes effects in dev, amplifying any state/effect coupling.

## Principles for a Robust Streaming UI
- Isolate updates to the smallest component that changes (the streaming message item).
- Keep parent structures stable (array and non-changing items should keep the same reference).
- Use memoization and structural sharing so only the last message object changes.
- Buffer token deltas outside React render (refs or external store), and flush at the leaf.
- Prefer `requestAnimationFrame` or a small scheduler over `setInterval` to reduce contention.
- Avoid `setState` inside effects whose dependencies change on every render; effects should be stable and cleanup properly.

## Recommended Architecture

### 1) Component Structure
- `EventList` renders a list of `EventItem`s.
- `EventItem` is `React.memo` and keyed by `event.id`.
- The “streaming last message” uses a specialized `StreamingMessage` subcomponent responsible only for its text/segments.

Result: When streaming, only `StreamingMessage` re-renders; all other `EventItem`s remain memoized.

### 2) State Flow
Two viable patterns (choose one):

A. Store-Only, Structural Sharing
- Keep conversation events in the global store (Zustand).
- For streaming, only update the last message object’s text segment (new object), keep the array and all previous items as the same references.
- Selective subscription in components (Zustand selectors with shallow compare) so that only `StreamingMessage` subscribes to the last message content.

B. Local Buffer + Leaf Flush (External Store / Ref)
- Maintain a per-message token buffer in a ref or an external tiny event-bus/store keyed by `messageId`.
- `StreamingMessage` subscribes via `useSyncExternalStore` or a small custom subscribe function and re-renders on buffer changes.
- Parent list never updates per token; only the leaf component does.

Pattern A is simpler if we can ensure structural sharing; Pattern B is safest if we want to avoid touching the global store per token.

### 3) Rendering and Performance
- Use `requestAnimationFrame` (rAF) to flush buffer → setState in `StreamingMessage` at most once per frame (typically ~60fps) for smoothness; fall back to micro-debounce (e.g., 16–33ms) if needed.
- Parse markdown incrementally:
  - Keep a lightweight renderer that can handle incomplete code fences.
  - Strategy: render as text until backticks are balanced, then re-render the block with code highlighting.
  - Memoize parse results for the current accumulated text.
- Avoid creating new arrays/objects for non-changing items.

### 4) Strict Mode and Effects
- Avoid starting intervals/timers in parent components that also modify state used as effect deps.
- Use a single effect in `StreamingMessage` to manage rAF flush and clean up on unmount.
- Ensure effects don’t depend on objects/functions that change per render.

## Implementation Sketches

### A) Store-Only, Structural Sharing
```tsx
// eventChatStore.ts (Zustand)
// Ensure setConversation performs structural sharing: only last event object changes
setLastEventText(conversationId, eventId, delta) {
  set(state => {
    const conv = state.conversations[conversationId];
    if (!conv) return {};
    const events = conv.events;
    const idx = events.findIndex(e => e.id === eventId);
    if (idx < 0) return {};
    const prev = events[idx];
    const next = {
      ...prev,
      segments: prev.segments.map((s, i) => i === textIndex ? { ...s, text: s.text + delta } : s)
    };
    // Structural sharing: same array ref, but replace one element
    const nextEvents = [...events];
    nextEvents[idx] = next;
    return { conversations: { ...state.conversations, [conversationId]: { ...conv, events: nextEvents } } };
  });
}
```
```tsx
// EventList.tsx
const EventList = memo(({ conversationId }) => {
  const eventIds = useEventChatStore(s => s.conversations[conversationId]?.events.map(e => e.id), shallow);
  return (
    <div>{eventIds?.map(id => <EventItem key={id} id={id} />)}</div>
  );
});

// EventItem.tsx
const EventItem = memo(({ id }) => {
  const event = useEventChatStore(s => selectEventById(s, id), shallow);
  return event.streaming ? <StreamingMessage event={event} /> : <Message event={event} />;
});
```

### B) External Buffer + Leaf Flush
```tsx
// streamingBus.ts
class StreamingBus {
  private subs = new Map<string, Set<() => void>>();
  private buffers = new Map<string, string>();
  subscribe(id: string, cb: () => void) { /* add/remove */ }
  append(id: string, delta: string) { this.buffers.set(id, (this.buffers.get(id)||'') + delta); this.emit(id); }
  get(id: string) { return this.buffers.get(id) || ''; }
}
export const streamingBus = new StreamingBus();
```
```tsx
// StreamingMessage.tsx
function StreamingMessage({ event }) {
  const [text, setText] = useState(streamingBus.get(event.id));
  useEffect(() => {
    let raf = 0;
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setText(streamingBus.get(event.id))); };
    const unsub = streamingBus.subscribe(event.id, onChange);
    return () => { unsub(); cancelAnimationFrame(raf); };
  }, [event.id]);
  // render markdown from `text`
}
```
```ts
// FrontendEventHandler
// On token: streamingBus.append(assistantPlaceholder.id, data.content)
```

### Markdown and Code Rendering
- Use a tolerant renderer for incomplete markdown during streaming.
- Option: render as plain text until triple backticks close, then parse to markdown for that section.
- Keep syntax highlighting lazy to avoid heavy re-parses per frame.

## Why the Old App Worked and the New One Doesn’t
- The old app likely updated a leaf component or did structural sharing correctly.
- The new app introduced parent-level intervals/state changes (and possibly Strict Mode effect double-invoke), causing cascades.
- Using arrays/objects as state at the parent level per token invalidated memoization and caused list-wide re-renders.

## Proposed Plan (Incremental)
1. Split Event rendering so each message is its own memoized component; the list only maps ids.
2. Choose Pattern A (store-only with structural sharing) or Pattern B (external bus at the leaf). Prefer A if we can ensure selective subscription; B if we want to minimize store writes during streaming.
3. Update FrontendEventHandler to target only the last message’s content update:
   - A: call `setLastEventText(conversationId, eventId, delta)`.
   - B: call `streamingBus.append(eventId, delta)`.
4. Remove parent-level per-token state updates and any intervals in `EventStream`/page.
5. Add StreamingMessage leaf component with rAF flush and markdown renderer tuned for partial text.
6. Verify in dev (Strict Mode) and prod; ensure effects are stable and cleanup properly.

## Edge Cases / Notes
- Completion: finalize content and replace streaming buffer with final message text; stop rAF.
- Errors: clear buffer and revert optimistic placeholder.
- Navigation: ensure unmount cleanup cancels rAF/subscriptions.
- Performance: cap rAF work; parse only changed regions when possible.

## Success Criteria
- No max update-depth errors in strict/dev.
- Only last message re-renders during streaming.
- Streaming feels instant and renders correctly (including code blocks) as content stabilizes.
- Minimal extra GC/allocations under load.

