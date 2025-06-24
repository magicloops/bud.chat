-- Simplify by using auth.users directly instead of maintaining separate users table
-- This eliminates sync issues and simplifies the architecture

-- Update workspaces table to reference auth.users directly
ALTER TABLE workspaces 
DROP CONSTRAINT IF EXISTS workspaces_owner_user_id_fkey,
ADD CONSTRAINT workspaces_owner_user_id_fkey 
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update workspace_members table to reference auth.users directly  
ALTER TABLE workspace_members
DROP CONSTRAINT IF EXISTS workspace_members_user_id_fkey,
ADD CONSTRAINT workspace_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update buds table to reference auth.users directly
ALTER TABLE buds
DROP CONSTRAINT IF EXISTS buds_owner_user_id_fkey,
ADD CONSTRAINT buds_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop the separate users table since we're using auth.users directly
DROP TABLE IF EXISTS users CASCADE;

-- Update RLS policies to use auth.uid() directly (no users table needed)

-- Enable RLS on workspace_members (might have been disabled)
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can view all memberships" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can manage memberships" ON workspace_members;
DROP POLICY IF EXISTS "Users can create their own memberships" ON workspace_members;

-- Recreate workspace_members policies with auth.uid()
CREATE POLICY "Users can view their own memberships" ON workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
  );

CREATE POLICY "Workspace owners can view all memberships" ON workspace_members
  FOR SELECT USING (
    workspace_id IN (
      SELECT id FROM workspaces
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace owners can manage memberships" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create their own memberships" ON workspace_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- Update workspaces policies
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON workspaces;
DROP POLICY IF EXISTS "Workspace owners can update their workspaces" ON workspaces;
DROP POLICY IF EXISTS "Workspace owners can delete their workspaces" ON workspaces;

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

-- Update buds policies
DROP POLICY IF EXISTS "Users can view buds in their workspaces" ON buds;
DROP POLICY IF EXISTS "Users can create buds in their workspaces" ON buds;
DROP POLICY IF EXISTS "Bud owners can update their buds" ON buds;
DROP POLICY IF EXISTS "Bud owners can delete their buds" ON buds;

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

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Successfully updated schema to use auth.users directly';
  RAISE NOTICE 'Dropped separate users table and updated all foreign keys';
  RAISE NOTICE 'Updated all RLS policies to use auth.uid() directly';
END
$$;