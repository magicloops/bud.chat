import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export interface BudConfig {
  name: string
  avatar?: string
  systemPrompt: string
  model: string
  temperature?: number
  maxTokens?: number
  greeting?: string
  tools?: string[]
}

export interface CreateBudRequest {
  name: string
  config: BudConfig
  workspaceId: string
  isPublic?: boolean
}

// GET /api/buds - Get buds for a workspace
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required' },
        { status: 400 }
      );
    }

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user has access to the workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return NextResponse.json(
        { error: 'Access denied to workspace' },
        { status: 403 }
      );
    }

    // Get buds for the workspace
    const { data: buds, error: budsError } = await supabase
      .from('buds')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (budsError) {
      console.error('Error fetching buds:', budsError);
      return NextResponse.json(
        { error: 'Failed to fetch buds' },
        { status: 500 }
      );
    }

    return NextResponse.json({ buds });
  } catch (error) {
    console.error('GET /api/buds error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/buds - Create a new bud
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body: CreateBudRequest = await request.json();

    const { name, config, workspaceId } = body;

    if (!name || !config || !workspaceId) {
      return NextResponse.json(
        { error: 'name, config, and workspaceId are required' },
        { status: 400 }
      );
    }

    if (!config.systemPrompt || !config.model) {
      return NextResponse.json(
        { error: 'config.systemPrompt and config.model are required' },
        { status: 400 }
      );
    }

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user has access to the workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return NextResponse.json(
        { error: 'Access denied to workspace' },
        { status: 403 }
      );
    }

    // Extract MCP config from the main config
    const { mcpConfig, ...budConfig } = config;
    
    // Create the bud
    const { data: bud, error: createError } = await supabase
      .from('buds')
      .insert({
        name,
        default_json: budConfig,
        mcp_config: mcpConfig || {},
        workspace_id: workspaceId,
        owner_user_id: user.id
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating bud:', createError);
      return NextResponse.json(
        { error: 'Failed to create bud' },
        { status: 500 }
      );
    }

    return NextResponse.json({ bud }, { status: 201 });
  } catch (error) {
    console.error('POST /api/buds error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}