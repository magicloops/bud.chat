# New Conversation Avatar Mismatch

## Observed Behaviour
- Starting a chat from a Bud produces the correct assistant avatar in the chat view, but the newly created conversation in the sidebar momentarily shows the default `🤖` avatar until a full page refresh.
- After refreshing (or returning later), the sidebar renders the Bud-specific emoji/image as expected.
- While experimenting with fixes we confirmed the sidebar can briefly list **two** conversations during `/chat/new`: the optimistic temp conversation (`temp-…`) and the eventual server conversation ID. When the backend response lands we swap routes and remove the temp entry, but the summary we created for the temp conversation retains the fallback avatar.

## What We Found
- Sidebar items read from `conversationSummaries` in `state/eventChatStore`. When the new conversation arrives over Supabase realtime (`eventType === 'INSERT'`), the store writes `assistant_avatar` directly from the payload (see `state/eventChatStore.ts:369-432`).
- Conversations seeded from a Bud do **not** persist a custom avatar in the `conversations.assistant_avatar` column unless the user overrides it; instead they inherit the Bud’s avatar. The realtime payload therefore carries `assistant_avatar: null`.
- With `assistant_avatar` missing, `ConversationList.tsx:373-376` falls back to `'🤖'`, which explains the generic icon immediately after creation.
- On refresh we fetch `/api/conversations`, whose handler populates `effective_assistant_avatar` by joining the Bud table (`app/api/conversations/route.ts:105-126`). The sidebar loader (`ConversationList.tsx:129-137`) uses this effective value, so the avatar is fixed after reload.
- During the `/chat/new` flow we create a **temporary conversation** in the store (`app/(chat)/chat/[conversationId]/page.tsx:190-270`). We intentionally omit `assistant_name`/`assistant_avatar` so the main chat view can derive identity from the Bud. However, `setConversation` auto-syncs this meta into `conversationSummaries`, so the sidebar immediately stores a summary with no avatar and thus renders the default emoji.
- When the streaming handler receives `conversationCreated`, we call `addConversationToWorkspace(selectedWorkspace, realConversationId)` before removing the temp conversation (`page.tsx:200-340`). This is why two entries appear briefly. Cleanup happens via `removeConversation(tempConversationId)` inside a zero-timeout, but the summary for the temp conversation lingers until deletion, so the fallback avatar remains visible during the swap.

## Hypotheses / Potential Fixes
1. **For temp conversations**, enrich the summary immediately after `setConversation(tempConversationId, …)` using the available Bud config (e.g., `getBudAvatar`). That keeps the optimistic entry visually consistent without waiting for realtime.
2. For the server-created conversation, **delay sidebar hydration until we have Bud metadata**. Options: (a) inject `effective_assistant_avatar` into the SSE `conversationCreated` payload, or (b) have the realtime handler fall back to the Bud store after the temp conversation has been removed.
3. Alternatively, **trigger a one-off fetch** of `/api/conversations/{id}` after an `INSERT` with a null avatar to hydrate `effective_assistant_avatar`, though this adds network churn compared with local lookup.

Either approach would keep the optimistic creation flow intact while ensuring the sidebar immediately reflects the Bud’s identity.
