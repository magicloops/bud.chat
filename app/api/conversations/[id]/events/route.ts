import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { getConversationEvents } from '@/lib/db/events';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get conversation details to check permissions
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, workspace_id, source_bud_id, title, created_at')
      .eq('id', conversationId)
      .single();

    if (conversationError || !conversation) {
      return new Response('Conversation not found', { status: 404 });
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', conversation.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return new Response('Access denied', { status: 403 });
    }

    // Get events for this conversation
    const events = await getConversationEvents(conversationId);

    // Get bud configuration if available
    let budConfig = null;
    if (conversation.source_bud_id) {
      const { data: bud } = await supabase
        .from('buds')
        .select('default_json')
        .eq('id', conversation.source_bud_id)
        .single();
      
      budConfig = bud?.default_json;
    }

    return Response.json({
      id: conversation.id,
      title: conversation.title,
      workspace_id: conversation.workspace_id,
      source_bud_id: conversation.source_bud_id,
      created_at: conversation.created_at,
      events,
      bud_config: budConfig,
      // Add effective identity for UI
      effective_assistant_name: budConfig?.name || 'Assistant',
      effective_assistant_avatar: budConfig?.avatar || '🤖'
    });

  } catch (error) {
    console.error('Error fetching conversation events:', error);
    return new Response('Internal server error', { status: 500 });
  }
}