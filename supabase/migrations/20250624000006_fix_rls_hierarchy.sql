-- Fix RLS hierarchy: workspace ownership is primary, membership is secondary
-- This breaks the circular dependency while supporting team collaboration

-- Re-enable RLS on workspace_members but with proper hierarchy
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start clean
DROP POLICY IF EXISTS "Users can view their own memberships" ON workspace_members;
DROP POLICY IF EXISTS "Users can create their own memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can manage memberships" ON workspace_members;

DROP POLICY IF EXISTS "Users can view their own workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON workspaces;
DROP POLICY IF EXISTS "Workspace owners can update their workspaces" ON workspaces;
DROP POLICY IF EXISTS "Workspace owners can delete their workspaces" ON workspaces;

-- WORKSPACES policies (top level - no dependencies)
-- These should NEVER reference workspace_members to avoid recursion

CREATE POLICY "Workspace owners can manage their workspaces" ON workspaces
  FOR ALL USING (
    owner_user_id = auth.uid()
  );

-- WORKSPACE_MEMBERS policies (depends only on workspaces, never circular)
-- These reference workspaces but workspaces never reference back

-- Users can see their own memberships
CREATE POLICY "Users can view their own memberships" ON workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
  );

-- Workspace owners can manage ALL memberships in their workspaces
CREATE POLICY "Workspace owners can manage memberships" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces 
      WHERE owner_user_id = auth.uid()
    )
  );

-- Users can join workspaces (for invitation flows)
CREATE POLICY "Users can join workspaces" ON workspace_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- Update API logic to handle the hierarchy properly
-- The /api/workspaces route should now work because:
-- 1. It queries workspace_members (which checks user_id = auth.uid())
-- 2. workspace_members policies don't create cycles
-- 3. Workspace ownership is checked separately

-- For workspace access, we'll use this logic:
-- User can access workspace IF:
--   - They own the workspace (workspaces.owner_user_id = auth.uid()), OR  
--   - They are a member (exists in workspace_members)

-- Add a view to simplify workspace access checks
CREATE OR REPLACE VIEW user_workspace_access AS
SELECT DISTINCT 
  w.id as workspace_id,
  w.name as workspace_name,
  w.owner_user_id,
  w.created_at,
  CASE 
    WHEN w.owner_user_id = auth.uid() THEN 'owner'
    ELSE wm.role 
  END as user_role
FROM workspaces w
LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = auth.uid()
WHERE w.owner_user_id = auth.uid() OR wm.user_id = auth.uid();

-- Enable RLS on the view
ALTER VIEW user_workspace_access SET (security_invoker = true);

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE 'Fixed RLS hierarchy - workspaces are authoritative';
  RAISE NOTICE 'workspace_members policies only reference workspaces (no cycles)';
  RAISE NOTICE 'Created user_workspace_access view for simplified queries';
END
$$;