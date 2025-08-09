-- Add built-in tools config overrides column to conversations table
-- This allows users to override built-in tools settings on a per-conversation basis

ALTER TABLE conversations ADD COLUMN builtin_tools_config_overrides JSONB DEFAULT NULL;

-- Add a comment to document the column purpose
COMMENT ON COLUMN conversations.builtin_tools_config_overrides IS 'Per-conversation overrides for built-in tools configuration (OpenAI web search, code interpreter, etc.)';