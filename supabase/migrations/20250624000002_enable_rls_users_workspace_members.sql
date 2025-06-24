-- Enable RLS and create proper policies for users and workspace_members tables
-- These tables were missing RLS policies, creating a significant security vulnerability

-- Enable RLS on users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Re-enable RLS on workspace_members table (was disabled temporarily)
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own profile" ON users;
DROP POLICY IF EXISTS "Users can update their own profile" ON users;
DROP POLICY IF EXISTS "System can create users" ON users;

DROP POLICY IF EXISTS "Users can view their own memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can view all memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can manage memberships" ON workspace_members;
DROP POLICY IF EXISTS "Users can create their own memberships" ON workspace_members;
DROP POLICY IF EXISTS "Users manage own memberships" ON workspace_members;

-- Create RLS policies for users table
-- Users can only see and update their own profile
CREATE POLICY "Users can view their own profile" ON users
  FOR SELECT USING (
    id = auth.uid()
  );

CREATE POLICY "Users can update their own profile" ON users
  FOR UPDATE USING (
    id = auth.uid()
  );

-- System/auth can create users (for signup process)
CREATE POLICY "System can create users" ON users
  FOR INSERT WITH CHECK (
    id = auth.uid()
  );

-- No delete policy for users (prevent accidental deletion)
-- Users should be deactivated, not deleted, for audit purposes

-- Create RLS policies for workspace_members table
-- Fixed policies that avoid recursion issues

-- Users can view their own memberships
CREATE POLICY "Users can view their own memberships" ON workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
  );

-- Workspace owners can view all memberships in their workspaces
-- This uses the workspaces table directly to avoid recursion
CREATE POLICY "Workspace owners can view all memberships" ON workspace_members
  FOR SELECT USING (
    workspace_id IN (
      SELECT id FROM workspaces
      WHERE owner_user_id = auth.uid()
    )
  );

-- Workspace owners can manage (insert/update/delete) memberships
-- This uses the workspaces table directly to avoid recursion
CREATE POLICY "Workspace owners can manage memberships" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces
      WHERE owner_user_id = auth.uid()
    )
  );

-- Users can join workspaces (create their own memberships)
-- This is for invitation/join flows
CREATE POLICY "Users can create their own memberships" ON workspace_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- Add comments for documentation
COMMENT ON TABLE users IS 'User profiles with RLS enabled - users can only access their own data';
COMMENT ON TABLE workspace_members IS 'Workspace memberships with RLS enabled - users see own memberships, owners see all for their workspaces';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Successfully enabled RLS on users and workspace_members tables';
  RAISE NOTICE 'Created secure policies preventing unauthorized data access';
END
$$;