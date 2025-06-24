-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "ltree";
-- Note: pgvector extension for future semantic search

-- Create workspace table
create table workspace (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid references auth.users on delete cascade,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Create conversation table  
create table conversation (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace on delete cascade,
  title       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Create role enum for message types
create type role as enum ('system','user','assistant','tool');

-- Create message table with ltree for branching
create table message (
  id          uuid primary key default gen_random_uuid(),
  convo_id    uuid references conversation on delete cascade,
  parent_id   uuid references message on delete cascade,
  path        ltree   not null,        -- e.g. '1.2.4'
  role        role    not null,
  content     text    not null,
  metadata    jsonb   default '{}',
  revision    smallint default 1,
  supersedes_id uuid references message,   -- filled only for edits
  token_count int,
  usage_ms    int,
  created_by  uuid references auth.users,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Create usage tracking table
create table usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  message_id  uuid references message on delete cascade,
  model       text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  cost_cents  numeric(10,4) not null default 0,
  created_at  timestamptz default now()
);

-- Create indexes for performance
create index idx_workspace_owner on workspace(owner_id);
create index idx_conversation_workspace on conversation(workspace_id);
create index idx_message_convo_path on message using gist (path);
create index idx_message_convo on message(convo_id);
create index idx_message_parent on message(parent_id);
create index idx_message_created_by on message(created_by);
create index idx_usage_user on usage(user_id);
create index idx_usage_created_at on usage(created_at);

-- Create updated_at trigger function
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Add triggers for updated_at
create trigger update_workspace_updated_at before update on workspace
  for each row execute function update_updated_at_column();

create trigger update_conversation_updated_at before update on conversation
  for each row execute function update_updated_at_column();

create trigger update_message_updated_at before update on message
  for each row execute function update_updated_at_column();