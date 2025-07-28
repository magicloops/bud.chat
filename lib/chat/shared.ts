// Shared utilities for chat routes
// Common functions used by both new and existing chat routes

import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { Event, Segment } from '@/lib/types/events';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Helper function to generate a conversation title (async, non-blocking)
export async function generateConversationTitleInBackground(
  conversationId: string, 
  events: Event[], 
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  try {
    console.log('🏷️ Generating title for conversation:', conversationId);
    
    // Only generate title if we have enough events (user + assistant)
    if (events.length < 2) return;
    
    // Create a prompt for title generation using the event context
    const conversationContext = events
      .filter(event => event.role !== 'system')
      .slice(0, 4) // Use first few events
      .map(event => {
        const textContent = event.segments
          .filter((s: Segment) => s.type === 'text')
          .map((s: Segment) => s.type === 'text' ? (s as { type: 'text'; text: string }).text : '')
          .join('');
        return `${event.role}: ${textContent}`;
      })
      .join('\\n');

    const titlePrompt = `Based on this conversation, generate a concise title (3-6 words maximum) that captures the main topic or question:

${conversationContext}

Title:`;

    // Call OpenAI to generate the title
    const titleResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Use faster model for title generation
      messages: [{ role: 'user', content: titlePrompt }],
      max_tokens: 20,
      temperature: 0.7,
    });

    const generatedTitle = titleResponse.choices[0]?.message?.content?.trim();

    if (generatedTitle) {
      const cleanTitle = generatedTitle
        .replace(/^[\"']|[\"']$/g, '') // Remove surrounding quotes
        .slice(0, 60) // Limit to 60 characters
        .trim();

      // Update the conversation with the generated title
      await supabase
        .from('conversations')
        .update({ title: cleanTitle })
        .eq('id', conversationId);

      console.log(`✅ Generated title for conversation ${conversationId}: "${cleanTitle}"`);
    }
  } catch (error) {
    console.error('❌ Error generating conversation title:', error);
  }
}

// Common validation for chat requests
export async function validateChatRequest(
  request: NextRequest,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  // Get the authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  const body = await request.json();
  
  return {
    user,
    body
  };
}

// Common error response formatting
export function createErrorResponse(message: string, status: number = 500) {
  return new Response(
    JSON.stringify({ error: message }),
    { 
      status, 
      headers: { 'Content-Type': 'application/json' } 
    }
  );
}

// Common streaming response headers
export const STREAMING_HEADERS = {
  'Content-Type': 'text/plain',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};