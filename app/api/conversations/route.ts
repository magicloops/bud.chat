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
      .from('conversation')
      .select(`
        id,
        title,
        created_at,
        updated_at,
        workspace_id
      `)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })

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
    const { workspaceId, title, systemPrompt } = body

    if (!workspaceId) {
      return new Response('workspaceId is required', { status: 400 })
    }

    // Verify user owns the workspace
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspace')
      .select('id, owner_id')
      .eq('id', workspaceId)
      .eq('owner_id', user.id)
      .single()

    if (workspaceError || !workspace) {
      return new Response('Workspace not found or access denied', { status: 404 })
    }

    // Create conversation
    const conversationData = {
      workspace_id: workspaceId,
      title: title || 'New Chat'
    }
    console.log('Creating conversation with data:', conversationData)
    
    const { data: conversation, error: convError } = await supabase
      .from('conversation')
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
        .from('message')
        .insert({
          convo_id: conversation.id,
          path: '1',
          role: 'system',
          content: systemPrompt,
          created_by: user.id
        })

      if (systemMsgError) {
        console.error('Error creating system message:', systemMsgError)
        // Don't fail the conversation creation for this
      }
    }

    // Add default assistant greeting for new conversations
    if (title === 'New Chat') {
      const { error: greetingError } = await supabase
        .from('message')
        .insert({
          convo_id: conversation.id,
          path: '1',
          role: 'assistant',
          content: 'Hello! How can I assist you today?',
          metadata: { model: 'greeting' },
          created_by: user.id
        })

      if (greetingError) {
        console.error('Error creating greeting message:', greetingError)
        // Don't fail the conversation creation for this
      }
    }

    return Response.json(conversation)
  } catch (error) {
    return new Response('Internal server error', { status: 500 })
  }
}