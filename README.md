# bud.chat

*A fully-open, branch-first LLM chat interface built with Next.js 15, Supabase, and the OpenAI **Responses API**.*

bud.chat lets you **fork** any message, edit earlier prompts in a branch, and explore alternative discussion paths without losing context—think “Git for conversations.”

---

## ✨ Feature Highlights

| Domain | Capability |
|--------|------------|
| **Branching (“fork”)** | Copy-on-write message DAG: every fork is a lightweight pointer—no message duplication. |
| **Editable history** | In any fork, you can edit *any* earlier message (even the root system prompt); older forks remain immutable. |
| **Real-time streaming** | Tokens stream over websockets the instant the Responses API emits them and persist to Supabase in the same transaction. |
| **Multi-model ready** | Ships with OpenAI (Responses API), scaffolded adapters for Anthropic Claude & Google Gemini. |
| **Supabase-everywhere** | One Postgres instance—local and prod—plus Supabase Auth, Realtime, Storage, and Serverless Functions. |
| **Usage metering** | Row-level token counts for each message → per-user and per-workspace spend dashboards. |
| **Future-proof** | Hooks in place for the upcoming **Model Context Protocol (MCP)** to swap vector stores or agent runtimes. |

---

## 🏗  High-Level Architecture

```

apps/
web/            # Next.js 15 (app router) – SSR + streaming UI
packages/
db/             # SQL migrations & Supabase types (generated)
server/         # tRPC / REST handlers, OpenAI adapters
shared/         # TS types & utilities
infra/
render.yaml     # Render services & migrations

````

### Data Flow

1. **Client** sends `/api/chat` with a partial message.
2. **Edge Runtime (Next.js)* verifies Supabase JWT, writes a *pending* row to `message`.
3. **Server function** calls OpenAI Responses API.  
   * Streams tokens → `LISTEN/NOTIFY` channel `new_token`.
   * Commits final content + token usage to `message` & `usage`.
4. **Supabase Realtime** pushes `new_token` events to subscribed clients.
5. **Client** incrementally renders the assistant message.

---

## 🛢️ Database Design (Postgres @ Supabase)

> Extensions used: `pgcrypto` (UUIDs), `ltree` (path DAG), `pgvector` (future semantic search).

### Core Tables

```sql
create table workspace (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid references auth.users
);

create table conversation (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace on delete cascade,
  title       text,
  created_at  timestamptz default now()
);

create type role as enum ('system','user','assistant','tool');

create table message (
  id          uuid primary key default gen_random_uuid(),
  convo_id    uuid references conversation on delete cascade,
  parent_id   uuid references message on delete cascade,
  path        ltree   not null,        -- e.g. '1.2.4'
  role        role    not null,
  content     text    not null,
  metadata    jsonb,
  revision    smallint default 1,
  supersedes_id uuid references message,   -- filled only for edits
  token_count int,
  usage_ms    int,
  created_by  uuid references auth.users,
  created_at  timestamptz default now()
);
create index msg_convo_path on message using gist (convo_id, path);

create table usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users,
  model       text,
  prompt_tokens int,
  completion_tokens int,
  cost_cents  numeric(10,4),
  created_at  timestamptz default now()
);
````

#### Forking

```sql
insert into message (id, convo_id, parent_id, path, role, content, metadata)
select  gen_random_uuid(), :new_convo, parent_id, path, role, content, metadata
from    message
where   convo_id = :orig_convo
  and   path <@ :fork_path;   -- copy ancestors (or self)
```

#### Editing After Fork

```sql
update message
set    content        = :new_text,
       revision       = revision + 1,
       supersedes_id  = :orig_msg_id
where  id = :cloned_msg_id;   -- same path within the fork
```

> **Read query:**
> `SELECT DISTINCT ON (path) * FROM message WHERE convo_id = $cid ORDER BY path, revision DESC;`
> returns the latest version per node.

---

## 🖥️ Server-Side (packages/server)

| Layer                           | Responsibility                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| **`api/chat` Route Handler**    | Entry point for browser & ShareGPT-like links. Validates auth, enqueues messages, returns stream. |
| **Model Adapter (`openai.ts`)** | Thin wrapper around the Responses API. Converts streaming chunks → internal `TokenEvent`.         |
| **Agent Wrapper (future)**      | Pluggable runner for MCP agents & tool calls.                                                     |
| **Supabase Service**            | Encapsulates writes/edits, emits `NOTIFY` on `new_token`, resolves RLS policies.                  |
| **Rate & Quota Guard**          | Checks `usage` totals before hitting provider; fails fast if user at limit.                       |

