@budchat/data

Supabase repository helpers for conversations and events. Provides a thin, typed layer over PostgREST calls with ordering, de‑duplication fallbacks, and timing utilities.

## What it does
- Load/save events: `loadConversationEvents`, `saveEvents`, `saveEvent`, `getConversationEvents`.
- Ordering: fractional indexing via `generateKeyBetween` to maintain stable insertion order.
- Error handling: `getPostgrestErrorCode` and unique‑violation fallback insertion.
- Query helpers: `getLatestEvent`, `getLastOrderKey`, `getEventCount`, `getEventsByRole`, `getEventsByTimeRange`.
- Mutation helpers: `updateEventSegments`, `deleteEvent`, `deleteConversationWithEvents`.
- Timing: `updateToolSegmentTiming`, `updateReasoningSegmentTiming` to persist `started_at/completed_at` on segments.

## How it connects
- Consumes and returns `@budchat/events` types so providers/streaming can interoperate without conversions.
- API routes in the Next.js app import these helpers to keep route code minimal and consistent.
- No direct coupling to React/Zustand; callers pass a Supabase client instance.

## Usage
```ts
import { saveEvents, loadConversationEvents, createConversation } from '@budchat/data'
import { createTextEvent } from '@budchat/events'

const { conversationId } = await createConversation(supabase, workspaceId)
await saveEvents(supabase, [createTextEvent('user', 'Hi')], conversationId)
const events = await loadConversationEvents(supabase, conversationId)
```

## Notes
- `saveEvents` handles `23505` unique violations by fetching the latest order key and retrying inserts.
- Helpers return plain `Event` objects suitable for immediate provider calls or UI rendering.

