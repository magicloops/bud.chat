// Existing Chat API Route - Refactored to use ChatEngine with ExistingChatAdapter  
// Handles continuing existing conversations with individual event saving

import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { ChatEngine } from '@/lib/chat/ChatEngine';
import { ExistingChatAdapter } from '@/lib/chat/ExistingChatAdapter';
import { createErrorResponse, STREAMING_HEADERS } from '@/lib/chat/shared';
import { createTextEvent } from '@/lib/types/events';
import { saveEvent } from '@/lib/db/events';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  console.log('🚀 Existing Chat API called (refactored with ChatEngine)');
  
  try {
    const supabase = await createClient();
    const resolvedParams = await params;
    const conversationId = resolvedParams.conversationId;
    
    // Parse request body
    const body = await request.json();
    const { 
      message, 
      workspaceId
    } = body;

    console.log('📥 Received request:', { 
      conversationId, 
      message: message?.substring(0, 50) + '...', 
      workspaceId
    });

    // Verify conversation exists and get model config
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, workspace_id, source_bud_id, model_config_overrides')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return createErrorResponse('Conversation not found', 404);
    }

    // Determine model from conversation -> bud -> default
    let model = 'gpt-4o'; // Default fallback
    
    // 1. Check if conversation has model override
    if (conversation.model_config_overrides?.model) {
      model = conversation.model_config_overrides.model;
      console.log('🎯 Using conversation model override:', model);
    } else if (conversation.source_bud_id) {
      // 2. Check bud's default model
      const { data: bud } = await supabase
        .from('buds')
        .select('default_json')
        .eq('id', conversation.source_bud_id)
        .single();
        
      if (bud?.default_json?.model) {
        model = bud.default_json.model;
        console.log('🎯 Using bud model:', model);
      } else {
        console.log('🎯 Using default model:', model);
      }
    } else {
      console.log('🎯 Using default model (no bud):', model);
    }

    // Save user message to database before processing
    const userEvent = createTextEvent('user', message);
    await saveEvent(userEvent, { conversationId });
    console.log('💾 User event saved to database');

    // Create chat engine with existing chat configuration
    const engine = new ChatEngine(
      ExistingChatAdapter.createConfig(conversationId),
      supabase, 
      openai, 
      anthropic
    );
    
    // Process chat with shared engine
    const stream = await engine.processChat({
      message, // Single message for existing conversations
      workspaceId: conversation.workspace_id,
      budId: conversation.source_bud_id,
      model,
      conversationId
    });

    return new Response(stream, {
      headers: STREAMING_HEADERS
    });

  } catch (error) {
    console.error('❌ Existing Chat API error:', error);
    
    // Return appropriate error response
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return createErrorResponse('Unauthorized', 401);
      }
      if (error.message === 'Message is required') {
        return createErrorResponse('Message is required', 400);
      }
      if (error.message === 'Workspace ID is required') {
        return createErrorResponse('Workspace ID is required', 400);
      }
      if (error.message === 'Workspace not found or access denied') {
        return createErrorResponse('Workspace not found or access denied', 404);
      }
    }
    
    return createErrorResponse('Internal server error', 500);
  }
}