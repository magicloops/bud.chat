# Optimistic Conversation Selection Bug

## Symptom
- During `/chat/new`, after sending the first message we create an optimistic conversation (`tempConversationId`) in the store and swap the UI to `/chat/new?bud=…`.
- The sidebar renders the temp conversation (with the Bud avatar) but the row is not marked as selected (no highlight) until the conversation is persisted and the route switches to `/chat/<real-id>`.

## Expected
- As soon as we optimistically show the conversation in the sidebar, it should appear as the active entry so the selection highlight remains consistent throughout the flow.

## Current Selection Logic Recap
- The list computes `currentConversationId` by parsing `pathname` (`ConversationList.tsx:145-152`).
- Highlighting checks `currentConversationId === conversationMeta.id` (`ConversationList.tsx:356-358`).
- When we’re on `/chat/new`, `currentConversationId` resolves to `"new"`.
- The optimistic sidebar entry uses `tempConversationId` (a UUID) as its ID (`app/(chat)/chat/[conversationId]/page.tsx:203, 232, 263`).

## Why Selection Breaks
- The temp entry’s ID never matches the parsed pathname (which stays as `new` until the real conversation exists). The sidebar therefore has no row whose ID equals the current route, so nothing is highlighted.
- Once the real conversation ID is available and we replace the URL (`router.replace('/chat/<id>')`), the sidebar selection logic sees the matching ID and the highlight appears.

## Potential Fixes
1. **Special-case the /chat/new route** in `ConversationList`:
   - If `currentConversationId` is `"new"`, derive the “selected” ID from the store (e.g., `store.activeTempConversation` or the first temp conversation in `workspaceConversations`) and use it for comparisons.
2. **Update the URL earlier** (swap from `/chat/new` to `/chat/<temp-id>` when we create the optimistic conversation), then later replace it with the real ID. This keeps the sidebar logic unchanged but changes the address bar mid-stream, which may have UX implications (back button history, etc.).
3. **Track selected conversation in state** (e.g., `useEventChatStore.ui.selectedConversationId`) instead of relying solely on the route. The route could still sync the selection for deep links, while optimistic flows update the store property directly.

Recording these options helps us decide which path keeps the UX snappy without introducing brittle routing hacks.
