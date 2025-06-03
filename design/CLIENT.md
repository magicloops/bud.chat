# CLIENT.md – Next.js Front‑End Architecture

> **Goal:** Deliver a desktop‑snappy, low‑maintenance UI for the LLM chat platform that pairs clean separation of concerns with aggressive latency optimisations.

---

## 1  Guiding Principles

| Principle                          | Why it matters                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Isolate concerns**               | Prevent cascading re‑renders & fragile coupling. UI ✕ State ✕ Transport layers are independent. |
| **Optimistic‑first UX**            | User input always shows immediately; server lag is hidden or gracefully rolled back.            |
| **One DB round‑trip per mutation** | Keep p95 < 100 ms for create / edit / branch.                                                   |
| **Stream, don’t poll**             | SSE over Edge Functions for token delivery → sub‑100 ms first token.                            |
| **Prefetch the future**            | Chat previews load on hover; IndexedDB cache survives tab refresh.                              |
| **Strict type sharing**            | Source‑of‑truth `types.ts` used by both Server Actions and client store.                        |

---

## 2  High‑Level Directory Layout (App Router)

```
app/
  layout.tsx            # RSC – global providers
  page.tsx              # Welcome / new chat screen
  [chatId]/
    page.tsx            # Chat window – RSC with streamed initial msgs
    actions.ts          # All Server Actions (mutations)
  api/
    stream/[chatId]/route.ts  # Edge SSE

lib/
  dbClient.ts           # fetch helper
  fractionalKey.ts      # key generation utils
  prefetch.ts           # hover prefetch util
  types.ts              # shared DTO & store types

state/
  chatStore.ts          # Zustand/Valtio + immer
  queryClient.ts        # TanStack Query singleton

components/
  ChatComposer/
  MessageList/
  MessageItem/
  BudPicker/
  Sidebar/
```

---

## 3  State Management Blueprint

### 3.1  chatStore shape (Zustand)

```ts
interface ChatState {
  chats: Record<ChatId, {
    meta: { title: string; updatedAt: string };
    messages: MessageId[];          // ordered
    byId: Record<MessageId, ChatMessage>;
    streaming: boolean;
  }>;
  // ✂️ selectors & mutators …
}
```

*Only writes through store mutators – components subscribe to **selectors** to avoid noise.*

### 3.2  Integrating TanStack Query

```
┌──────────────┐      ┌───────────┐
│ Components   │──────│ chatStore │
└──────────────┘      └─────┬─────┘
                             │ (optimistic patch)
                       ┌─────▼─────┐
                       │ Mutations │  —→  Server Action (PG)
                       └─────┬─────┘
                           (invalidate)
                       ┌─────▼─────┐
                       │ QueryCache│ — IndexedDB persister
                       └───────────┘
```

---

## 4  Core Operations Flow

| Action                     | UI → Store                                                       | Server Action (actions.ts)                         | SSE follow‑up                                |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| **Create chat**            | tempChatId + userMsg + assistant placeholder inserted into store | `insert conversations, messages` → return real IDs | open `/api/stream/:chatId`                   |
| **Send message**           | same as above (no new chat row)                                  | insert 2 msgs                                      | SSE updates assistant row token‑by‑token     |
| **Branch**                 | derive new tempChatId + splice msgs locally                      | insert conversation row (`root_msg_id` set)        | new SSE channel                              |
| **Edit / Insert / Delete** | patch store immediately                                          | `UPDATE/INSERT/DELETE` rows; returns new `version` | SSE not needed – local patch already matches |

Rollback path: `onError` → revert optimistic diff from queued snapshot.

---

## 5  Prefetch & Caching Strategy

* **Sidebar hover** → `prefetchChat(chatId)` (first 30 msgs) → warm QueryCache.
* **Stale time:** 1 minute; background refresh after focus.
* **AsyncStorage Persist:** `@tanstack/query-async-storage-persister` with IndexedDB – restores recent chats on reload.
* **Virtual list total**: only render viewport msgs; window upwards grows as user scrolls.

---

## 6  Streaming Assistant Tokens

1. Edge route sends `event: delta` frames: `{id, delta}`.
2. `useStream(chatId)` subscribes once; each delta `chatStore.appendDelta` → MessageItem sees prop update but stays mounted.
3. Completed event triggers final `version` sync from server.

---

## 7  Server Actions (Mutations API)

```ts
// app/[chatId]/actions.ts
export async function sendMessage(form: SendArgs) {
  return await db.transaction(async (tx)=>{
    const { orderKeyUser, orderKeyAI } = await computeKeys(tx, chatId);
    const [userId, aiId] = await tx.batch([
      sql`INSERT INTO messages …`,
      sql`INSERT INTO messages …`
    ]).returning('id');
    startStreaming(chatId, aiId);   // async
    return { userId, aiId };
  });
}
```

All other actions (edit, insert, delete, branch) follow the same **one‑txn, one‑round‑trip** rule.

---

## 8  Component Contracts

| Component        | Data props              | Event callbacks       |
| ---------------- | ----------------------- | --------------------- |
| **MessageList**  | `messages`, `streaming` | —                     |
| **MessageItem**  | `msg` (memoised)        | `onEdit`, `onDelete`  |
| **ChatComposer** | —                       | `onSend`              |
| **Sidebar**      | `chatsMeta`             | `onSelect`, `onHover` |
| **BudPicker**    | `buds`                  | `onSelectBud`         |

All callbacks bubble to a single `ChatController` that dispatches store mutations → keeps leaf components stateless.

---

## 9  Error & Concurrency Handling

* **version column** on messages; `UPDATE … WHERE version = $expected` –> if 0 rows updated → conflict popup.
* SSE disconnect resumes automatically; composer blocks when `streaming=true` to avoid parallel assistant replies.
* Global `ErrorBoundary` logs to Sentry & surfaces toast.

---

## 10  Testing & Metrics

| Layer              | Method                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Server Actions** | Vitest DB‑container unit tests; property‑based for key generation.                        |
| **Store logic**    | Jest reducers tests for optimistic patch / rollback.                                      |
| **E2E**            | Playwright: measure `performance.getEntriesByName('first-token')`. Fail if >250 ms local. |
| **Perf tracing**   | `next/trace` + custom RSC metric in `_app.tsx` shows hydration cost.                      |

---

## 11  Future‑Proof Hooks

* Switch `chatStore` to **Valtio + Yjs** for CRDT sync → UI untouched.
* Plug **ElectricSQL** into QueryCache to go fully local‑first.
* Replace SSE with **WebTransport** when browsers stabilise.

---

> **Everything the UI does fits one mental model:** *Optimistic local patch → single server call → SSE refresh.*  Keep that invariant and refactors stay trivial.
