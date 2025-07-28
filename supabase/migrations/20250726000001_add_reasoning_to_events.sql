-- Add reasoning column to events table for OpenAI o-series model reasoning summaries
-- This migration adds support for storing reasoning data from OpenAI's Responses API

-- Add reasoning column to events table
ALTER TABLE public.events 
ADD COLUMN reasoning jsonb DEFAULT NULL;

-- Add index for events that have reasoning data
CREATE INDEX IF NOT EXISTS idx_events_has_reasoning ON public.events (id)
WHERE reasoning IS NOT NULL;

-- Add GIN index for efficient reasoning data queries
CREATE INDEX IF NOT EXISTS idx_events_reasoning ON public.events 
USING gin (reasoning);

-- Add comments for documentation
COMMENT ON COLUMN public.events.reasoning IS 'JSONB data containing OpenAI reasoning summaries from o-series models (o1, o3, o3-mini, o4-mini). Contains indexed reasoning parts, combined text, and metadata.';

-- Example reasoning data structure:
-- {
--   "item_id": "rs_12345...",
--   "output_index": 0,
--   "parts": {
--     "0": {
--       "summary_index": 0,
--       "type": "summary_text", 
--       "text": "The user is asking about...",
--       "sequence_number": 1,
--       "is_complete": true,
--       "created_at": 1706300000000
--     }
--   },
--   "combined_text": "The user is asking about...",
--   "effort_level": "medium",
--   "reasoning_tokens": 150,
--   "is_streaming": false,
--   "raw_events": [...]
-- }