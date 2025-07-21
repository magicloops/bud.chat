-- Clean up backup tables after successful migration testing

-- Drop the backup tables since migration is confirmed successful
DROP TABLE IF EXISTS messages_backup;
DROP TABLE IF EXISTS message_revisions_backup;

-- Migration from messages to events is now complete