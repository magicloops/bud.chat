-- Convert conversations to override-only approach for Bud settings
-- Only store customized settings, use Bud defaults for everything else

-- Remove the full model_config and bud_disconnected columns (replaced with overrides approach)
ALTER TABLE conversations 
DROP COLUMN IF EXISTS model_config,
DROP COLUMN IF EXISTS bud_disconnected;

-- Convert assistant identity to nullable (NULL = use bud defaults)
ALTER TABLE conversations 
ALTER COLUMN assistant_name DROP DEFAULT,
ALTER COLUMN assistant_avatar DROP DEFAULT;

-- Update existing conversations to NULL if they have default values
UPDATE conversations 
SET assistant_name = NULL 
WHERE assistant_name = 'Assistant';

UPDATE conversations 
SET assistant_avatar = NULL 
WHERE assistant_avatar = '🤖';

-- Add model configuration overrides as JSON (NULL = use bud defaults)
ALTER TABLE conversations 
ADD COLUMN model_config_overrides JSONB;

-- Update comments to reflect override-only approach
COMMENT ON COLUMN conversations.assistant_name IS 'Custom assistant name for this conversation (NULL = use bud default)';
COMMENT ON COLUMN conversations.assistant_avatar IS 'Custom assistant avatar for this conversation (NULL = use bud default)';
COMMENT ON COLUMN conversations.model_config_overrides IS 'Model configuration overrides for this conversation as JSON (NULL = use bud defaults)';