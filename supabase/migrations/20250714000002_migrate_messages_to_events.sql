-- Migrate existing messages to events table
-- This migration converts the current messages table data to the new events format

-- Function to convert messages to events
CREATE OR REPLACE FUNCTION migrate_messages_to_events()
RETURNS void AS $$
DECLARE
  message_record RECORD;
  event_segments jsonb;
  tool_calls jsonb;
  tool_call jsonb;
  event_ts bigint;
BEGIN
  -- Loop through all messages
  FOR message_record IN 
    SELECT * FROM public.messages 
    ORDER BY conversation_id, order_key 
  LOOP
    -- Convert created_at to unix timestamp in milliseconds
    event_ts := EXTRACT(epoch FROM message_record.created_at) * 1000;
    
    -- Initialize segments array
    event_segments := '[]'::jsonb;
    
    -- Handle different message types
    CASE message_record.role
      WHEN 'system', 'user' THEN
        -- Simple text message
        IF message_record.content IS NOT NULL AND message_record.content != '' THEN
          event_segments := jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', message_record.content)
          );
        END IF;
        
      WHEN 'assistant' THEN
        -- Assistant message - may have text and tool calls
        
        -- Add text content if present
        IF message_record.content IS NOT NULL AND message_record.content != '' THEN
          event_segments := event_segments || jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', message_record.content)
          );
        END IF;
        
        -- Add tool calls if present in json_meta
        IF message_record.json_meta ? 'tool_calls' THEN
          tool_calls := message_record.json_meta->'tool_calls';
          
          -- Loop through tool calls
          FOR tool_call IN SELECT * FROM jsonb_array_elements(tool_calls)
          LOOP
            IF tool_call ? 'id' AND tool_call ? 'function' THEN
              event_segments := event_segments || jsonb_build_array(
                jsonb_build_object(
                  'type', 'tool_call',
                  'id', tool_call->>'id',
                  'name', tool_call->'function'->>'name',
                  'args', COALESCE(
                    (tool_call->'function'->>'arguments')::jsonb,
                    '{}'::jsonb
                  )
                )
              );
            END IF;
          END LOOP;
        END IF;
        
      WHEN 'tool' THEN
        -- Tool result message
        IF message_record.json_meta ? 'tool_call_id' THEN
          event_segments := jsonb_build_array(
            jsonb_build_object(
              'type', 'tool_result',
              'id', message_record.json_meta->>'tool_call_id',
              'output', jsonb_build_object('content', message_record.content)
            )
          );
        END IF;
        
      ELSE
        -- Unknown role, treat as text
        IF message_record.content IS NOT NULL AND message_record.content != '' THEN
          event_segments := jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', message_record.content)
          );
        END IF;
    END CASE;
    
    -- Only insert if we have segments
    IF jsonb_array_length(event_segments) > 0 THEN
      INSERT INTO public.events (
        id,
        conversation_id,
        role,
        segments,
        ts,
        order_key,
        created_at
      ) VALUES (
        message_record.id, -- Use same ID as original message
        message_record.conversation_id,
        message_record.role,
        event_segments,
        event_ts,
        message_record.order_key,
        message_record.created_at
      );
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Migration completed successfully';
END;
$$ LANGUAGE plpgsql;

-- Run the migration
SELECT migrate_messages_to_events();

-- Drop the migration function
DROP FUNCTION migrate_messages_to_events();

-- Verify migration results
DO $$
DECLARE
  message_count integer;
  event_count integer;
BEGIN
  SELECT COUNT(*) INTO message_count FROM public.messages;
  SELECT COUNT(*) INTO event_count FROM public.events;
  
  RAISE NOTICE 'Migration verification:';
  RAISE NOTICE 'Original messages: %', message_count;
  RAISE NOTICE 'Migrated events: %', event_count;
  
  IF event_count > 0 THEN
    RAISE NOTICE 'Migration appears successful';
  ELSE
    RAISE WARNING 'Migration may have failed - no events created';
  END IF;
END;
$$;

-- Add comment about migration
COMMENT ON TABLE public.events IS 'Event-based message storage for vendor-agnostic chat system. Migrated from messages table on 2025-07-14.';