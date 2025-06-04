-- Temporarily disable RLS on workspace_members to fix the infinite recursion
-- This is a quick fix to get the app working while we test the proper policies

ALTER TABLE workspace_members DISABLE ROW LEVEL SECURITY;

-- Re-enable it with a simple policy that doesn't cause recursion
-- ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Simple policy: users can only see/manage their own memberships
-- CREATE POLICY "Users manage own memberships" ON workspace_members
--   FOR ALL USING (user_id = auth.uid());