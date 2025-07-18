-- Drop legacy message tables after migration to events

-- Create backup tables first (for rollback safety, only if tables exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    CREATE TABLE IF NOT EXISTS messages_backup AS SELECT * FROM messages;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_revisions') THEN
    CREATE TABLE IF NOT EXISTS message_revisions_backup AS SELECT * FROM message_revisions;
  END IF;
END $$;

-- Drop foreign key constraints first (if any)
ALTER TABLE IF EXISTS message_revisions DROP CONSTRAINT IF EXISTS message_revisions_message_id_fkey;

-- Drop the legacy tables (if they exist)
DROP TABLE IF EXISTS message_revisions;
DROP TABLE IF EXISTS messages;

-- Drop any legacy functions or triggers (if they exist)
DROP FUNCTION IF EXISTS update_message_updated_at() CASCADE;

-- Note: Triggers are automatically dropped when tables are dropped
-- Keep backup tables for rollback safety (they can be manually dropped later)