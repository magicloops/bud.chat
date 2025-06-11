-- Add title and metadata columns to conversations table
ALTER TABLE conversations 
ADD COLUMN title TEXT,
ADD COLUMN metadata JSONB;

-- Add index on title for faster searches (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_conversations_title ON conversations(title);

-- Add comment explaining the columns
COMMENT ON COLUMN conversations.title IS 'Auto-generated conversation title based on first few messages';
COMMENT ON COLUMN conversations.metadata IS 'Additional conversation metadata as JSON';
