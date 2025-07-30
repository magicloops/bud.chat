-- Add response_metadata column to events table for unified segments model
-- This migration adds support for storing response metadata from streaming APIs

-- Add response_metadata column to events table
ALTER TABLE public.events 
ADD COLUMN response_metadata jsonb DEFAULT '{}';

-- Add GIN index for efficient response metadata queries
CREATE INDEX IF NOT EXISTS idx_events_response_metadata ON public.events 
USING gin (response_metadata);

-- Add comments for documentation
COMMENT ON COLUMN public.events.response_metadata IS 'JSONB data containing response metadata from streaming APIs. Includes completion status, tokens, output items, and other API-specific metadata.';

-- Example response_metadata structure:
-- {
--   "completion_status": "complete",
--   "total_tokens": 150,
--   "reasoning_tokens": 45,
--   "text_tokens": 105,
--   "total_output_items": [
--     {
--       "type": "reasoning",
--       "output_index": 0,
--       "sequence_number": 1
--     },
--     {
--       "type": "text",
--       "output_index": 1,
--       "sequence_number": 2
--     }
--   ],
--   "api_provider": "openai-responses",
--   "model": "o1-preview",
--   "effort_level": "medium"
-- }