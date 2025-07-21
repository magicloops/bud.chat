-- Migration Verification Script
-- This script checks the status of the legacy-to-events migration

-- 1. Check migration status
SELECT 
  'Migration Status' as check_type,
  (SELECT COUNT(*) FROM messages) as legacy_messages,
  (SELECT COUNT(*) FROM events) as migrated_events,
  (SELECT COUNT(DISTINCT conversation_id) FROM messages) as legacy_conversations,
  (SELECT COUNT(DISTINCT conversation_id) FROM events) as event_conversations;

-- 2. Check for conversations with missing events
SELECT 
  'Missing Events' as check_type,
  COUNT(*) as conversations_without_events
FROM conversations c
LEFT JOIN events e ON c.id = e.conversation_id
WHERE e.conversation_id IS NULL;

-- 3. Check for conversations with both messages and events
SELECT 
  'Dual Coverage' as check_type,
  COUNT(*) as conversations_with_both
FROM conversations c
WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
  AND EXISTS (SELECT 1 FROM events e WHERE e.conversation_id = c.id);

-- 4. Check event types distribution
SELECT 
  'Event Types' as check_type,
  role,
  COUNT(*) as event_count
FROM events
GROUP BY role
ORDER BY event_count DESC;

-- 5. Check for events with tool calls
SELECT 
  'Tool Calls' as check_type,
  COUNT(*) as events_with_tool_calls
FROM events
WHERE segments @> '[{"type": "tool_call"}]';

-- 6. Check for events with tool results
SELECT 
  'Tool Results' as check_type,
  COUNT(*) as events_with_tool_results
FROM events
WHERE segments @> '[{"type": "tool_result"}]';

-- 7. Check for orphaned events (events without conversations)
SELECT 
  'Orphaned Events' as check_type,
  COUNT(*) as orphaned_events
FROM events e
LEFT JOIN conversations c ON e.conversation_id = c.id
WHERE c.id IS NULL;

-- 8. Check average events per conversation
SELECT 
  'Events Per Conversation' as check_type,
  ROUND(AVG(event_count), 2) as avg_events_per_conversation,
  MIN(event_count) as min_events,
  MAX(event_count) as max_events
FROM (
  SELECT conversation_id, COUNT(*) as event_count
  FROM events
  GROUP BY conversation_id
) stats;

-- 9. Check recent activity (last 7 days)
SELECT 
  'Recent Activity' as check_type,
  COUNT(*) as recent_events
FROM events
WHERE created_at > NOW() - INTERVAL '7 days';

-- 10. Check for potential data inconsistencies
SELECT 
  'Data Consistency' as check_type,
  COUNT(*) as events_with_empty_segments
FROM events
WHERE segments = '[]'::jsonb OR segments IS NULL;

-- 11. Sample event structure
SELECT 
  'Sample Event' as check_type,
  id,
  role,
  segments,
  ts,
  created_at
FROM events
ORDER BY created_at DESC
LIMIT 3;

-- 12. Check workspace distribution
SELECT 
  'Workspace Distribution' as check_type,
  c.workspace_id,
  COUNT(DISTINCT c.id) as conversations,
  COUNT(e.id) as events
FROM conversations c
LEFT JOIN events e ON c.id = e.conversation_id
GROUP BY c.workspace_id
ORDER BY events DESC;