-- Drop unused tables from ltree-based schema migration
-- These tables were replaced during migration to fractional indexing
-- and are no longer referenced in the application code

-- Safety check: Ensure new tables exist before dropping old ones
DO $$
BEGIN
  -- Verify new tables exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workspaces') THEN
    RAISE EXCEPTION 'New workspaces table does not exist. Migration aborted for safety.';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
    RAISE EXCEPTION 'New conversations table does not exist. Migration aborted for safety.';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    RAISE EXCEPTION 'New messages table does not exist. Migration aborted for safety.';
  END IF;
  
  -- Verify new tables have data (optional safety check)
  IF (SELECT COUNT(*) FROM workspaces) = 0 AND (SELECT COUNT(*) FROM workspace) > 0 THEN
    RAISE EXCEPTION 'New workspaces table is empty but old workspace table has data. Migration may be incomplete.';
  END IF;
  
  RAISE NOTICE 'Safety checks passed. Proceeding with table cleanup.';
END
$$;

-- Drop old tables in correct order (reverse dependency order)
-- Drop dependent tables first, then parent tables

-- Drop usage table (no dependencies)
DROP TABLE IF EXISTS usage CASCADE;

-- Drop message table (depends on conversation)
DROP TABLE IF EXISTS message CASCADE;

-- Drop conversation table (depends on workspace)  
DROP TABLE IF EXISTS conversation CASCADE;

-- Drop workspace table (parent table)
DROP TABLE IF EXISTS workspace CASCADE;

-- Clean up any remaining indexes or functions related to old schema
DROP INDEX IF EXISTS idx_workspace_owner;
DROP INDEX IF EXISTS idx_conversation_workspace;
DROP INDEX IF EXISTS idx_message_convo_path;
DROP INDEX IF EXISTS idx_message_convo;
DROP INDEX IF EXISTS idx_message_parent;
DROP INDEX IF EXISTS idx_message_created_by;
DROP INDEX IF EXISTS idx_usage_user;
DROP INDEX IF EXISTS idx_usage_created_at;
DROP INDEX IF EXISTS idx_conversation_metadata;

-- Drop the role enum if it's no longer used
-- (Keep it if the new messages table still uses it)
-- DROP TYPE IF EXISTS role;

-- Add comment for audit trail
COMMENT ON SCHEMA public IS 'Cleaned up unused tables from ltree migration on 2025-06-24';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Successfully dropped unused tables: workspace, conversation, message, usage';
  RAISE NOTICE 'Cleanup migration completed successfully';
END
$$;