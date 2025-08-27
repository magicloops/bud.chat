-- Add built-in tools configuration to buds table
-- This enables configuration of OpenAI's built-in tools (web search, code interpreter)

ALTER TABLE buds 
ADD COLUMN builtin_tools_config JSONB DEFAULT '{}' NOT NULL;

-- Add comment to explain the structure
COMMENT ON COLUMN buds.builtin_tools_config IS 
'Configuration for OpenAI built-in tools. Structure: {
  "enabled_tools": ["web_search_preview", "code_interpreter"],
  "tool_settings": {
    "web_search_preview": {
      "search_context_size": "medium"
    },
    "code_interpreter": {
      "container": "default"
    }
  }
}';

-- Create index for querying buds by enabled tools (for analytics/debugging)
CREATE INDEX idx_buds_builtin_tools_enabled 
ON buds USING GIN ((builtin_tools_config->'enabled_tools'));

-- Example of setting up a bud with built-in tools (commented out - for reference only)
-- UPDATE buds SET builtin_tools_config = '{
--   "enabled_tools": ["web_search_preview"],
--   "tool_settings": {
--     "web_search_preview": {
--       "search_context_size": "medium"
--     }
--   }
-- }' WHERE id = 'some-bud-id';