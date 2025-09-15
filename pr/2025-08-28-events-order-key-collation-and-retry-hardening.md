# Fix fractional indexing at aZ boundary; enforce ASCII collation, uniqueness, and add concurrent-append retry

## Summary
- Fixes broken appends when `order_key` crosses the `aZ → aa` boundary by aligning DB sort semantics with the `fractional-indexing` algorithm and hardening concurrent writes.
- Enforces ASCII/bytewise sorting via `COLLATE "C"`, adds a uniqueness constraint on `(conversation_id, order_key)`, de‑duplicates existing collisions, and adds retry-on-conflict logic where events are saved.
- Also normalizes `undefined` → `null` when generating keys.

## Problem
- We observed conversation appends failing once keys reached around `aZ`.
- Root cause: Postgres text collation didn’t match ASCII/bytewise ordering that `fractional-indexing` assumes. Around case boundaries (`aZ → aa`), `ORDER BY order_key` could return the wrong “last” key, leading to repeated key generation and duplicate `order_key` values.
- Because `events` did not enforce uniqueness on `(conversation_id, order_key)`, duplicates could be silently inserted, breaking sequencing downstream.

## Changes
- Database
  - Add migration `202508280001_adjust_events_order_key_collation.sql`:
    - Set `events.order_key` to `COLLATE "C"` (ASCII/bytewise).
    - Drop/recreate indexes on `order_key` and `(conversation_id, order_key)` so they use the new collation.
    - De‑duplicate existing `(conversation_id, order_key)` collisions by appending one or more `'0'` characters to later duplicates.
    - Add `UNIQUE (conversation_id, order_key)` constraint.
- Server code
  - `@budchat/data`:
    - `saveEvent` and `saveEvents`: Detect unique-violation (SQLSTATE `23505`). On conflict, refetch latest `order_key`, regenerate with `generateKeyBetween(last, null)`, and retry once. Batch insert falls back to per-item with retry.
    - Normalize missing left bound to `null` when generating keys.
  - `app/api/chat/route.ts`:
    - Save helper mirrors the above retry-on-conflict behavior and normalizes the previous key to `null`.
  - `app/api/conversations/route.ts`:
    - Normalize `lastOrderKey` seed to `null` (not `undefined`) when generating initial keys.
- Docs
  - Add `debug/fractional-indexing-order-key.md` explaining the issue, root cause, and the fix.

## Migration
- Apply with: `pnpm supabase db push`
- Notes:
  - The migration includes a de‑duplication step before adding the unique constraint.
  - If you need an audit trail of modified rows, we can add a one-off query to list affected IDs.

## Performance & Concurrency
- `COLLATE "C"` uses bytewise comparison and is typically faster and simpler than ICU collations.
- Reads remain index-only via `(conversation_id, order_key)`.
- Retry-on-conflict handles rare concurrent appends safely with minimal overhead.

## Validation
- Create/continue chats across the previous boundary (e.g., `… az < b00 …` is expected) and confirm ordering.
- Verify no duplicates remain:
  - `SELECT conversation_id, order_key, COUNT(*) c FROM public.events GROUP BY 1,2 HAVING COUNT(*) > 1;`
- Confirm appends under load do not fail and keys remain unique and monotonic per conversation.

## Files Touched
- `supabase/migrations/202508280001_adjust_events_order_key_collation.sql` (new)
- `@budchat/data`
- `app/api/chat/route.ts`
- `app/api/conversations/route.ts`
- `debug/fractional-indexing-order-key.md` (new)

## Risk & Rollback
- Low risk after migration: indexes are recreated and a uniqueness constraint is introduced.
- Rollback strategy:
  - Drop the unique constraint and revert collation if necessary.
  - Note: reverting collation requires index drops and re-adds analogous to this migration.

## Follow-ups (Optional)
- Add an audit script to report any rows adjusted by the de‑duplication step.
- Add a metric/alert if any `order_key` exceeds a threshold length (e.g., 128 chars) to surface pathological “insert-between” patterns.
