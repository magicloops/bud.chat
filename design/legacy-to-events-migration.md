# Legacy to Events Migration Plan

## Overview

This document outlines the complete migration from the legacy message-based system to the event-based architecture. The goal is to remove all legacy code while maintaining the same optimistic UI experience and ensuring zero downtime.

## Current State Analysis

### Legacy Components to Remove
- `/state/simpleChatStore.ts` - Legacy Zustand store
- `/lib/messageHelpers.ts` - Legacy message utilities
- `/app/(chat)/new/page.tsx` - Legacy new chat page
- `/app/(chat)/chat/[conversationId]/page.tsx` - Legacy conversation page
- `/app/api/chat-new/route.ts` - Legacy chat API (partially)
- `/components/ChatArea/` - Legacy chat components
- `/hooks/useEventChat.ts` - Can be consolidated with unified hook

### Event-Based Components (Keep)
- `/state/eventChatStore.ts` - Event-based Zustand store
- `/lib/eventMessageHelpers.ts` - Event message utilities
- `/lib/types/events.ts` - Core event types
- `/lib/providers/` - Provider mappers
- `@budchat/data` - Database repository layer
- `/components/EventMessage.tsx` - Event message components
- `/components/EventStream.tsx` - Event streaming components
- `/hooks/useUnifiedChat.ts` - Unified chat hook

## Migration Strategy

### Phase 1: Database Migration Verification
**Goal**: Ensure all legacy data is properly migrated to events

#### Tasks:
1. **Verify Data Migration**
   - [ ] Run migration scripts on production data
   - [ ] Verify all conversations have corresponding events
   - [ ] Check data integrity (no lost messages)
   - [ ] Validate tool call migrations

2. **Create Migration Report**
   ```bash
   # SQL query to check migration status
   SELECT 
     (SELECT COUNT(*) FROM messages) as legacy_messages,
     (SELECT COUNT(*) FROM events) as migrated_events,
     (SELECT COUNT(DISTINCT conversation_id) FROM messages) as legacy_conversations,
     (SELECT COUNT(DISTINCT conversation_id) FROM events) as event_conversations;
   ```

3. **Backup Legacy Data**
   - [ ] Create backup of messages table
   - [ ] Document rollback procedures
   - [ ] Test data recovery process

### Phase 2: API Migration
**Goal**: Update all API endpoints to use event-based system

#### Tasks:
1. **Update Chat API** (`/app/api/chat-new/route.ts`)
   - [ ] Remove legacy message creation code
   - [ ] Update to use event-based persistence
   - [ ] Maintain streaming response format for compatibility
   - [ ] Remove message-specific streaming logic

2. **Update Conversation API** (`/app/api/conversations/[id]/route.ts`)
   - [ ] Return events instead of messages
   - [ ] Update response format to match event structure
   - [ ] Remove legacy message queries
   - [ ] Update caching logic

3. **Create Event-Only Endpoints**
   - [ ] `/api/conversations/[id]/events` - Already exists
   - [ ] `/api/events/` - Direct event manipulation
   - [ ] Remove `/api/messages/` endpoints

#### API Response Format Changes:
```typescript
// Before (Legacy)
{
  id: string,
  messages: Message[],
  title: string,
  // ...
}

// After (Events)
{
  id: string,
  events: Event[],
  title: string,
  // ...
}
```

### Phase 3: Frontend Migration
**Goal**: Replace all legacy components with event-based equivalents

#### Tasks:
1. **Replace Page Components**
   - [ ] Replace contents of `/app/(chat)/new/page.tsx` with `page-events.tsx` code
   - [ ] Replace contents of `/app/(chat)/chat/[conversationId]/page.tsx` with `page-events.tsx` code
   - [ ] Keep original filenames (Next.js App Router requirement)

2. **Replace Chat Components**
   - [ ] Remove `/components/ChatArea/` directory
   - [ ] Update imports to use `EventStream` and `EventMessage`
   - [ ] Remove legacy message-specific components

3. **Update State Management**
   - [ ] Replace `simpleChatStore.ts` with `eventChatStore.ts`
   - [ ] Update all component imports
   - [ ] Remove legacy store exports

4. **Update Hooks**
   - [ ] Remove legacy hooks from components
   - [ ] Use `useUnifiedChat` or direct event hooks
   - [ ] Remove `useEventChat.ts` (consolidated into unified hook)

#### Component Mapping:
```typescript
// Legacy → Event-based
useSimpleChatStore → useEventChatStore
useConversation → useEventConversation
useSelectedWorkspace → useEventSelectedWorkspace
ChatArea → EventStream + EventMessage
Message → Event
```

### Phase 4: Event Schema Optimization
**Goal**: Optimize event schema for production use (keep legacy tables for rollback)

