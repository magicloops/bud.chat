-- Add soft delete to buds table
ALTER TABLE buds ADD COLUMN deleted_at timestamptz;

-- Create index for performance when filtering non-deleted buds
CREATE INDEX idx_buds_deleted_at ON buds(deleted_at) WHERE deleted_at IS NULL;

-- Update RLS policies to filter out soft-deleted buds
-- Drop existing select policy
DROP POLICY IF EXISTS "Users can view buds they have access to" ON buds;

-- Create new select policy that filters out soft-deleted buds
CREATE POLICY "Users can view non-deleted buds they have access to" ON buds
  FOR SELECT
  USING (
    deleted_at IS NULL AND (
      owner_user_id = auth.uid() OR
      workspace_id IS NULL OR
      workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );