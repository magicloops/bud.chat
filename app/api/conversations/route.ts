import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspace_id')

    if (!workspaceId) {
      return new Response('workspace_id is required', { status: 400 })
    }

    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        id,
        created_at,
        workspace_id
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (error) {
      return new Response('Error fetching conversations', { status: 500 })
    }

    return Response.json(conversations)
  } catch (error) {
    return new Response('Internal server error', { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { workspaceId, title, systemPrompt, initialMessages } = body

    if (!workspaceId) {
      return new Response('workspaceId is required', { status: 400 })
    }

    // Verify user is a member of the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single()

    if (membershipError || !membership) {
      return new Response('Workspace not found or access denied', { status: 404 })
    }

    // Create conversation
    const conversationData = {
      workspace_id: workspaceId
    }
    console.log('Creating conversation with data:', conversationData)
    
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert(conversationData)
      .select()
      .single()
    
    console.log('Created conversation:', conversation, 'Error:', convError)

    if (convError) {
      return new Response('Error creating conversation', { status: 500 })
    }

    // Add system message if provided
    if (systemPrompt) {
      const { error: systemMsgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          order_key: 'a0',
          role: 'system',
          content: systemPrompt,
          json_meta: {}
        })

      if (systemMsgError) {
        console.error('Error creating system message:', systemMsgError)
        // Don't fail the conversation creation for this
      }
    }

    // Add initial messages if provided
    if (initialMessages && initialMessages.length > 0) {
      let lastOrderKey = systemPrompt ? 'a0' : undefined
      
      for (const message of initialMessages) {
        const { generateKeyAfter } = await import('fractional-indexing')
        const orderKey = generateKeyAfter(lastOrderKey)
        
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            order_key: orderKey,
            role: message.role,
            content: message.content,
            json_meta: message.metadata || {}
          })

        if (messageError) {
          console.error(`Error creating initial message:`, messageError)
          // Don't fail the conversation creation for this
        }
        
        lastOrderKey = orderKey
      }
    }

    return Response.json(conversation)
  } catch (error) {
    return new Response('Internal server error', { status: 500 })
  }
}