#### Tasks:
1. **Optimize Event Schema**
   - [ ] Add performance indexes on events table
   - [ ] Optimize JSONB queries for segments
   - [ ] Update RLS policies for events-only access
   - [ ] Analyze query performance and add needed indexes

2. **Update Database Types**
   - [ ] Regenerate TypeScript types to include events
   - [ ] Keep legacy message types for rollback compatibility
   - [ ] Update primary imports to use event types

3. **Performance Monitoring**
   - [ ] Set up event table monitoring
   - [ ] Create performance dashboards
   - [ ] Establish baseline metrics

#### Migration SQL:
```sql
-- Optimize events table performance
CREATE INDEX CONCURRENTLY idx_events_conversation_ts ON events(conversation_id, ts);
CREATE INDEX CONCURRENTLY idx_events_segments_gin ON events USING gin (segments jsonb_path_ops);
CREATE INDEX CONCURRENTLY idx_events_role_ts ON events(role, ts);

-- Add monitoring for legacy tables (keep for rollback)
-- Note: Legacy tables (messages, message_revisions) kept until post-deployment
```

### Phase 5: Code Cleanup
**Goal**: Remove all legacy code and dependencies

#### Tasks:
1. **Remove Legacy Files**
   - [ ] Delete `/state/simpleChatStore.ts`
   - [ ] Delete `/lib/messageHelpers.ts`
   - [ ] Delete `/app/(chat)/new/page.tsx`
   - [ ] Delete `/app/(chat)/chat/[conversationId]/page.tsx`
   - [ ] Delete `/components/ChatArea/` directory
   - [ ] Delete `/hooks/useEventChat.ts`

2. **Update Imports**
   - [ ] Find and replace all legacy imports
   - [ ] Update component references
   - [ ] Remove unused utility functions

3. **Clean Up Event Files**
   - [ ] Remove `page-events.tsx` files (content moved to `page.tsx`)
   - [ ] Rename `eventChatStore.ts` to `chatStore.ts` 
   - [ ] Rename `eventMessageHelpers.ts` to `messageHelpers.ts`
   - [ ] Update imports after renaming

4. **Update Documentation**
   - [ ] Update README.md
   - [ ] Update API documentation
   - [ ] Update component documentation
   - [ ] Update CLAUDE.md with new patterns

#### Find/Replace Operations:
```bash
# Remove legacy imports
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/simpleChatStore/chatStore/g'
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/messageHelpers/eventMessageHelpers/g'

# Update component references
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/ChatArea/EventStream/g'
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/useConversation/useEventConversation/g'
```

### Phase 6: Post-Deployment Database Cleanup
**Goal**: Remove legacy tables after successful deployment and monitoring period

#### Tasks:
1. **Monitor Production Stability**
   - [ ] Monitor event system for 1-2 weeks post-deployment
   - [ ] Verify no rollback scenarios needed
   - [ ] Confirm all functionality working correctly
   - [ ] Check error rates and performance metrics

2. **Final Database Cleanup**
   - [ ] Create final backup of legacy tables
   - [ ] Drop `messages` table
   - [ ] Drop `message_revisions` table (if exists)
   - [ ] Remove legacy indexes
   - [ ] Clean up any legacy triggers or functions

3. **Final Type Cleanup**
   - [ ] Remove legacy message types from TypeScript
   - [ ] Update database type generation
   - [ ] Remove any remaining legacy imports
   - [ ] Update documentation to remove legacy references

#### Final Cleanup SQL:
```sql
-- Final backup before deletion
CREATE TABLE messages_final_backup AS SELECT * FROM messages;
CREATE TABLE message_revisions_final_backup AS SELECT * FROM message_revisions;

-- Drop legacy tables (only after successful deployment monitoring)
DROP TABLE IF EXISTS message_revisions;
DROP TABLE IF EXISTS messages;

-- Clean up any legacy functions or triggers
DROP FUNCTION IF EXISTS update_message_updated_at();
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
```

## Testing Strategy

### Phase 1: Parallel Testing
- [ ] Run both systems in parallel
- [ ] Compare outputs for accuracy
- [ ] Verify optimistic UI behavior
- [ ] Test streaming functionality

### Phase 2: Canary Deployment
- [ ] Enable events for 10% of users
- [ ] Monitor error rates and performance
- [ ] Verify data consistency
- [ ] Test rollback procedures

### Phase 3: Full Migration
- [ ] Enable events for all users
- [ ] Monitor system health
- [ ] Remove legacy fallbacks
- [ ] Clean up unused code

### Critical Test Cases
1. **Optimistic UI Flow**
   - [ ] `/chat/new` → streaming → navigation to `/chat/[id]`
   - [ ] Zero flash during transition
   - [ ] Proper state preservation

