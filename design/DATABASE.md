# DATABASE.md – Chat Platform Schema

> **Scope:** Minimal, relational schema (PostgreSQL‑compatible) for a developer‑focused LLM chat client supporting branching, Buds, multi‑workspace ACLs, and low‑latency message ops.

---

## 1  Core Entities & Tables

| Entity                          | Purpose                                          | Key columns                                                                                                 |
| ------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **users**                       | App accounts (email / OAuth ID, etc.)            | `id`, `email`, `created_at`                                                                                 |
| **workspaces**                  | Personal or shared space containing chats & Buds | `id`, `name`, `owner_user_id`                                                                               |
| **workspace\_members**          | M \:N membership (+ role)                        | `workspace_id`, `user_id`, `role`                                                                           |
| **buds**                        | Re‑usable chat presets (model, tools, avatar…)   | `id`, `workspace_id NULL`, `owner_user_id`, `name`, `default_json`                                          |
| **conversations**               | Linear or forked chat thread                     | `id`, `workspace_id`, `root_msg_id`, `created_at`                                                           |
| **messages**                    | Current *visible* revision of each utterance     | `id`, `conversation_id`, `order_key`, `role`, `content`, `json_meta`, `version`, `created_at`, `updated_at` |
| **message\_revisions** *(opt.)* | Immutable history of edits                       | `id`, `message_id`, `rev`, `role`, `content`, `meta`, `created_at`                                          |

### 1.1  Table DDL (simplified)

```sql
-- Users
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- Workspaces
CREATE TABLE workspaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id  uuid REFERENCES workspaces(id),
  user_id       uuid REFERENCES users(id),
  role          text DEFAULT 'member',
  PRIMARY KEY(workspace_id, user_id)
);

-- Buds (shared or personal)
CREATE TABLE buds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id),
  workspace_id  uuid REFERENCES workspaces(id), -- NULL ⇒ personal only
  name          text NOT NULL,
  default_json  jsonb NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- Conversations
CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) NOT NULL,
  root_msg_id   uuid,                    -- FK added after first msg insert
  bud_id        uuid REFERENCES buds(id),
  created_at    timestamptz DEFAULT now()
);

-- Messages (current revision)
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  order_key       text NOT NULL, -- fractional‑index key
  role            text CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  json_meta       jsonb DEFAULT '{}'::jsonb,
  version         int  DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (conversation_id, order_key)
);
CREATE INDEX ON messages (conversation_id, order_key);

-- Optional immutable audit trail
CREATE TABLE message_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id),
  rev         int  NOT NULL,
  role        text,
  content     text,
  meta        jsonb,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (message_id, rev)
);
```

---

## 2  Ordering Strategy (`order_key`)

* **Type:** `text` (base‑62 sortable string).
* **Purpose:** Controls display order without ever renumbering rows.
* **Generated with:** Fractional‑indexing – `generateKeyAfter`, `generateKeyBefore`, `generateKeyBetween`.
* **Guarantees:**

  * `UNIQUE (conversation_id, order_key)` avoids duplicates under race.
  * Lexicographic sort (`ORDER BY order_key ASC`) ⇢ chronological display.

### 2.1  Key Generation Cheatsheet

```ts
import {
  generateKeyBetween,
  generateKeyAfter,
  generateKeyBefore,
} from 'fractional-indexing';

// append to end
const key = generateKeyAfter(lastKey);
// prepend to start
const key = generateKeyBefore(firstKey);
// insert between two
const key = generateKeyBetween(prevKey, nextKey);
```

---

## 3  Typical Mutations (Hot Path ≤ 1 Round‑Trip)

| Action             | Steps (SQL, inside one txn)                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Send / append**  | 1️⃣ `SELECT order_key FROM messages WHERE conversation_id=$cid ORDER BY order_key DESC LIMIT 1;`<br>2️⃣ Insert user msg (new key)<br>3️⃣ Insert assistant *placeholder* msg (next key) |
| **Prepend**        | Select first key (`ASC LIMIT 1`) → `generateKeyBefore` → insert                                                                                                                        |
| **Insert between** | Select keys for `$before,$after` in one `WHERE order_key IN (…)` → insert                                                                                                              |
| **Edit**           | `UPDATE messages SET content=$new, version=version+1, updated_at=now() WHERE id=$msgId AND version=$expected;` (optimistic)                                                            |

Edits optionally write to `message_revisions` before the update (audit).

---

## 4  Branching / Forks

*Create a new conversation pointing at any prior message.*

```sql
INSERT INTO conversations (workspace_id, root_msg_id, bud_id)
VALUES ($wsId, $branchPointMsgId, $budId)
RETURNING id;
```

The UI loads messages **≥ root\_msg\_id.order\_key** for the branch.

---

## 5  Row‑Level Security (Supabase‑style)

```sql
CREATE POLICY "workspace‑isolation" ON messages
  USING (conversation_id IN (
    SELECT id FROM conversations
    WHERE workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  ));
```

Same pattern on all workspace‑scoped tables. Personal workspaces are just regular workspaces with one `workspace_members` row.

---

## 6  Future‑Proof Hooks

| Need                          | Extension Path                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Snapshots / summarization** | Background job inserts synthetic `assistant` messages with `json_meta.type = 'summary'` every N tokens |
| **MCP tools**                 | Store tool invocation results as messages; extend `role` enum to `tool` if desired                     |
| **Local‑first**               | Replicate same schema via ElectricSQL; `order_key` survives CRDT merge without conflicts               |
| **Analytics / audit**         | Query `message_revisions` or logical replication stream                                                |

---

## 7  Glossary

* **Bud** – JSON bundle: `{name, avatar, default_system_prompt, model, tools}`.
* **Conversation root** – First message *visible* in a branch, pointed to by `root_msg_id`.
* **order\_key** – Dense sortable string; all ordering logic collapses to lexicographic sort.
* **Version** – Incrementing int on messages for optimistic concurrency.
* **Workspace** – ACL boundary; chats & Buds live inside.

---

> **Remember:** keep the hot‑path simple (single‑row inserts/updates) and push heavy transforms (summaries, analytics) to async workers. The schema above lets you do that without migrations when the product grows.

