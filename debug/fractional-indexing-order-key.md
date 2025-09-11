# Fractional Indexing: `order_key` Debug Notes

## Summary
- Symptom: Once an `order_key` reaches the boundary around `aZ`, the app can no longer add events reliably.
- Likely root cause: Database collation for `text` ordering does not match the bytewise/ASCII ordering that the `fractional-indexing` algorithm assumes. When keys pass from `aZ` to `aa`, the DB’s sort order can return the wrong “last” key, causing repeated key generation (duplicates) or mis-ordered inserts. Missing uniqueness on `(conversation_id, order_key)` for `events` hides this until behavior breaks downstream.

## Where `order_key` Is Generated/Used

- `@budchat/data`
  - `saveEvent(supabase, event, { conversationId, orderKey? })`: If no `orderKey` provided, fetches last `order_key` for the conversation (order by `order_key` desc) and uses `generateKeyBetween(last, null)`.
  - `saveEvents(supabase, events, conversationId)`: Batch path; fetches last `order_key` (desc) then iteratively calls `generateKeyBetween(last, null)` for each new event.
  - `getConversationEvents(supabase, conversationId)`: Reads and sorts by `order_key` ascending.

- `app/api/chat/route.ts`
  - Helper `saveEvents(...)`: Carries a running `orderKey`, repeatedly calls `generateKeyBetween(orderKey, null)` when saving multiple new events during a request.
  - In “continue” flow, it fetches the last event via `order('order_key', { ascending: false })` to seed the next key.

- `app/api/conversations/route.ts`
  - On conversation create, seeds with a system event at `orderKey: 'a0'` when provided.
  - For optional `initialMessages`, uses `generateKeyBetween(lastOrderKey, null)` where `lastOrderKey` starts as `'a0'` if there was a system prompt, otherwise it is `undefined` (should be `null`).

- `app/api/conversations/[id]/branch/route.ts`
  - Copies existing `events` into a new conversation, preserving the original `order_key` values.

- Types
  - `lib/types/events.ts`: `DatabaseEvent` includes `order_key: string`.

- Migrations / DB
  - `supabase/migrations/20250714000001_create_events_table.sql`
    - `order_key text NOT NULL;`
    - Indexes on `order_key` and `(conversation_id, order_key)` for ordering; no uniqueness constraint.
  - Older migration (`20250603000001_migrate_to_fractional_indexing.sql`) shows the previous `messages` table used `UNIQUE (conversation_id, order_key)`.

## Why `aZ` Is a Problem Boundary
`fractional-indexing` (v3.2.0) generates lexicographically sortable keys over an alphabet in ASCII order (e.g., `0-9`, `A-Z`, `a-z`). The algorithm assumes comparisons use bytewise/ASCII ordering. Around `aZ → aa` the case boundary is crossed (uppercase to lowercase). In many DB collations (non-"C" locales or case-insensitive collations), ordering can differ from ASCII:

- DB may consider `Z` and `z` equal or order them differently.
- As a result, `ORDER BY order_key DESC LIMIT 1` may keep returning `aZ` even after inserting `aa`.
- Then `generateKeyBetween('aZ', null)` keeps producing the same next key (e.g., `aa`), causing duplicates and eventual downstream failures or apparent inability to add messages.

Because the `events` table lacks a uniqueness constraint on `(conversation_id, order_key)`, this can silently insert duplicate keys and break ordering/sequencing elsewhere (UI stream, next-key computation, etc.).

## Additional Findings
- `app/api/conversations/route.ts` sometimes passes `undefined` as the left bound to `generateKeyBetween`. The library expects `string | null`. Passing `undefined` can yield unexpected behavior in some runtimes. Use `null` instead.
- Seeding with a literal `'a0'` is fine, but relying on DB sort semantics to discover the “last” key only works if the column’s collation is bytewise/ASCII.

## Recommendations (Minimal, Targeted)

1) Enforce ASCII/Binary Collation for `order_key`
- Change the column to a deterministic binary/ASCII collation so Postgres sorts keys exactly as `fractional-indexing` intends.
- Example migration (Postgres):
  - Alter column: `ALTER TABLE public.events ALTER COLUMN order_key TYPE text COLLATE "C";`
  - Recreate indexes on `order_key` and `(conversation_id, order_key)` to ensure they use the same collation.
- If altering the column collations isn’t feasible, add a computed column with `COLLATE "C"` and use that for ordering (requires query changes).

2) Add Uniqueness Constraint
- Add `UNIQUE (conversation_id, order_key)` back to `events` as in the previous `messages` table. This will surface any duplicate-generation bugs immediately rather than failing later.

3) Normalize `generateKeyBetween` Inputs
- Always pass `null` (not `undefined`) when no left bound exists. Fix in `app/api/conversations/route.ts` where `lastOrderKey` defaults to `undefined`.

4) Optional Guardrails
- Consider adding a small wrapper for key generation that:
  - Normalizes inputs (`undefined` → `null`).
  - Catches and logs collisions, and in the rare case of duplicate detection, retries with the newly fetched last key.

## Quick Checklist of Code Paths Affected
- Append new events:
  - `@budchat/data` → `saveEvent`, `saveEvents`
  - `app/api/chat/route.ts` → `saveEvents`, continue flow last-key lookup
- Conversation creation:
  - `app/api/conversations/route.ts` → seeds `'a0'`, then generates subsequent keys
- Branching:
  - `app/api/conversations/[id]/branch/route.ts` → copies existing `order_key`s (safe after collation fix)

## Suggested Tests (Local)
- Create a conversation and append messages until keys pass `aZ`.
- Verify the last-key query returns the true maximum key after crossing into lowercase (e.g., it should return `aa`, `ab`, ... not `aZ`).
- Attempt rapid consecutive inserts to ensure uniqueness and monotonic ordering hold.

## Bottom Line
Fractional indexing depends on bytewise ordering. With `text` under a non-"C" collation, ordering around `aZ/aa` breaks. Enforce binary collation for `order_key` and add uniqueness on `(conversation_id, order_key)` to make key generation robust and failures visible.
