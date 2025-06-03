-- Migration: Convert from ltree to fractional indexing schema
-- This migration transforms the existing schema to the new design

-- First, disable RLS temporarily to perform migration
ALTER TABLE workspace DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversation DISABLE ROW LEVEL SECURITY;
ALTER TABLE message DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage DISABLE ROW LEVEL SECURITY;

-- Create new tables first
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  created_at    timestamptz DEFAULT now()
);

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

CREATE TABLE buds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id),
  workspace_id  uuid REFERENCES workspaces(id), -- NULL => personal only
  name          text NOT NULL,
  default_json  jsonb NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) NOT NULL,
  root_msg_id   uuid,                    -- FK added after first msg insert
  bud_id        uuid REFERENCES buds(id),
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  order_key       text NOT NULL, -- fractional-index key
  role            text CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  json_meta       jsonb DEFAULT '{}'::jsonb,
  version         int  DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (conversation_id, order_key)
);

CREATE INDEX ON messages (conversation_id, order_key);

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

-- Migrate data from old schema to new schema

-- 1. Migrate users from auth.users to users table (if needed)
-- Note: This assumes auth.users exists and has the structure we need
INSERT INTO users (id, email, created_at)
SELECT 
  id,
  email,
  created_at
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 2. Migrate workspaces
INSERT INTO workspaces (id, name, owner_user_id, created_at)
SELECT 
  id,
  name,
  owner_id,
  created_at
FROM workspace;

-- 3. Create workspace memberships for all workspace owners
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT 
  id,
  owner_user_id,
  'owner'
FROM workspaces;

-- 4. Migrate conversations
INSERT INTO conversations (id, workspace_id, created_at)
SELECT 
  id,
  workspace_id,
  created_at
FROM conversation;

-- 5. Migrate messages with fractional indexing
-- This is complex because we need to convert ltree paths to order_keys
-- We'll use a simple approach: convert the ltree to a sortable string

-- Create a function to convert ltree path to order_key with conversation context
CREATE OR REPLACE FUNCTION ltree_to_order_key(path ltree, convo_id uuid, msg_created_at timestamptz) 
RETURNS text AS $$
DECLARE
  parts text[];
  result text := '';
  i integer;
  part text;
  base_key text;
BEGIN
  -- Convert ltree path like '1.2.3' to sortable key
  parts := string_to_array(path::text, '.');
  
  -- Create a base key from the path parts
  FOR i IN 1..array_length(parts, 1) LOOP
    part := parts[i];
    -- Pad each part to ensure proper sorting, but use shorter padding
    result := result || lpad(part, 6, '0');
    IF i < array_length(parts, 1) THEN
      result := result || '.';
    END IF;
  END LOOP;
  
  -- Add timestamp suffix to ensure uniqueness within conversation
  -- Use microseconds from created_at to make keys unique
  base_key := result || '.' || lpad(extract(epoch from msg_created_at)::bigint::text, 15, '0');
  
  RETURN base_key;
END;
$$ LANGUAGE plpgsql;

-- Migrate messages with converted order keys
INSERT INTO messages (
  id,
  conversation_id,
  order_key,
  role,
  content,
  json_meta,
  version,
  created_at,
  updated_at
)
SELECT 
  id,
  convo_id,
  ltree_to_order_key(path, convo_id, created_at),
  role::text,
  content,
  COALESCE(metadata, '{}'::jsonb),
  revision,
  created_at,
  updated_at
FROM message
ORDER BY convo_id, path;

-- Update conversations to set root_msg_id to the first message in each conversation
UPDATE conversations 
SET root_msg_id = (
  SELECT m.id
  FROM messages m
  WHERE m.conversation_id = conversations.id
  ORDER BY m.order_key
  LIMIT 1
);

-- Clean up: drop the conversion function
DROP FUNCTION ltree_to_order_key(ltree, uuid, timestamptz);

-- Drop old tables (commented out for safety - uncomment when ready)
-- DROP TABLE message CASCADE;
-- DROP TABLE conversation CASCADE;
-- DROP TABLE workspace CASCADE;
-- DROP TABLE usage CASCADE;

-- Enable RLS on new tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE buds ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_revisions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for new schema

-- Workspaces policies
CREATE POLICY "Users can view workspaces they are members of" ON workspaces
  FOR SELECT USING (
    id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create workspaces" ON workspaces
  FOR INSERT WITH CHECK (
    owner_user_id = auth.uid()
  );

CREATE POLICY "Workspace owners can update their workspaces" ON workspaces
  FOR UPDATE USING (
    owner_user_id = auth.uid()
  );

CREATE POLICY "Workspace owners can delete their workspaces" ON workspaces
  FOR DELETE USING (
    owner_user_id = auth.uid()
  );

-- Workspace members policies
CREATE POLICY "Users can view workspace memberships they are part of" ON workspace_members
  FOR SELECT USING (
    user_id = auth.uid() OR 
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Workspace owners can manage memberships" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Buds policies
CREATE POLICY "Users can view buds in their workspaces" ON buds
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    ) OR
    (workspace_id IS NULL AND owner_user_id = auth.uid())
  );

CREATE POLICY "Users can create buds in their workspaces" ON buds
  FOR INSERT WITH CHECK (
    owner_user_id = auth.uid() AND (
      workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
      ) OR
      workspace_id IS NULL
    )
  );

CREATE POLICY "Bud owners can update their buds" ON buds
  FOR UPDATE USING (
    owner_user_id = auth.uid()
  );

CREATE POLICY "Bud owners can delete their buds" ON buds
  FOR DELETE USING (
    owner_user_id = auth.uid()
  );

-- Conversations policies
CREATE POLICY "Users can view conversations in their workspaces" ON conversations
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create conversations in their workspaces" ON conversations
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update conversations in their workspaces" ON conversations
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete conversations in their workspaces" ON conversations
  FOR DELETE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

-- Messages policies
CREATE POLICY "Users can view messages in their conversations" ON messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create messages in their conversations" ON messages
  FOR INSERT WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update messages in their conversations" ON messages
  FOR UPDATE USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete messages in their conversations" ON messages
  FOR DELETE USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Message revisions policies
CREATE POLICY "Users can view message revisions in their conversations" ON message_revisions
  FOR SELECT USING (
    message_id IN (
      SELECT id FROM messages
      WHERE conversation_id IN (
        SELECT id FROM conversations
        WHERE workspace_id IN (
          SELECT workspace_id FROM workspace_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "System can create message revisions" ON message_revisions
  FOR INSERT WITH CHECK (true);

-- Add updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at on new tables
CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();