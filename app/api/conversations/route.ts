import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { saveEvent } from '@/lib/db/events';
import { createTextEvent } from '@/lib/types/events';
import { generateKeyBetween } from 'fractional-indexing';
import { Database } from '@/lib/types/database';
import { BudConfig } from '@/lib/types';

// Types for complex Supabase queries with joins
interface ConversationWithBuds {
  id: string;
  title: string | null;
  assistant_name: string | null;
  assistant_avatar: string | null;
  source_bud_id: string | null;
  buds: {
    id: string;
    default_json: Database['public']['Tables']['buds']['Row']['default_json'];
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const limitParam = searchParams.get('limit');
    const cursor = searchParams.get('cursor'); // ISO timestamp of last item's created_at
    // parse limit only if provided; when omitted, preserve legacy full-list behavior
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 100) : undefined;

    if (!workspaceId) {
      return new Response('workspace_id is required', { status: 400 });
    }

    // Check if user has access to workspace through membership
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      console.error('Membership check failed:', membershipError);
      return new Response('Workspace not found or access denied', { status: 404 });
    }

    // Base query
    let query = supabase
      .from('conversations')
      .select(`
        id,
        title,
        metadata,
        created_at,
        workspace_id,
        source_bud_id,
        assistant_name,
        assistant_avatar,
        model_config_overrides,
        buds:source_bud_id (
          id,
          default_json
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    // Apply keyset cursor if provided
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    // If limit specified, fetch limit+1 for has_more detection
    if (limit !== undefined) {
      query = query.limit(limit + 1);
    }

    const { data: conversations, error } = await query;

    if (error) {
      console.error('Error fetching conversations:', error);
      return new Response(`Error fetching conversations: ${error.message}`, { status: 500 });
    }

    // Compute effective assistant identity for each conversation
    let list = conversations || [];

    // If limited, trim to limit and compute paging
    let hasMore = false;
    if (limit !== undefined && list.length > limit) {
      hasMore = true;
      list = list.slice(0, limit);
    }

    const conversationsWithEffectiveIdentity = list.map(conversation => {
      let effectiveAssistantName = conversation.assistant_name;
      let effectiveAssistantAvatar = conversation.assistant_avatar;

      // If no custom name/avatar and there's a source bud, use bud defaults
      const budData = (conversation as unknown as ConversationWithBuds).buds;
      if ((!effectiveAssistantName || !effectiveAssistantAvatar) && budData) {
        const budConfig = budData.default_json as BudConfig | null;
        if (budConfig) {
          if (!effectiveAssistantName && budConfig.name) {
            effectiveAssistantName = budConfig.name;
          }
          if (!effectiveAssistantAvatar && budConfig.avatar) {
            effectiveAssistantAvatar = budConfig.avatar;
          }
        }
      }

      // Return conversation with effective identity, remove nested bud data
      const { buds: _buds, ...conversationData } = conversation;
      return {
        ...conversationData,
        effective_assistant_name: effectiveAssistantName || 'Assistant',
        effective_assistant_avatar: effectiveAssistantAvatar || '🤖'
      };
    });

    // When limit provided, return paginated response format
    if (limit !== undefined) {
      const nextCursor = hasMore && conversationsWithEffectiveIdentity.length > 0
        ? conversationsWithEffectiveIdentity[conversationsWithEffectiveIdentity.length - 1].created_at
        : undefined;
      return Response.json({ items: conversationsWithEffectiveIdentity, has_more: hasMore, next_cursor: nextCursor });
    }

    // Legacy response: return full array
    return Response.json(conversationsWithEffectiveIdentity);
  } catch (error) {
    console.error('Error in conversations GET:', error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, title: _title, systemPrompt, initialMessages } = body;

    if (!workspaceId) {
      return new Response('workspaceId is required', { status: 400 });
    }

    // Verify user is a member of the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return new Response('Workspace not found or access denied', { status: 404 });
    }

    // Create conversation
    const conversationData = {
      workspace_id: workspaceId
    };
    console.log('Creating conversation with data:', conversationData);
    
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert(conversationData)
      .select()
      .single();
    
    console.log('Created conversation:', conversation, 'Error:', convError);

    if (convError) {
      return new Response('Error creating conversation', { status: 500 });
    }

    // Add system event if provided
    if (systemPrompt) {
      try {
        const systemEvent = createTextEvent('system', systemPrompt);
        await saveEvent(systemEvent, {
          conversationId: conversation.id,
          orderKey: 'a0'
        });
      } catch (systemEventError) {
        console.error('Error creating system event:', systemEventError);
        // Don't fail the conversation creation for this
      }
    }

    // Add initial events if provided
    if (initialMessages && initialMessages.length > 0) {
      // Always use null for missing bound (not undefined)
      let lastOrderKey: string | null = systemPrompt ? 'a0' : null;
      
      for (const message of initialMessages) {
        try {
          const orderKey = generateKeyBetween(lastOrderKey, null);
          const event = createTextEvent(message.role, message.content);
          await saveEvent(event, {
            conversationId: conversation.id,
            orderKey: orderKey
          });
          lastOrderKey = orderKey;
        } catch (eventError) {
          console.error('Error creating initial event:', eventError);
          // Don't fail the conversation creation for this
        }
      }
    }

    return Response.json(conversation);
  } catch (_error) {
    return new Response('Internal server error', { status: 500 });
  }
}
