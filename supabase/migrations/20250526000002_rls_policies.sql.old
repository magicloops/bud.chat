-- Enable Row Level Security on all tables
alter table workspace enable row level security;
alter table conversation enable row level security;
alter table message enable row level security;
alter table usage enable row level security;

-- Workspace policies
create policy "Users can view workspaces they own or are members of" on workspace
  for select using (
    owner_id = auth.uid()
    -- TODO: Add workspace member check when we implement sharing
  );

create policy "Users can create workspaces" on workspace
  for insert with check (
    owner_id = auth.uid()
  );

create policy "Workspace owners can update their workspaces" on workspace
  for update using (
    owner_id = auth.uid()
  );

create policy "Workspace owners can delete their workspaces" on workspace
  for delete using (
    owner_id = auth.uid()
  );

-- Conversation policies
create policy "Users can view conversations in their workspaces" on conversation
  for select using (
    workspace_id in (
      select id from workspace where owner_id = auth.uid()
    )
  );

create policy "Users can create conversations in their workspaces" on conversation
  for insert with check (
    workspace_id in (
      select id from workspace where owner_id = auth.uid()
    )
  );

create policy "Users can update conversations in their workspaces" on conversation
  for update using (
    workspace_id in (
      select id from workspace where owner_id = auth.uid()
    )
  );

create policy "Users can delete conversations in their workspaces" on conversation
  for delete using (
    workspace_id in (
      select id from workspace where owner_id = auth.uid()
    )
  );

-- Message policies
create policy "Users can view messages in their conversations" on message
  for select using (
    convo_id in (
      select c.id from conversation c
      join workspace w on c.workspace_id = w.id
      where w.owner_id = auth.uid()
    )
  );

create policy "Users can create messages in their conversations" on message
  for insert with check (
    created_by = auth.uid() and
    convo_id in (
      select c.id from conversation c
      join workspace w on c.workspace_id = w.id
      where w.owner_id = auth.uid()
    )
  );

create policy "Users can update messages they created" on message
  for update using (
    created_by = auth.uid() and
    convo_id in (
      select c.id from conversation c
      join workspace w on c.workspace_id = w.id
      where w.owner_id = auth.uid()
    )
  );

create policy "Users can delete messages they created" on message
  for delete using (
    created_by = auth.uid() and
    convo_id in (
      select c.id from conversation c
      join workspace w on c.workspace_id = w.id
      where w.owner_id = auth.uid()
    )
  );

-- Usage policies
create policy "Users can view their own usage" on usage
  for select using (
    user_id = auth.uid()
  );

create policy "System can create usage records" on usage
  for insert with check (true); -- Will be restricted by application logic

-- No update/delete policies for usage (immutable audit log)