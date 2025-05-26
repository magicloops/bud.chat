import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { data: workspaces, error } = await supabase
      .from('workspace')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return new Response('Error fetching workspaces', { status: 500 })
    }

    return Response.json(workspaces)
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
    const { name } = body

    if (!name) {
      return new Response('name is required', { status: 400 })
    }

    const { data: workspace, error } = await supabase
      .from('workspace')
      .insert({
        name,
        owner_id: user.id
      })
      .select()
      .single()

    if (error) {
      return new Response('Error creating workspace', { status: 500 })
    }

    return Response.json(workspace)
  } catch (error) {
    return new Response('Internal server error', { status: 500 })
  }
}