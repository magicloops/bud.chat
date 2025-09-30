# Sidebar Flash During Conversation Creation

## What We Observed
- When finishing the `/chat/new` streaming flow, the sidebar briefly shows **two** conversation rows: the optimistic temp conversation and the newly created server conversation.
- The flash disappears once the deferred cleanup runs, but it is visible long enough to feel like a glitch.

## Current Flow Recap
1. **Optimistic temp conversation**
   - `app/(chat)/chat/[conversationId]/page.tsx:190-237` writes a temp conversation (`tempConversationId`) into the store and calls `addConversationToWorkspace` so it appears immediately in the sidebar.
   - We now stamp the temp conversation meta with the Bud avatar/name, so the UI looks correct from the start.
2. **Streaming response handling**
   - The SSE handler receives `conversationCreated` and calls `addConversationToWorkspace(selectedWorkspace, realConversationId)` (page.tsx ~line 331) before the stream finishes.
   - On `complete`, we call `setConversation(realConversationId, realConv)` and then schedule `removeConversation(tempConversationId)` inside `setTimeout(..., 0)` (page.tsx 420-436). Until that timeout executes, both IDs coexist in `workspaceConversations`.
3. **Supabase realtime INSERT**
   - Around the same time, `subscribeToWorkspace` (`state/eventChatStore.ts:369-432`) processes the `INSERT` for the new conversation. Because `activeTempConversation` is `undefined` for the `/chat/new` path, the handler writes the new conversation and ensures its ID is present in `workspaceConversations`.

## Suspected Race Condition
- The optimistic path adds the real ID to `workspaceConversations` **before** the temp entry has been removed, so the list momentarily contains `[tempId, realId]`.
- The zero-timeout removal competes with the realtime handler, which may run slightly later and append/normalize the list, extending the window where both IDs are present.
- Result: the sidebar renders both rows for a single paint frame, causing the visible flash.

## Opportunities to Fix
1. **Swap IDs in place** when the SSE `complete` fires:
   - Instead of `addConversationToWorkspace(realId)` + `setTimeout` cleanup, replace the temp ID with the real ID synchronously (similar to the branching flow’s logic in `components/EventList/index.tsx:317-335`).
   - Remove the temp summary immediately after swapping to avoid duplicate renders.
2. **Gate realtime INSERT** while the temp conversation is active:
   - Reuse `activeTempConversation` (currently only set in branching) for the `/chat/new` flow so the realtime handler ignores the insert until the optimistic path has already swapped IDs.
   - Afterwards, clear the flag so subsequent updates still flow through.
3. **Defer `addConversationToWorkspace(realId)`** until after the temp entry has been removed (or combine the operations inside the same `setState` call) so the array never contains both IDs simultaneously.

Documenting this helps us decide whether to address the flash in the optimistic swap logic, the realtime handler, or both.
