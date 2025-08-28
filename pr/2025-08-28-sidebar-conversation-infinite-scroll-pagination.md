# Sidebar Conversation Infinite Scroll Pagination

## Summary
Implements keyset‑paginated loading for the workspace conversation list and infinite scrolling in the sidebar. Reduces initial payloads for large workspaces, keeps the list responsive, and remains compatible with existing callers.

## Problem
The sidebar fetched all conversations for a workspace in a single call (`/api/conversations?workspace_id=...`). For users with many conversations this was slow, memory‑heavy, and degraded UX.

## Changes
- API: Add optional `limit` and `cursor` parameters to `GET /api/conversations` and return a paginated shape when `limit` is present.
- Client: Update `ConversationList` to request the first page and fetch more on scroll, appending older conversations.
- Realtime: Preserve existing Supabase subscription behavior for inserts/updates/deletes without duplication.

## API Contract
- Endpoint: `GET /api/conversations?workspace_id=<id>&limit=<n>&cursor=<iso>`
- Ordering: `created_at DESC` with keyset pagination (`created_at < cursor`).
- When `limit` is provided, response is:
  - `{ items: Conversation[], has_more: boolean, next_cursor?: string }`
- When `limit` is omitted, response remains the legacy full array for backward compatibility.

## Client Updates
- `ConversationList.tsx`
  - Initial load with `limit=30` seeds store summaries + workspace id list.
  - Tracks `hasMore` and `nextCursor` from server; on scroll near bottom, fetches next page.
  - Upserts summaries via `setConversationSummary` and appends ids de‑duplicated.
  - Scroll detection attaches to the Radix ScrollArea viewport; small debounce and threshold used.
  - Shows a tiny footer status: “Loading more…” or “All caught up”.

## Backward Compatibility
- Server keeps legacy response when `limit` is absent (older callers unaffected).
- Client handles both shapes (array or paginated object) defensively.

## Files Touched
- app/api/conversations/route.ts
- components/Sidebar/ConversationList.tsx
- design/conversation-list-pagination.md (design doc)

## How to Test
1. Seed >60 conversations in a workspace.
2. Open the app; confirm the first ~30 load quickly.
3. Scroll to near the bottom of the sidebar conversation list; verify more conversations append.
4. Create a new conversation; verify it appears at the top without duplicates.
5. Delete a conversation; verify it disappears from the list.
6. Switch workspaces; pagination state resets and initial page loads.

## Performance & Concurrency
- Keyset pagination avoids OFFSET and scales well with large tables.
- Realtime inserts use existing `unshift` logic; dedupe prevents duplication with later pages.

## Risk & Rollback
- Low risk: server maintains legacy behavior when `limit` not used.
- Rollback: revert client changes to `ConversationList` and stop passing `limit`/`cursor`; server will continue to return full arrays.

## Follow-ups (Optional)
- Add secondary tiebreaker (`id DESC`) to the cursor if strict determinism is required.
- Consider an a11y “Load more” button as a fallback to scroll detection.
