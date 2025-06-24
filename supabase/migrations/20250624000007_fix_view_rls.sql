-- Fix user_workspace_access view by making it a security definer function instead
-- Views with RLS can be tricky - let's use a function approach

-- Drop the problematic view
DROP VIEW IF EXISTS user_workspace_access;

-- Create a security definer function that bypasses RLS for this specific query
CREATE OR REPLACE FUNCTION get_user_workspaces()
RETURNS TABLE (
  workspace_id uuid,
  workspace_name text,
  owner_user_id uuid,
  created_at timestamptz,
  user_role text
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    w.id::uuid as workspace_id,
    w.name::text as workspace_name,
    w.owner_user_id::uuid,
    w.created_at::timestamptz,
    CASE 
      WHEN w.owner_user_id = auth.uid() THEN 'owner'::text
      ELSE COALESCE(wm.role, 'member')::text
    END as user_role
  FROM workspaces w
  LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = auth.uid()
  WHERE w.owner_user_id = auth.uid() OR wm.user_id = auth.uid();
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_workspaces() TO authenticated;

-- Alternative: Let's also try a simpler approach - direct workspaces query
-- since you're the owner, we can just query workspaces directly

-- Test query to see what's actually in the tables:
DO $$
DECLARE
  workspace_count int;
  membership_count int;
  current_user_id uuid;
BEGIN
  SELECT auth.uid() INTO current_user_id;
  
  SELECT COUNT(*) INTO workspace_count 
  FROM workspaces 
  WHERE owner_user_id = current_user_id;
  
  SELECT COUNT(*) INTO membership_count 
  FROM workspace_members 
  WHERE user_id = current_user_id;
  
  RAISE NOTICE 'Current user ID: %', current_user_id;
  RAISE NOTICE 'Workspaces owned: %', workspace_count;
  RAISE NOTICE 'Memberships: %', membership_count;
END;
$$;