2. **Tool Calling**
   - [ ] MCP tool execution
   - [ ] Tool call/result pairing
   - [ ] Streaming tool updates

3. **Data Persistence**
   - [ ] Events saved correctly
   - [ ] Proper order maintenance
   - [ ] Conversation metadata

4. **Error Handling**
   - [ ] Network failures
   - [ ] Streaming interruptions
   - [ ] Database errors

## Rollback Plan

### Immediate Rollback (< 1 hour)
1. **Feature Flag Revert**
   - [ ] Disable event system via environment variable
   - [ ] Route traffic back to legacy system
   - [ ] Monitor system recovery

2. **Database Rollback**
   - [ ] Restore messages table from backup
   - [ ] Verify data integrity
   - [ ] Update application connections

### Extended Rollback (1-24 hours)
1. **Code Revert**
   - [ ] Git revert to last stable commit
   - [ ] Redeploy legacy system
   - [ ] Restore legacy endpoints

2. **Data Synchronization**
   - [ ] Sync any new events back to messages
   - [ ] Verify no data loss
   - [ ] Test legacy functionality

## Performance Considerations

### Expected Improvements
- **Reduced Complexity**: ~60% fewer lines of code
- **Better Streaming**: More efficient event-based streaming
- **Improved Tool Calls**: Cleaner tool execution logic
- **Vendor Agnostic**: Single implementation for all providers

### Monitoring Metrics
- [ ] API response times
- [ ] Database query performance
- [ ] Memory usage patterns
- [ ] Error rates

### Optimization Targets
- [ ] Event query performance
- [ ] JSONB segment queries
- [ ] Realtime subscription efficiency
- [ ] Frontend rendering performance

## Timeline

### Week 1: Preparation
- [ ] Verify data migration
- [ ] Create test plans
- [ ] Set up monitoring

### Week 2: API Migration
- [ ] Update backend endpoints
- [ ] Test API compatibility
- [ ] Performance testing

### Week 3: Frontend Migration
- [ ] Replace page.tsx contents with event-based code
- [ ] Update state management
- [ ] Integration testing

### Week 4: Event Schema Optimization
- [ ] Add performance indexes
- [ ] Optimize queries
- [ ] Performance testing

### Week 5: Deployment
- [ ] Canary rollout
- [ ] Monitor metrics
- [ ] Full deployment

### Week 6: Code Cleanup
- [ ] Remove legacy code
- [ ] Update documentation
- [ ] Performance optimization

### Week 7-8: Post-Deployment Monitoring
- [ ] Monitor production stability
- [ ] Verify no rollback needed
- [ ] Prepare for final database cleanup

### Week 9: Final Database Cleanup
- [ ] Remove legacy tables
- [ ] Final type cleanup
- [ ] Complete documentation update

## Success Criteria

### Functional Requirements
- [ ] All existing functionality preserved
- [ ] Optimistic UI experience maintained
- [ ] Tool calling works correctly
- [ ] Data persistence reliable

### Performance Requirements
- [ ] No regression in response times
- [ ] Improved streaming performance
- [ ] Reduced memory usage
- [ ] Better error handling

### Quality Requirements
- [ ] 60% reduction in code complexity
- [ ] Improved maintainability
- [ ] Better test coverage
- [ ] Comprehensive documentation

## Risk Mitigation

### High Risk: Data Loss
- **Mitigation**: Comprehensive backups and testing
- **Detection**: Automated data integrity checks
- **Response**: Immediate rollback procedures

### Medium Risk: Performance Degradation
- **Mitigation**: Load testing and monitoring
- **Detection**: Performance metrics tracking
- **Response**: Optimization or rollback

### Low Risk: UI Regression
- **Mitigation**: Visual regression testing
- **Detection**: User feedback and monitoring
- **Response**: Quick fixes or rollback

## Post-Migration Benefits

### For Developers
- **Simplified Architecture**: Single event-based system
- **Better Debugging**: Complete event history
- **Easier Testing**: Deterministic event replay
- **Vendor Agnostic**: No provider-specific code

### For Users
- **Consistent Experience**: Same tool calling across providers
- **Better Performance**: More efficient streaming
- **Reliable Persistence**: No lost tool information
- **Rich History**: Complete interaction timeline

### For Operations
- **Reduced Complexity**: Fewer moving parts
- **Better Monitoring**: Unified event tracking
- **Easier Scaling**: Event-based architecture
- **Cost Optimization**: More efficient resource usage

## Conclusion

This migration will transform the codebase from a complex, vendor-specific system to a clean, event-driven architecture while maintaining the excellent user experience. The careful phased approach ensures minimal risk while maximizing the benefits of the new system.

The event-based system represents a significant improvement in code quality, maintainability, and user experience while providing a solid foundation for future enhancements.
