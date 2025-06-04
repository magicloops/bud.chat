import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get workspaces where user is a member
    const { data: membershipData, error: membershipError } = await supabase
      .from('workspace_members')
      .select(`
        workspace_id,
        role,
        workspace:workspace_id (
          id,
          name,
          owner_user_id,
          created_at
        )
      `)
      .eq('user_id', user.id)

    if (membershipError) {
      console.error('Error fetching workspace memberships:', membershipError)
      return new Response(`Error fetching workspaces: ${membershipError.message}`, { status: 500 })
    }

    // Extract workspaces from membership data
    const workspaces = membershipData?.map(m => m.workspace).filter(Boolean) || []

    return Response.json(workspaces)
  } catch (error) {
    console.error('Error in workspaces GET:', error)
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
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
      .from('workspaces')
      .insert({
        name,
        owner_user_id: user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating workspace:', error)
      return new Response(`Error creating workspace: ${error.message}`, { status: 500 })
    }

    // Create workspace membership for the owner
    const { error: membershipError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: 'owner'
      })

    if (membershipError) {
      console.error('Error creating workspace membership:', membershipError)
      // Don't fail workspace creation for this, but log it
    }

    return Response.json(workspace)
  } catch (error) {
    console.error('Error in workspaces POST:', error)
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
}