### Tool Calls

*JSON-schema commands emitted by the model* hit `/api/tools/:name`.
Each tool function:

1. Verifies RLS with `supabase.auth.getUser()`.
2. Executes business logic (e.g., search Postgres, upload file to Supabase Storage).
3. Streams incremental tool messages back via the same `new_token` channel.

---

## 💻 Client-Side (apps/web)

| Folder                            | Component                                                                                     | Details |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| `components/chat/ChatShell.tsx`   | Main layout: conversation list ↔ thread ↔ settings drawer (3-pane responsive).                |         |
| `components/chat/MessageList.tsx` | Virtualized list keyed by `path`. Handles **fork click** on any message (opens branch modal). |         |
| `components/chat/Composer.tsx`    | Markdown editor + attachments dropzone (uploads to Supabase Storage).                         |         |
| `hooks/useStream.ts`              | Subscribes to `supabase.channel('new_token')`; merges token events into TanStack Query cache. |         |
| `store/slices/branches.ts`        | Zustand slice: maintains selected branch, pending edits, optimistic UI.                       |         |
| `app/(auth)/callback/route.ts`    | Next.js 15 server component that finalizes Supabase OAuth login.                              |         |
| `app/settings/usage/page.tsx`     | Displays usage from `/api/usage` grouped by model & workspace.                                |         |

---

## ⚙️ Development Setup

```bash
# 1. Clone
git clone git@github.com:magicloops/bud.chat.git && cd bud.chat

# 2. Bootstrap Supabase (local dev service)
supabase start
supabase db reset  # runs SQL in packages/db/migrations

# 3. Env vars
cp .env.example .env   # fill in OPENAI_API_KEY etc.

# 4. Install deps
pnpm i

# 5. Dev servers (concurrently)
pnpm dev:web      # Next.js 15 with Hot Refresh
pnpm dev:server   # tRPC / route handlers in watch mode
```

> The local Supabase instance gives you the same Postgres, Realtime, Auth, and Storage services you’ll have in prod—no SQLite mock needed.

---

## 🚀 Deployment (Render)

1. **Render Blueprint (`render.yaml`)**

   ```yaml
   services:
     - type: web
       name: bud-web
       runtime: node
       buildCommand: pnpm -r build
       startCommand: pnpm --filter @bud/web start
       envVars:
         - key: SUPABASE_URL
           fromDatabase: bud-db
         - key: SUPABASE_ANON_KEY
           sync: true
   databases:
     - name: bud-db
       plan: standard
       ipAllowList: []         # Render → Supabase edge allowed
   ```
2. **Git hook**: Render auto-builds on `main`; migrations run via `packages/db/sync.ts` on startup.
3. **Secrets**: OPENAI keys & provider keys set in Render dashboard.

---

## 🛣️ Roadmap

### Short-Term

* **Claude & Gemini adapters** (Responses-compatible streaming wrapper).
* **Branch diffing UI** (two-pane diff of divergent paths).
* **Vector Search** with `pgvector` + hybrid rerank.
* **Batch export** of conversation trees to JSON & Markdown.

### Mid-Term

* **Model Context Protocol (MCP)** integration (agent recipes, memory streams).
* **Shared live sessions** (multi-cursor CRDT to co-edit a branch).
* **Plugin marketplace** (tool-call manifest uploads signed by workspace owner).

---

## Cost
There were many sessions that looked like: 
```
Total cost:            $23.12
Total duration (API):  1h 25m 5.6s
Total duration (wall): 77h 56m 1.8s
Total code changes:    5344 lines added, 1987 lines removed
Token usage by model:
    claude-3-5-haiku:  310.6k input, 8.5k output, 0 cache read, 0 cache write
       claude-sonnet:  16.9k input, 186.4k output, 46.9m cache read, 1.6m cache write
```

```
Total cost:            $118.65
Total duration (API):  9h 39m 41.7s
Total duration (wall): 313h 36m 4.6s
Total code changes:    11978 lines added, 4753 lines removed
Token usage by model:
    claude-3-5-haiku:  2.8m input, 79.4k output, 0 cache read, 0 cache write
       claude-sonnet:  28.9k input, 777.6k output, 220.8m cache read, 10.2m cache write
```


---

## 📝 License

MIT © 2025 bud.chat contributors
