// New Chat Adapter - handles conversation creation and batch event saving
// Used by /api/chat-new/route.ts

import { ChatEngineConfig } from './types';
import { Event } from '@/lib/types/events';
import { createClient } from '@/lib/supabase/server';
import { generateConversationTitleInBackground } from './shared';
import { generateKeyBetween } from 'fractional-indexing';

export class NewChatAdapter {
  static createConfig(): ChatEngineConfig {
    return {
      eventLoader: undefined, // No existing events to load
      eventSaver: undefined,  // No individual saving during streaming
      batchEventSaver: async (_events: Event[], _conversationId: string) => {
        // This gets called after conversation creation
        // Events are already saved in createConversationInBackground
        console.log('✅ NewChatAdapter: Events already saved during conversation creation');
      },
      conversationCreator: async (events: Event[], workspaceId: string, budId?: string) => {
        return await createConversationInBackground(events, workspaceId, budId);
      },
      titleGenerator: async (conversationId: string, events: Event[]) => {
        const supabase = await createClient();
        await generateConversationTitleInBackground(conversationId, events, supabase);
      },
      streamingMode: 'batch'
    };
  }
}

// Helper function to create conversation in background with batch event saving
async function createConversationInBackground(
  events: Event[],
  workspaceId: string,
  budId?: string
): Promise<string> {
  const supabase = await createClient();
  
  try {
    console.log('💾 Creating conversation in background...');
    console.log('📋 Events received for saving:', events.length);
    console.log('📋 Event IDs being saved:', events.map(e => ({ id: e.id, role: e.role })));
    
    // Fetch bud if budId is provided
    let bud = null;
    if (budId) {
      const { data, error } = await supabase
        .from('buds')
        .select('*')
        .eq('id', budId)
        .single();
      
      if (data && !error) {
        bud = data;
      }
    }
    
    // Create conversation with bud configuration as overrides
    // This preserves the bud's settings at conversation creation time
    const budConfig = bud?.default_json;
    const modelConfigOverrides = budConfig ? {
      model: budConfig.model,
      systemPrompt: budConfig.systemPrompt,
      temperature: budConfig.temperature,
      maxTokens: budConfig.maxTokens,
      assistantName: budConfig.name,
      avatar: budConfig.avatar
    } : undefined;
    
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        source_bud_id: budId,
        // Only store assistant name/avatar if they're explicitly overridden
        // Otherwise, let the frontend derive them from the bud configuration
        assistant_name: null,
        assistant_avatar: null,
        model_config_overrides: modelConfigOverrides,
        mcp_config_overrides: budConfig?.mcpConfig,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (convError || !conversation) {
      throw new Error('Failed to create conversation');
    }

    // Save all events to database
    const eventInserts = [];
    const seenIds = new Set<string>();
    let previousOrderKey: string | null = null;
    
    for (const event of events) {
      const orderKey = generateKeyBetween(previousOrderKey, null);
      previousOrderKey = orderKey;
      
      // Check for duplicate IDs within this batch
      if (seenIds.has(event.id)) {
        console.error('🚨 DUPLICATE ID DETECTED within batch:', event.id);
      }
      seenIds.add(event.id);
      
      eventInserts.push({
        id: event.id,
        conversation_id: conversation.id,
        role: event.role,
        segments: event.segments,
        ts: event.ts,
        order_key: orderKey,
        reasoning: event.reasoning || null,
        created_at: new Date().toISOString()
      });
    }

    if (eventInserts.length > 0) {
      console.log('💾 About to insert events:', eventInserts.length);
      console.log('💾 Event insert details:', eventInserts.map(e => ({ id: e.id, role: e.role, order_key: e.order_key })));
      
      // Check if any of these event IDs already exist in the database
      const eventIds = eventInserts.map(e => e.id);
      const { data: existingEvents } = await supabase
        .from('events')
        .select('id')
        .in('id', eventIds);
      
      if (existingEvents && existingEvents.length > 0) {
        console.error('🚨 FOUND EXISTING EVENTS in database:', existingEvents.map(e => e.id));
        console.error('🚨 Trying to insert:', eventIds);
        console.error('🚨 Conflicts:', existingEvents.map(e => e.id));
      }
      
      const { error: eventsError } = await supabase
        .from('events')
        .insert(eventInserts);

      if (eventsError) {
        console.error('❌ Error saving events:', eventsError);
        console.error('❌ Failed event IDs:', eventInserts.map(e => e.id));
        console.error('❌ Full error details:', JSON.stringify(eventsError, null, 2));
        throw new Error('Failed to save events');
      }
      
      console.log('✅ Successfully saved events to database');
    }

    console.log('✅ Conversation and events created:', conversation.id);
    
    // Generate title in background (fire and forget)
    generateConversationTitleInBackground(conversation.id, events, supabase)
      .catch(error => console.error('❌ Title generation failed:', error));

    return conversation.id;
  } catch (error) {
    console.error('❌ Background conversation creation failed:', error);
    throw error;
  }
}