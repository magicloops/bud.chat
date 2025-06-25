-- Add assistant identity and model configuration to conversations table
-- This makes conversations the source of truth for chat settings, with Buds as presets

-- Add assistant identity columns
ALTER TABLE conversations 
ADD COLUMN assistant_name TEXT DEFAULT 'Assistant',
ADD COLUMN assistant_avatar TEXT DEFAULT '🤖';

-- Rename bud_id to source_bud_id for clarity
ALTER TABLE conversations 
RENAME COLUMN bud_id TO source_bud_id;

-- Add disconnection tracking
ALTER TABLE conversations 
ADD COLUMN bud_disconnected BOOLEAN DEFAULT false;

-- Add flexible model configuration as JSON
ALTER TABLE conversations 
ADD COLUMN model_config JSONB DEFAULT jsonb_build_object(
  'model', 'gpt-4o',
  'temperature', 0.7,
  'system_prompt', 'You are a helpful assistant.'
);

-- Update existing conversations with default model config if missing
UPDATE conversations 
SET model_config = jsonb_build_object(
  'model', 'gpt-4o',
  'temperature', 0.7,
  'system_prompt', 'You are a helpful assistant.'
) 
WHERE model_config IS NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_source_bud ON conversations(source_bud_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assistant_name ON conversations(assistant_name);

-- Add comments explaining the new columns
COMMENT ON COLUMN conversations.assistant_name IS 'Display name for the assistant in this conversation';
COMMENT ON COLUMN conversations.assistant_avatar IS 'Emoji or avatar for the assistant in this conversation';
COMMENT ON COLUMN conversations.source_bud_id IS 'The bud that originally seeded this conversation (renamed from bud_id)';
COMMENT ON COLUMN conversations.bud_disconnected IS 'True if conversation settings have diverged from the source bud';
COMMENT ON COLUMN conversations.model_config IS 'Model configuration and settings for this conversation as JSON';