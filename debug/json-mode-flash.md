# JSON Mode Flash on Conversation Switch

## What we’re observing
- Toggling JSON mode on, then navigating to another conversation, briefly shows the JSON inspector before falling back to the normal chat view.
- After a split second the UI reverts to the expected non-JSON layout.

## Why it happens
1. `EventStream` keeps `jsonMode` in component state (`useState(false)`), reset only when the component remounts. Switching between conversations reuses the same `EventStream` instance while new props stream in, so `jsonMode` stays `true` until the component decides otherwise.
2. At the moment the user picks a different conversation, `resolvedConversation` still points to the previous conversation because the store hasn’t populated the new events yet (the loader is showing and/or `events` is still the old array).
3. The `showJsonMode` guard (`jsonMode && !!resolvedConversation`) therefore remains `true`, so the JSON view renders briefly, even though the new conversation hasn’t finished loading. Once the new events arrive (or the loader kicks in), `resolvedConversation` updates, triggering a re-render that disables JSON mode or shows the correct content.

## Possible approaches
- **Reset `jsonMode` when the conversation ID changes**: track `conversationId` in a `useEffect` and call `setJsonMode(false)` whenever it changes. This keeps JSON mode per-conversation without re-mounting `EventStream`.
- **Gate JSON view on matching conversation**: store the `conversationId` that toggled JSON mode and render JSON only if it equals the active conversation ID; switching immediately shows the regular UI until the user re-enables JSON mode.
- **Conditional render during loading**: hide JSON mode while the new conversation is loading (e.g., when `resolvedConversation?.id !== conversationId` or `events` is undefined), preventing the stale JSON view from flashing.

Each option preserves fast conversation switching while eliminating the visual flicker.
