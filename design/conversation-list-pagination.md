# Conversation List Pagination (Infinite Scroll)

## Context
- Current sidebar conversation list loads all conversations for a workspace via `GET /api/conversations?workspace_id=...` and stores them in `eventChatStore` using `setConversationSummaries` and `setWorkspaceConversations` in `components/Sidebar/ConversationList.tsx`.
- Realtime updates are centrally managed in `eventChatStore.subscribeToWorkspace()` and wired up by `app/(chat)/layout.tsx`.
- This does not scale for large workspaces and can feel sluggish. We want infinite scroll pagination that incrementally loads older conversations.

## Goals
- Add keyset-style pagination for conversations ordered by `created_at DESC`.
- Implement infinite scrolling in the sidebar list with minimal, localized changes.
- Preserve realtime behavior (new/updated/deleted conversations) without duplication.
- Avoid schema changes and keep API consistent with existing patterns.

## Non‑Goals
- Refactoring global state shape or removing existing actions.
- Changing sidebar layout or ScrollArea component structure.
- Implementing total counts or server-driven caching.

## API Changes: `GET /api/conversations`
- Add optional query params:
  - `workspace_id` (string, required): unchanged.
  - `limit` (number, optional): page size. Default `30`. Max `100`.
  - `cursor` (string, optional): ISO timestamp of the last item from the previous page; returns items with `created_at < cursor`.
- Response shape (aligned with list pattern, plus paging fields):
  - `{ items: Conversation[], has_more: boolean, next_cursor?: string }`
  - `items` contain the same augmented fields we currently return (effective assistant name/avatar, etc.).
  - `next_cursor` is the `created_at` of the last item in this page when `has_more === true`.

Implementation notes:
- Base query: filter by `workspace_id`, join for bud defaults, order by `created_at DESC`.
- If `cursor` provided, add `.lt('created_at', cursor)` (keyset pagination).
- Compute `has_more` by fetching `limit + 1` rows; if we get `> limit`, pop the extra and set `has_more=true`.
- Keep current identity resolution (effective name/avatar) intact.
- Tiebreakers: In practice, `created_at` collisions are rare. If we later need strict determinism, we can add a secondary `id DESC` order and an `or()` filter to emulate `(created_at < cursor) OR (created_at = cursor AND id < last_id)`. For now, we keep the simpler single-key cursor.

## Client Changes: `components/Sidebar/ConversationList.tsx`
- Initial load:
  - Call `GET /api/conversations?workspace_id=...&limit=30`.
  - Use existing behavior to seed store for the first page:
    - `setConversationSummaries(summaries)` once.
    - `setWorkspaceConversations(workspaceId, ids)` once.
  - Track `nextCursor` and `hasMore` in local component state.
- Load more pages on scroll:
  - When near the bottom, call `GET /api/conversations?workspace_id=...&limit=30&cursor=<nextCursor>`.
  - For each returned item:
    - Upsert summary via `setConversationSummary(id, summary)` (do not clear the map).
  - Append IDs to the workspace list via `setWorkspaceConversations(workspaceId, [...existingIds, ...newIds])` after de‑duping.
  - Update `nextCursor` and `hasMore` from the response.
- Scroll detection:
  - The list lives inside `ScrollArea` provided by the parent Sidebar. IntersectionObserver with the window viewport won’t trigger on the nested scroll.
  - Use a lightweight onScroll approach: attach a scroll listener to the closest `[data-radix-scroll-area-viewport]` element (ancestor of the list) and trigger load‑more when `scrollTop + clientHeight >= scrollHeight - threshold`.
  - Include a small `threshold` (e.g., 200px) and debounce to avoid thrashing.
- UI states:
  - Show a tiny spinner row at the end when `isFetchingMore`.
  - If `!hasMore`, show a subtle “All caught up” footer.
  - Keep empty state unchanged when the workspace has zero conversations.
- Workspace changes:
  - Reset component pagination state (`nextCursor`, `hasMore`, `isFetching`) when `workspaceId` changes.
  - Existing store data is left intact; the component will re‑seed if needed (as it does today), then continue pagination.

## Realtime Interplay
- INSERT: The existing subscription will `unshift` new conversation IDs via `addConversationToWorkspace`. Our pagination logic de‑dupes when appending older pages, so duplicates are avoided.
- UPDATE: Title/metadata updates are already propagated to both full conversations and summaries. The list reflects updates regardless of pagination state.
- DELETE: `removeConversationFromWorkspace` will remove entries from the loaded subset if present; no special handling needed.

## Edge Cases
- Rapidly switching workspaces: reset pagination flags to prevent cross‑workspace fetches.
- Network errors while loading more: surface a small retry affordance or a console error; do not break already‑loaded items.
- Bud preloading on hover remains unchanged and continues to hydrate full conversations opportunistically.

## Testing Plan
- Seed >60 conversations and verify:
  - First page renders quickly with ~30 items.
  - Scrolling near bottom fetches the next page and appends items.
  - Realtime insert while on page 1 shows a new item at the top without duplication.
  - Delete an item present in the list removes it.
  - Switch workspaces and verify pagination resets.
- Verify that preloading full conversations on hover still works for both initially loaded and paginated items.

## Rollout
- Server: Implement `limit`/`cursor` support, defaulting to `limit=30` when provided. If no `limit` is provided (legacy callers), return the full list to maintain backwards compatibility until all callers migrate.
- Client: Update `ConversationList` to pass `limit` and handle paging, preserving existing behavior for the first page and introducing scroll‑based fetching for subsequent pages.

## Future Enhancements
- Add secondary key tiebreaker (`id`) for strict cursor semantics.
- Expose total counts if needed (separate endpoint or header).
- Provide an explicit “Load more” button as an a11y fallback when IntersectionObserver/onScroll isn’t reliable.
