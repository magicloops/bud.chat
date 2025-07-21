import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { getConversationEvents, saveEvent } from '@/lib/db/events';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('🌿 Branch route hit!');
  try {
    const { id: originalConversationId } = await params;
    console.log('🌿 Original conversation ID:', originalConversationId);
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log('🌿 Auth check:', { user: !!user, authError: !!authError });
    if (authError || !user) {
      console.log('🌿 Returning 401 Unauthorized');
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    console.log('🌿 Request body:', body);
    const { branchPosition, branchMessage, title } = body;

    if (typeof branchPosition !== 'number' || branchPosition < 0) {
      console.log('🌿 Missing or invalid branchPosition');
      return new Response('branchPosition is required and must be a non-negative number', { status: 400 });
    }
    console.log('🌿 Branch from position:', branchPosition);

    // Validate branch message for additional verification (optional but helpful)
    if (!branchMessage || !branchMessage.role) {
      console.log('🌿 Missing branchMessage verification data');
      return new Response('branchMessage verification data is required', { status: 400 });
    }

    // Get original conversation and verify access
    console.log('🌿 Fetching original conversation...');
    
    // First check if conversation exists at all
    const { data: convCheck, error: checkError } = await supabase
      .from('conversations')
      .select('id, workspace_id')
      .eq('id', originalConversationId);
    
    console.log('🌿 Conversation check:', { 
      count: convCheck?.length, 
      checkError: checkError?.message,
      conversationId: originalConversationId 
    });
    
    const { data: originalConversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        *,
        workspace:workspace_id (
          id,
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', originalConversationId)
      .maybeSingle();
    
    console.log('🌿 Original conversation result:', { 
      found: !!originalConversation, 
      error: !!convError,
      convError: convError?.message 
    });

    if (convError || !originalConversation) {
      console.log('🌿 Conversation not found:', {
        convError: !!convError,
        originalConversation: !!originalConversation,
        convErrorMessage: convError?.message
      });
      return new Response('Conversation not found', { status: 404 });
    }

    // Check if user is a member of the workspace
    const isMember = originalConversation.workspace?.workspace_members?.some(
      (member) => member.user_id === user.id
    );
    if (!isMember) {
      console.log('🌿 Access denied - not a workspace member:', {
        userId: user.id,
        workspaceId: originalConversation.workspace?.id,
        members: originalConversation.workspace?.workspace_members?.map((m) => m.user_id)
      });
      return new Response('Access denied', { status: 403 });
    }

    // Create new conversation for the branch
    console.log('🌿 Creating new conversation...');
    const { data: newConversation, error: newConvError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: originalConversation.workspace_id,
        title: title || `🌱 ${originalConversation.title}`,
        metadata: originalConversation.metadata || {}
      })
      .select()
      .single();

    if (newConvError) {
      console.log('🌿 Error creating new conversation:', newConvError);
      return new Response('Error creating branched conversation', { status: 500 });
    }
    
    console.log('🌿 New conversation created:', newConversation.id);

    // Get all events for the conversation (already sorted by order_key)
    console.log('🌿 Fetching events...');
    const allEvents = await getConversationEvents(originalConversationId);
    
    console.log('🌿 Events fetched:', allEvents?.length || 0);

    // Events are already sorted by order_key from getConversationEvents
    const sortedEvents = allEvents;
    
    // Validate that branchPosition is within bounds
    if (branchPosition >= sortedEvents.length) {
      console.error('🌿 Branch position out of bounds:', {
        branchPosition,
        totalEvents: sortedEvents.length,
        maxValidPosition: sortedEvents.length - 1
      });
      return new Response('Branch position is out of bounds', { status: 400 });
    }
    
    // Get the event at the specified position
    const branchEventFromDB = sortedEvents[branchPosition];
    const eventText = branchEventFromDB.segments
      .filter(s => s.type === 'text')
      .map(s => s.text)
      .join('');
    
    console.log('🌿 Branch event at position', branchPosition, ':', {
      id: branchEventFromDB.id,
      role: branchEventFromDB.role,
      content_preview: eventText.substring(0, 50)
    });
    
    // Optional verification: check if the event matches what the frontend expects
    if (branchMessage.role !== branchEventFromDB.role) {
      console.warn('🌿 Role mismatch at branch position:', {
        expected: branchMessage.role,
        actual: branchEventFromDB.role,
        position: branchPosition
      });
      // Continue anyway - the position is authoritative
    }

    // Get events up to and including the branch point
    const relevantEvents = sortedEvents.slice(0, branchPosition + 1);
    
    console.log('Branch operation details:', {
      originalConversationId,
      branchPosition,
      branchEventId: branchEventFromDB.id,
      totalEvents: allEvents.length,
      branchEventRole: branchEventFromDB.role,
      chainLength: relevantEvents.length
    });
    
    console.log('Events to copy (ordered by order_key):', {
      eventsToCopy: relevantEvents.length,
      eventChain: relevantEvents.map(e => ({ id: e.id, role: e.role, order_key: e.order_key }))
    });

    // Initialize insertedEvents for return value
    const insertedEvents = [];

    // Copy events to new conversation, preserving the parent-child chain structure
    if (relevantEvents.length > 0) {
      try {
        for (const event of relevantEvents) {
          // Convert DatabaseEvent back to Event (remove database-specific fields)
          const eventToSave = {
            id: event.id,
            role: event.role,
            segments: event.segments,
            ts: event.ts
          };
          const savedEvent = await saveEvent(eventToSave, {
            conversationId: newConversation.id,
            orderKey: event.order_key
          });
          insertedEvents.push(savedEvent);
        }
        console.log('🌿 Events copied successfully, order preserved by order_key');
      } catch (insertError) {
        console.error('Error inserting branched events:', insertError);
        // Clean up the conversation if event copying fails
        await supabase
          .from('conversations')
          .delete()
          .eq('id', newConversation.id);
        
        return new Response('Error copying events to branched conversation', { status: 500 });
      }
    }

    const response = {
      branchedConversation: newConversation,
      originalConversation: originalConversationId,
      eventsCopied: relevantEvents.length,
      branchPosition: branchPosition, // The position that was branched from
      branchEventId: branchEventFromDB.id, // The actual DB event ID that was branched from
      totalEvents: allEvents?.length || 0,
      insertedEvents: insertedEvents // Return the new events with their IDs
    };
    console.log('🌿 Returning success response:', { eventsCopied: response.eventsCopied, newConvId: response.branchedConversation.id });
    return Response.json(response);
  } catch (error) {
    console.error('🌿 Branch conversation error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
