import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get workspaces where user is owner OR member
    
    // First: Get workspaces you own
    const { data: ownedWorkspaces, error: ownedError } = await supabase
      .from('workspaces')
      .select('id, name, owner_user_id, created_at')
      .eq('owner_user_id', user.id);

    if (ownedError) {
      console.error('Error fetching owned workspaces:', ownedError);
      return new Response(`Error fetching owned workspaces: ${ownedError.message}`, { status: 500 });
    }

    // Second: Get workspaces where you're a member
    const { data: memberWorkspaces, error: memberError } = await supabase
      .from('workspace_members')
      .select(`
        workspace_id,
        role,
        workspaces!inner (
          id,
          name,
          owner_user_id,
          created_at
        )
      `)
      .eq('user_id', user.id);

    if (memberError) {
      console.error('Error fetching member workspaces:', memberError);
      return new Response(`Error fetching member workspaces: ${memberError.message}`, { status: 500 });
    }

    // Combine and deduplicate
    const allWorkspaces = new Map();
    
    // Add owned workspaces
    ownedWorkspaces?.forEach(workspace => {
      allWorkspaces.set(workspace.id, workspace);
    });
    
    // Add member workspaces (skip if already owned)
    memberWorkspaces?.forEach(member => {
      const workspace = (member as any).workspaces;
      if (!allWorkspaces.has(workspace.id)) {
        allWorkspaces.set(workspace.id, workspace);
      }
    });

    const formattedWorkspaces = Array.from(allWorkspaces.values());

    return Response.json(formattedWorkspaces);
  } catch (error) {
    console.error('Error in workspaces GET:', error);
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
    const { name } = body;

    if (!name) {
      return new Response('name is required', { status: 400 });
    }

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .insert({
        name,
        owner_user_id: user.id
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating workspace:', error);
      return new Response(`Error creating workspace: ${error.message}`, { status: 500 });
    }

    // Create workspace membership for the owner
    const { error: membershipError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: 'owner'
      });

    if (membershipError) {
      console.error('Error creating workspace membership:', membershipError);
      // Don't fail workspace creation for this, but log it
    }

    return Response.json(workspace);
  } catch (error) {
    console.error('Error in workspaces POST:', error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
}