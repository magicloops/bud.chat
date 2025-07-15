-- Backup Legacy Data Script
-- Run this before starting the migration to create safety backups

-- Create backup schema
CREATE SCHEMA IF NOT EXISTS migration_backup;

-- 1. Backup messages table
CREATE TABLE migration_backup.messages_backup AS 
SELECT * FROM messages;

-- 2. Backup message_revisions table (if it exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_revisions') THEN
        EXECUTE 'CREATE TABLE migration_backup.message_revisions_backup AS SELECT * FROM message_revisions';
    END IF;
END $$;

-- 3. Backup conversations table (current state)
CREATE TABLE migration_backup.conversations_backup AS 
SELECT * FROM conversations;

-- 4. Create backup metadata
CREATE TABLE migration_backup.backup_metadata (
    backup_date timestamptz DEFAULT NOW(),
    table_name text,
    record_count integer,
    description text
);

-- 5. Insert backup metadata
INSERT INTO migration_backup.backup_metadata (table_name, record_count, description)
SELECT 
    'messages',
    COUNT(*),
    'Legacy messages table backup before migration'
FROM messages;

INSERT INTO migration_backup.backup_metadata (table_name, record_count, description)
SELECT 
    'conversations',
    COUNT(*),
    'Conversations table backup before migration'
FROM conversations;

-- 6. Check if message_revisions exists and backup if so
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_revisions') THEN
        INSERT INTO migration_backup.backup_metadata (table_name, record_count, description)
        SELECT 
            'message_revisions',
            COUNT(*),
            'Message revisions table backup before migration'
        FROM message_revisions;
    END IF;
END $$;

-- 7. Grant necessary permissions
GRANT USAGE ON SCHEMA migration_backup TO postgres;
GRANT SELECT ON ALL TABLES IN SCHEMA migration_backup TO postgres;

-- 8. Show backup summary
SELECT 
    'Backup Summary' as status,
    backup_date,
    table_name,
    record_count,
    description
FROM migration_backup.backup_metadata
ORDER BY backup_date DESC;

-- 9. Verify backup integrity
SELECT 
    'Integrity Check' as status,
    (SELECT COUNT(*) FROM messages) as original_messages,
    (SELECT COUNT(*) FROM migration_backup.messages_backup) as backup_messages,
    (SELECT COUNT(*) FROM conversations) as original_conversations,
    (SELECT COUNT(*) FROM migration_backup.conversations_backup) as backup_conversations;