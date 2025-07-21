-- Add MCP (Model Context Protocol) infrastructure
-- This enables MCP client functionality for buds and conversations

-- Create MCP servers table
CREATE TABLE mcp_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    transport_type TEXT NOT NULL DEFAULT 'http',
    auth_config JSONB,
    connection_config JSONB,
    metadata JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_workspace_server_name UNIQUE(workspace_id, name),
    CONSTRAINT valid_transport_type CHECK (transport_type IN ('http', 'stdio', 'websocket'))
);

-- Create indexes for mcp_servers
CREATE INDEX idx_mcp_servers_workspace ON mcp_servers(workspace_id);
CREATE INDEX idx_mcp_servers_active ON mcp_servers(is_active);
CREATE INDEX idx_mcp_servers_updated ON mcp_servers(updated_at);

-- Create MCP tools table
CREATE TABLE mcp_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    parameters_schema JSONB,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_server_tool_name UNIQUE(server_id, name)
);

-- Create indexes for mcp_tools
CREATE INDEX idx_mcp_tools_server ON mcp_tools(server_id);
CREATE INDEX idx_mcp_tools_enabled ON mcp_tools(is_enabled);

-- Add MCP configuration to buds table
ALTER TABLE buds ADD COLUMN mcp_config JSONB DEFAULT '{}';

-- Add MCP configuration overrides to conversations table
ALTER TABLE conversations ADD COLUMN mcp_config_overrides JSONB;

-- Add comments explaining the new columns and tables
COMMENT ON TABLE mcp_servers IS 'MCP server configurations for workspaces';
COMMENT ON COLUMN mcp_servers.endpoint IS 'URL or command for MCP server connection';
COMMENT ON COLUMN mcp_servers.transport_type IS 'Transport type: http, stdio, or websocket';
COMMENT ON COLUMN mcp_servers.auth_config IS 'Authentication configuration as JSON';
COMMENT ON COLUMN mcp_servers.connection_config IS 'Connection-specific settings as JSON';
COMMENT ON COLUMN mcp_servers.metadata IS 'Server capabilities, tools, and discovery info as JSON';

COMMENT ON TABLE mcp_tools IS 'Available tools from MCP servers';
COMMENT ON COLUMN mcp_tools.parameters_schema IS 'JSON Schema for tool parameters';

COMMENT ON COLUMN buds.mcp_config IS 'MCP configuration for this bud (servers, tools, etc.)';
COMMENT ON COLUMN conversations.mcp_config_overrides IS 'MCP configuration overrides for this conversation (NULL = use bud defaults)';

-- Enable RLS on new tables
ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;

-- RLS policies for mcp_servers
CREATE POLICY "mcp_servers_workspace_members" ON mcp_servers
    FOR ALL USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

-- RLS policies for mcp_tools (inherits from server's workspace access)
CREATE POLICY "mcp_tools_via_server_workspace" ON mcp_tools
    FOR ALL USING (
        server_id IN (
            SELECT s.id 
            FROM mcp_servers s
            JOIN workspace_members wm ON s.workspace_id = wm.workspace_id
            WHERE wm.user_id = auth.uid()
        )
    );