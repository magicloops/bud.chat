// Simple migration verification script
// Run with: node scripts/verify-migration.js

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMigration() {
  console.log('🔍 Checking migration status...\n');
  
  try {
    // 1. Basic counts
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true });
    
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true });
    
    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true });
    
    if (messagesError || eventsError || conversationsError) {
      throw new Error('Database query failed');
    }
    
    console.log('📊 DATA COUNTS:');
    console.log(`  Messages: ${messages?.length || 0}`);
    console.log(`  Events: ${events?.length || 0}`);
    console.log(`  Conversations: ${conversations?.length || 0}`);
    
    // 2. Check if events table has data
    const { data: sampleEvents, error: sampleError } = await supabase
      .from('events')
      .select('id, role, segments, conversation_id, created_at')
      .limit(5);
    
    if (sampleError) {
      throw new Error('Failed to fetch sample events');
    }
    
    console.log('\n📋 SAMPLE EVENTS:');
    if (sampleEvents && sampleEvents.length > 0) {
      sampleEvents.forEach((event, i) => {
        console.log(`  ${i + 1}. ${event.role} event with ${event.segments?.length || 0} segments`);
      });
    } else {
      console.log('  No events found');
    }
    
    // 3. Check for events with tool calls
    const { data: toolEvents, error: toolError } = await supabase
      .from('events')
      .select('id')
      .contains('segments', [{ type: 'tool_call' }])
      .limit(1);
    
    if (!toolError && toolEvents && toolEvents.length > 0) {
      console.log('\n🔧 TOOL CALLS: Found events with tool calls');
    } else {
      console.log('\n🔧 TOOL CALLS: No tool call events found');
    }
    
    // 4. Migration status
    console.log('\n🚦 MIGRATION STATUS:');
    const eventCount = events?.length || 0;
    const messageCount = messages?.length || 0;
    
    if (eventCount > 0) {
      console.log('  ✅ Events table has data');
      if (messageCount > 0) {
        console.log('  ⚠️  Legacy messages table still has data');
        console.log('  📝 This is expected during migration');
      }
      console.log('  🚀 Ready to proceed with Phase 2!');
    } else {
      console.log('  ❌ No events found - migration may not be complete');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkMigration();