-- Fix infinite recursion in workspace_members RLS policies

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view workspace memberships they are part of" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can manage memberships" ON workspace_members;

-- Create fixed policies that don't cause recursion

-- Allow users to see their own memberships
CREATE POLICY "Users can view their own memberships" ON workspace_members
  FOR SELECT USING (user_id = auth.uid());

-- Allow workspace owners to view all memberships in their workspaces
-- This uses the workspaces table directly instead of workspace_members to avoid recursion
CREATE POLICY "Workspace owners can view all memberships" ON workspace_members
  FOR SELECT USING (
    workspace_id IN (
      SELECT id FROM workspaces
      WHERE owner_user_id = auth.uid()
    )
  );

-- Allow workspace owners to manage memberships
-- This uses the workspaces table directly instead of workspace_members to avoid recursion
CREATE POLICY "Workspace owners can manage memberships" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces
      WHERE owner_user_id = auth.uid()
    )
  );

-- Allow users to insert their own memberships (for joining workspaces)
CREATE POLICY "Users can create their own memberships" ON workspace_members
  FOR INSERT WITH CHECK (user_id = auth.uid());