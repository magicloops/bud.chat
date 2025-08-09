// Bud management API - Using new abstractions
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AppError, ErrorCode, handleApiError } from '@/lib/errors';
import { BudId, toBudId } from '@/lib/types/branded';
import { BudConfig, Bud, BuiltInToolsConfig } from '@/lib/types';
import { Database } from '@/lib/types/database';

export interface UpdateBudRequest {
  name?: string
  config?: Partial<BudConfig>
  builtInToolsConfig?: BuiltInToolsConfig
}

// Helper to get bud with access check
async function getBudWithAccessCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  budId: BudId,
  userId: string
): Promise<{ bud: Bud; membership: { role: string } }> {
  // Get the bud with workspace info
  const { data: bud, error: budError } = await supabase
    .from('buds')
    .select(`
      *,
      workspaces!inner(id)
    `)
    .eq('id', budId)
    .is('deleted_at', null)
    .single();

  if (budError || !bud) {
    throw AppError.notFound('Bud');
  }

  // Check workspace membership
  const { data: membership, error: memberError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', bud.workspace_id)
    .eq('user_id', userId)
    .single();

  if (memberError || !membership) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Access denied',
      { statusCode: 403 }
    );
  }

  return { bud: bud as Bud, membership };
}

// GET /api/buds/[id] - Get a specific bud
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const budId = toBudId(id);

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    // Get bud with access check
    const { bud } = await getBudWithAccessCheck(supabase, budId, user.id);

    return NextResponse.json({ bud });
    
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT /api/buds/[id] - Update a bud
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const budId = toBudId(id);
    const body: UpdateBudRequest = await request.json();

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    // Get bud with access check
    const { bud: existingBud, membership } = await getBudWithAccessCheck(
      supabase, 
      budId, 
      user.id
    );

    // Only owner or admin can edit
    if (existingBud.owner_user_id !== user.id && membership.role !== 'admin') {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the owner or workspace admin can edit this bud',
        { statusCode: 403 }
      );
    }

    // Prepare update data
    const updateData: Partial<Database['public']['Tables']['buds']['Update']> = {};
    
    if (body.name) {
      updateData.name = body.name;
    }
    
    if (body.config) {
      // Extract MCP config from the update
      const fullConfig = body.config as BudConfig;
      const { mcpConfig, ...budConfig } = fullConfig;
      
      // Merge with existing config (excluding MCP config)
      const currentConfig = existingBud.default_json;
      updateData.default_json = { 
        ...currentConfig, 
        ...budConfig 
      } as unknown as Database['public']['Tables']['buds']['Update']['default_json'];
      
      // Update MCP config separately if provided
      if (mcpConfig !== undefined) {
        updateData.mcp_config = mcpConfig as unknown as Database['public']['Tables']['buds']['Update']['mcp_config'];
      }
    }
    
    // Update built-in tools config if provided
    if (body.builtInToolsConfig !== undefined) {
      updateData.builtin_tools_config = body.builtInToolsConfig as unknown as Database['public']['Tables']['buds']['Update']['builtin_tools_config'];
    }

    // Update the bud
    const { data: updatedBud, error: updateError } = await supabase
      .from('buds')
      .update(updateData)
      .eq('id', budId)
      .select()
      .single();

    if (updateError) {
      throw new AppError(
        ErrorCode.DB_QUERY_ERROR,
        'Failed to update bud',
        { originalError: updateError }
      );
    }

    return NextResponse.json({ bud: updatedBud });
    
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/buds/[id] - Delete a bud
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const budId = toBudId(id);

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    // Get bud with access check
    const { bud: existingBud, membership } = await getBudWithAccessCheck(
      supabase, 
      budId, 
      user.id
    );

    // Only owner or admin can delete
    if (existingBud.owner_user_id !== user.id && membership.role !== 'admin') {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the owner or workspace admin can delete this bud',
        { statusCode: 403 }
      );
    }

    // Soft delete the bud
    const { error: deleteError } = await supabase
      .from('buds')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', budId);

    if (deleteError) {
      throw new AppError(
        ErrorCode.DB_QUERY_ERROR,
        'Failed to delete bud',
        { originalError: deleteError }
      );
    }

    return NextResponse.json({ success: true });
    
  } catch (error) {
    return handleApiError(error);
  }
}