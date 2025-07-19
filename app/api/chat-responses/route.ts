// New chat endpoint using OpenAI Responses API with native MCP support
import { createClient } from '@/lib/supabase/server';
import { Database } from '@/lib/types/database';
import OpenAI from 'openai';
import { NextRequest } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

interface ChatRequest {
  messages: { role: string; content: string }[]
  model?: string
  workspaceId: string
  budId?: string
  conversationId?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { messages, model = 'gpt-4o', workspaceId, budId, conversationId } = body;

    console.log('🚀 New Responses API chat request:', { 
      messageCount: messages.length, 
      model, 
      workspaceId, 
      budId,
      conversationId 
    });

    // Create Supabase client
    const supabase = await createClient();

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Verify workspace access
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return new Response('Workspace not found or access denied', { status: 404 });
    }

    console.log('✅ User has access to workspace:', workspaceId);

    // Get MCP server configuration from database
    let mcpServers: any[] = [];
    let budData: any = null;

    try {
      if (budId) {
        // Get bud configuration including MCP config
        const { data: bud, error: budError } = await supabase
          .from('buds')
          .select('*, mcp_config')
          .eq('id', budId)
          .single();

        if (bud && !budError) {
          budData = bud;
          const mcpConfig = bud.mcp_config || {};
          
          if (mcpConfig.servers?.length > 0) {
            // Fetch MCP server details
            const { data: servers, error: serversError } = await supabase
              .from('mcp_servers')
              .select('*')
              .in('id', mcpConfig.servers)
              .eq('workspace_id', workspaceId);

            if (servers && !serversError) {
              mcpServers = servers.map(server => ({
                type: 'mcp',
                server_label: server.metadata?.server_label || server.name.toLowerCase().replace(/\s+/g, '_'),
                server_url: server.endpoint,
                require_approval: server.metadata?.require_approval || 'never',
                ...(server.metadata?.allowed_tools && {
                  allowed_tools: server.metadata.allowed_tools
                })
              }));
              
              console.log('🔧 MCP: Found', mcpServers.length, 'MCP servers from bud');
              mcpServers.forEach(server => {
                console.log(`  - ${server.server_label}: ${server.server_url}`);
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn('MCP configuration loading failed:', error);
    }

    // Use the last user message as input
    const lastMessage = messages[messages.length - 1];
    const input = lastMessage?.content || '';

    // Create the Responses API request
    console.log('🤖 Creating response with Responses API...');
    const responseRequest: any = {
      model,
      input,
    };

    // Add MCP tools if available
    if (mcpServers.length > 0) {
      responseRequest.tools = mcpServers;
      console.log('🛠️ MCP: Including', mcpServers.length, 'MCP servers in request');
    }

    // Add conversation history as context (if this is a continuing conversation)
    if (messages.length > 1) {
      // For now, we'll include previous messages as context
      // The Responses API handles conversation state differently than chat completions
      const conversationContext = messages.slice(0, -1)
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n\n');
      
      responseRequest.input = `Previous conversation:\n${conversationContext}\n\nUser: ${input}`;
    }

    // Make the Responses API call
    const response = await openai.responses.create(responseRequest);

    console.log('✅ Responses API call completed');
    console.log('📋 Response outputs:', response.outputs?.length || 0);

    // Process the response outputs
    let responseText = '';
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    for (const output of response.outputs || []) {
      console.log('📄 Processing output type:', output.type);
      
      switch (output.type) {
        case 'text':
          responseText += output.text;
          break;
          
        case 'mcp_list_tools':
          console.log('🛠️ MCP tools discovered:', output.tools?.length || 0);
          break;
          
        case 'mcp_call':
          console.log('🔧 MCP tool called:', output.name);
          toolCalls.push({
            name: output.name,
            arguments: output.arguments,
            server_label: output.server_label
          });
          toolResults.push({
            name: output.name,
            output: output.output,
            error: output.error
          });
          break;
          
        case 'mcp_approval_request':
          console.log('⚠️ MCP approval requested for:', output.name);
          // For now, we're using require_approval: "never", so this shouldn't happen
          break;
          
        default:
          console.log('❓ Unknown output type:', output.type);
      }
    }

    // Build the response
    const result = {
      id: response.id,
      text: responseText,
      tool_calls: toolCalls,
      tool_results: toolResults,
      outputs: response.outputs,
      usage: response.usage
    };

    console.log('📤 Sending response:', {
      textLength: responseText.length,
      toolCallCount: toolCalls.length,
      outputCount: response.outputs?.length || 0
    });

    return Response.json(result);

  } catch (error) {
    console.error('❌ Responses API chat error:', error);
    return Response.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}