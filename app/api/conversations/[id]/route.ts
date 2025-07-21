import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { getConversationEvents } from '@/lib/db/events';
import { Database } from '@/lib/types/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const { searchParams } = new URL(request.url);
    const includeEvents = searchParams.get('include_events') === 'true';

    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get conversation with workspace membership check and bud data
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        created_at,
        title,
        workspace_id,
        source_bud_id,
        assistant_name,
        assistant_avatar,
        model_config_overrides,
        mcp_config_overrides,
        buds:source_bud_id (
          id,
          default_json
        ),
        workspace:workspace_id (
          id,
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return new Response('Conversation not found', { status: 404 });
    }

    // Check if user is a member of the workspace  
    const workspace = conversation.workspace;
    const isMember = workspace?.workspace_members?.some(
      (member) => member.user_id === user.id
    );
    if (!isMember) {
      return new Response('Access denied', { status: 403 });
    }

    // Compute effective assistant identity
    let effectiveAssistantName = conversation.assistant_name;
    let effectiveAssistantAvatar = conversation.assistant_avatar;

    // If no custom name/avatar and there's a source bud, use bud defaults
    const buds = conversation.buds;
    if ((!effectiveAssistantName || !effectiveAssistantAvatar) && buds) {
      const budConfig = buds.default_json;
      if (!effectiveAssistantName && budConfig.name) {
        effectiveAssistantName = budConfig.name;
      }
      if (!effectiveAssistantAvatar && budConfig.avatar) {
        effectiveAssistantAvatar = budConfig.avatar;
      }
    }

    // Add effective identity to response
    // Destructure to exclude buds from response
    const { buds: _, ...conversationWithoutBuds } = conversation;
    const responseData = {
      ...conversationWithoutBuds,
      effective_assistant_name: effectiveAssistantName || 'Assistant',
      effective_assistant_avatar: effectiveAssistantAvatar || '🤖',
      // Include bud data for theme and other config access
      bud_config: buds?.default_json || null
    };

    // If events are requested, fetch them too
    if (includeEvents) {
      try {
        const events = await getConversationEvents(conversationId);
        
        // Events are already sorted by order_key
        return Response.json({
          ...responseData,
          events: events || []
        });
      } catch (eventsError) {
        console.error('Error fetching events:', eventsError);
        return new Response('Error fetching events', { status: 500 });
      }
    }

    return Response.json(responseData);
  } catch (error) {
    console.error('Get conversation error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const { title, assistant_name, assistant_avatar, model_config_overrides, mcp_config_overrides } = body;

    // Verify user has access through workspace membership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        workspace:workspace_id (
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return new Response('Conversation not found', { status: 404 });
    }

    // Check if user is a member of the workspace  
    const workspace = conversation.workspace;
    const isMember = workspace?.workspace_members?.some(
      (member) => member.user_id === user.id
    );
    if (!isMember) {
      return new Response('Access denied', { status: 403 });
    }

    // Prepare update data - only include fields that are not undefined
    const updateData: Partial<Database['public']['Tables']['conversations']['Update']> = {};
    if (title !== undefined) updateData.title = title;
    if (assistant_name !== undefined) updateData.assistant_name = assistant_name;
    if (assistant_avatar !== undefined) updateData.assistant_avatar = assistant_avatar;
    if (model_config_overrides !== undefined) updateData.model_config_overrides = model_config_overrides;
    if (mcp_config_overrides !== undefined) updateData.mcp_config_overrides = mcp_config_overrides;

    // Update conversation
    const { data: updatedConversation, error: updateError } = await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId)
      .select()
      .single();

    if (updateError) {
      console.error('Update conversation error:', updateError);
      return new Response('Error updating conversation', { status: 500 });
    }

    return Response.json(updatedConversation);
  } catch (error) {
    console.error('Update conversation error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Verify user has access through workspace membership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        workspace:workspace_id (
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      console.error('DELETE: Conversation lookup error:', convError, 'conversationId:', conversationId);
      return new Response('Conversation not found', { status: 404 });
    }

    // Check if user is a member of the workspace  
    const workspace = conversation.workspace;
    const isMember = workspace?.workspace_members?.some(
      (member) => member.user_id === user.id
    );
    if (!isMember) {
      return new Response('Access denied', { status: 403 });
    }

    // Delete events first, then conversation (no cascade delete configured)
    const { error: eventsDeleteError } = await supabase
      .from('events')
      .delete()
      .eq('conversation_id', conversationId);

    if (eventsDeleteError) {
      console.error('Error deleting events:', eventsDeleteError);
      return new Response(`Error deleting events: ${eventsDeleteError.message}`, { status: 500 });
    }

    // Now delete the conversation
    const { error: deleteError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (deleteError) {
      console.error('Delete conversation error details:', deleteError);
      return new Response(`Error deleting conversation: ${deleteError.message}`, { status: 500 });
    }

    return new Response('Conversation deleted successfully', { status: 200 });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
