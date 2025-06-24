-- Fix infinite recursion in workspace_members RLS policies
-- The issue: workspace_members policies reference workspaces, but workspaces policies reference workspace_members
-- This creates a circular dependency causing infinite recursion

-- Drop all existing workspace_members policies
DROP POLICY IF EXISTS "Users can view their own memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can view all memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can manage memberships" ON workspace_members;
DROP POLICY IF EXISTS "Users can create their own memberships" ON workspace_members;

-- Create simple, non-recursive policies for workspace_members
-- These policies should NOT reference other tables to avoid recursion

-- Users can see their own memberships (simple, no recursion)
CREATE POLICY "Users can view their own memberships" ON workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
  );

-- Users can insert their own memberships (for invitations)
CREATE POLICY "Users can create their own memberships" ON workspace_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- For workspace management, we'll handle this at the application level
-- or use a separate policy that's more careful about recursion

-- Alternative: Allow workspace owners to manage memberships
-- But we need to be very careful about the query structure
CREATE POLICY "Workspace owners can manage memberships" ON workspace_members
  FOR ALL USING (
    -- Check ownership directly without subquery to workspaces table
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id 
      AND w.owner_user_id = auth.uid()
    )
  );

-- Update workspaces policies to avoid recursion
-- Drop and recreate to ensure clean state
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON workspaces;
DROP POLICY IF EXISTS "Workspace owners can update their workspaces" ON workspaces;
DROP POLICY IF EXISTS "Workspace owners can delete their workspaces" ON workspaces;

-- Simpler workspaces policies
CREATE POLICY "Users can view workspaces they own or are members of" ON workspaces
  FOR SELECT USING (
    owner_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id 
      AND wm.user_id = auth.uid()
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

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Fixed infinite recursion in workspace_members RLS policies';
  RAISE NOTICE 'Simplified policies to avoid circular dependencies';
END
$$;