// Buds API - Using new abstractions
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AppError, ErrorCode, handleApiError } from '@/lib/errors';
import { WorkspaceId, toWorkspaceId, generateBudId } from '@budchat/events';
// import { BudId } from '@/lib/types/branded'; // Type not currently used
import { BudConfig, BuiltInToolsConfig } from '@/lib/types';

export interface CreateBudRequest {
  name: string
  config: BudConfig
  workspaceId: string
  isPublic?: boolean
  builtInToolsConfig?: BuiltInToolsConfig
}

// Helper to validate workspace membership
async function validateWorkspaceMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string
): Promise<WorkspaceId> {
  const { data: membership, error } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error || !membership) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Access denied to workspace',
      { statusCode: 403 }
    );
  }

  return toWorkspaceId(workspaceId);
}

// GET /api/buds - Get buds for a workspace
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');

    if (!workspaceId) {
      throw AppError.validation('workspaceId is required');
    }

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    // Validate workspace access
    const validatedWorkspaceId = await validateWorkspaceMembership(
      supabase,
      workspaceId,
      user.id
    );

    // Get buds for the workspace
    const { data: buds, error: budsError } = await supabase
      .from('buds')
      .select('*')
      .eq('workspace_id', validatedWorkspaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (budsError) {
      throw new AppError(
        ErrorCode.DB_QUERY_ERROR,
        'Failed to fetch buds',
        { originalError: budsError }
      );
    }

    return NextResponse.json({ buds });
    
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/buds - Create a new bud
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body: CreateBudRequest = await request.json();

    const { name, config, workspaceId, builtInToolsConfig } = body;

    // Validate required fields
    if (!name || !config || !workspaceId) {
      throw AppError.validation('name, config, and workspaceId are required');
    }

    if (!config.systemPrompt || !config.model) {
      throw AppError.validation('config.systemPrompt and config.model are required');
    }

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    // Validate workspace access
    const validatedWorkspaceId = await validateWorkspaceMembership(
      supabase,
      workspaceId,
      user.id
    );

    // Extract MCP config from the main config
    const { mcpConfig, ...budConfig } = config;
    
    // Create the bud with a generated ID
    const budId = generateBudId();
    const { data: bud, error: createError } = await supabase
      .from('buds')
      .insert({
        id: budId,
        name,
        default_json: budConfig,
        mcp_config: mcpConfig || {},
        builtin_tools_config: builtInToolsConfig || { enabled_tools: [], tool_settings: {} },
        workspace_id: validatedWorkspaceId,
        owner_user_id: user.id
      })
      .select()
      .single();

    if (createError) {
      throw new AppError(
        ErrorCode.DB_QUERY_ERROR,
        'Failed to create bud',
        { originalError: createError }
      );
    }

    return NextResponse.json({ bud }, { status: 201 });
    
  } catch (error) {
    return handleApiError(error);
  }
}
