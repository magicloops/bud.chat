// New Chat API Route - Refactored to use ChatEngine with NewChatAdapter
// Handles creation of new conversations with batch event saving

import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { ChatEngine } from '@/lib/chat/ChatEngine';
import { NewChatAdapter } from '@/lib/chat/NewChatAdapter';
import { createErrorResponse, STREAMING_HEADERS } from '@/lib/chat/shared';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(request: NextRequest) {
  console.log('🚀 New Chat API called (refactored with ChatEngine)');
  
  try {
    const supabase = await createClient();
    
    // Parse request body
    const body = await request.json();
    const { 
      messages, 
      workspaceId,
      budId,
      model = 'gpt-4o'
    } = body;

    console.log('📥 Received request:', {
      messagesCount: messages?.length,
      workspaceId,
      budId,
      model
    });

    // Create chat engine with new chat configuration
    const engine = new ChatEngine(
      NewChatAdapter.createConfig(),
      supabase, 
      openai, 
      anthropic
    );
    
    // Process chat with shared engine
    const stream = await engine.processChat({
      messages,
      workspaceId,
      budId,
      model
    });

    return new Response(stream, {
      headers: STREAMING_HEADERS
    });

  } catch (error) {
    console.error('❌ New Chat API error:', error);
    
    // Return appropriate error response
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return createErrorResponse('Unauthorized', 401);
      }
      if (error.message === 'Messages are required') {
        return createErrorResponse('Messages are required', 400);
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