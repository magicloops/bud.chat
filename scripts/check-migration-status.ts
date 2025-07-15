// Migration Status Checker
// Run this script to verify the current state of the legacy-to-events migration

import { createClient } from '@/lib/supabase/server'

interface MigrationStatus {
  legacy_messages: number
  migrated_events: number
  legacy_conversations: number
  event_conversations: number
  missing_events: number
  orphaned_events: number
  recent_activity: number
  data_consistency_issues: number
}

async function checkMigrationStatus(): Promise<MigrationStatus> {
  const supabase = await createClient()
  
  console.log('🔍 Checking migration status...\n')
  
  // 1. Basic counts
  const { data: basicCounts } = await supabase.rpc('get_migration_counts')
  
  // 2. Check for conversations without events
  const { count: missingEvents } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .not('id', 'in', `(${
      'SELECT DISTINCT conversation_id FROM events WHERE conversation_id IS NOT NULL'
    })`)
  
  // 3. Check for orphaned events
  const { count: orphanedEvents } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .not('conversation_id', 'in', `(${
      'SELECT id FROM conversations WHERE id IS NOT NULL'
    })`)
  
  // 4. Check recent activity (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recentActivity } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo)
  
  // 5. Check for data consistency issues
  const { count: consistencyIssues } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .or('segments.is.null,segments.eq.[]')
  
  return {
    legacy_messages: basicCounts?.legacy_messages || 0,
    migrated_events: basicCounts?.migrated_events || 0,
    legacy_conversations: basicCounts?.legacy_conversations || 0,
    event_conversations: basicCounts?.event_conversations || 0,
    missing_events: missingEvents || 0,
    orphaned_events: orphanedEvents || 0,
    recent_activity: recentActivity || 0,
    data_consistency_issues: consistencyIssues || 0
  }
}

async function printMigrationReport(status: MigrationStatus) {
  console.log('📊 MIGRATION STATUS REPORT')
  console.log('=' .repeat(50))
  
  console.log('\n📈 Data Counts:')
  console.log(`  Legacy Messages: ${status.legacy_messages.toLocaleString()}`)
  console.log(`  Migrated Events: ${status.migrated_events.toLocaleString()}`)
  console.log(`  Legacy Conversations: ${status.legacy_conversations.toLocaleString()}`)
  console.log(`  Event Conversations: ${status.event_conversations.toLocaleString()}`)
  
  console.log('\n🔍 Data Quality:')
  console.log(`  Missing Events: ${status.missing_events.toLocaleString()}`)
  console.log(`  Orphaned Events: ${status.orphaned_events.toLocaleString()}`)
  console.log(`  Consistency Issues: ${status.data_consistency_issues.toLocaleString()}`)
  
  console.log('\n📅 Recent Activity:')
  console.log(`  Events (Last 7 days): ${status.recent_activity.toLocaleString()}`)
  
  console.log('\n🚦 Migration Health:')
  const migrationRatio = status.legacy_messages > 0 ? (status.migrated_events / status.legacy_messages) * 100 : 0
  console.log(`  Migration Ratio: ${migrationRatio.toFixed(1)}%`)
  
  if (status.missing_events === 0 && status.orphaned_events === 0 && status.data_consistency_issues === 0) {
    console.log('  Status: ✅ HEALTHY - Ready for migration')
  } else {
    console.log('  Status: ⚠️  ISSUES DETECTED - Needs attention')
  }
  
  console.log('\n🔧 Recommendations:')
  if (status.missing_events > 0) {
    console.log(`  - Re-run migration for ${status.missing_events} conversations`)
  }
  if (status.orphaned_events > 0) {
    console.log(`  - Clean up ${status.orphaned_events} orphaned events`)
  }
  if (status.data_consistency_issues > 0) {
    console.log(`  - Fix ${status.data_consistency_issues} events with empty segments`)
  }
  if (status.missing_events === 0 && status.orphaned_events === 0 && status.data_consistency_issues === 0) {
    console.log('  - Migration data looks good! Ready to proceed with Phase 2.')
  }
}

async function main() {
  try {
    const status = await checkMigrationStatus()
    await printMigrationReport(status)
  } catch (error) {
    console.error('❌ Error checking migration status:', error)
    process.exit(1)
  }
}

// Run the check
main().catch(console.error)

export { checkMigrationStatus, printMigrationReport }