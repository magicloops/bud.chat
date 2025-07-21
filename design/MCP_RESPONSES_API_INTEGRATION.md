# MCP Integration with OpenAI Responses API

## Overview

This document outlines the refactored approach to MCP (Model Context Protocol) integration using OpenAI's native MCP support through the Responses API. This approach eliminates the complexity of running our own MCP client and leverages OpenAI's official MCP integration.

## Key Benefits

- **Native Integration**: Uses OpenAI's official MCP support
- **Simplified Architecture**: No need for custom MCP client management
- **Better Performance**: Direct integration with OpenAI's infrastructure
- **Reduced Complexity**: Eliminates streaming handlers and tool call management
- **Official Support**: Backed by OpenAI with ongoing updates

## Architecture Changes

### Before (Custom MCP Client)
```
Bud.chat Server → Custom MCP Client → MCP Server → Tools
                ↓
              OpenAI API (Chat Completions)
```

### After (Responses API)
```
Bud.chat Server → OpenAI Responses API → MCP Server → Tools
```

## Implementation Plan

### Phase 1: Update Dependencies & Core API

1. **Update OpenAI SDK**
   - Upgrade to latest version supporting Responses API
   - Verify MCP tool support availability

2. **Replace Chat Completions with Responses API**
   - Update `/api/chat-new` to use `client.responses.create()`
   - Remove streaming complications (Responses API handles this)
   - Update request/response format

3. **Simplify MCP Configuration**
   - Store only MCP server URLs and metadata
   - Remove custom transport and client management
   - Update database schema if needed

### Phase 2: Database & Configuration Updates

1. **Simplify MCP Server Schema**
   ```sql
   -- Focus on what Responses API needs
   CREATE TABLE mcp_servers (
     id UUID PRIMARY KEY,
     workspace_id UUID REFERENCES workspaces(id),
     name TEXT NOT NULL,
     server_url TEXT NOT NULL,       -- Direct URL for Responses API
     server_label TEXT NOT NULL,     -- Label for OpenAI Responses API
     headers JSONB DEFAULT '{}',     -- Auth headers for MCP server
     allowed_tools TEXT[],           -- Optional tool filtering
     require_approval TEXT DEFAULT 'always', -- 'always', 'never', or approval config
     metadata JSONB DEFAULT '{}',
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

2. **Update Bud/Conversation MCP Config**
   ```typescript
   interface MCPConfig {
     servers: {
       server_id: string
       allowed_tools?: string[]
       require_approval?: 'always' | 'never' | ApprovalConfig
     }[]
     global_approval_policy?: 'always' | 'never'
   }
   ```

### Phase 3: Remove Legacy MCP Infrastructure

1. **Files to Remove/Refactor**
   - `/lib/mcp/mcpClientManager.ts` - No longer needed
   - `/lib/mcp/streamingHandler.ts` - No longer needed  
   - `/lib/mcp/mcpProxy.ts` - No longer needed
   - Custom tool call handling logic

2. **Files to Update**
   - `/lib/mcp/helpers.ts` - Simplify to config resolution only
   - `/lib/mcp/types.ts` - Update to Responses API format
   - `/lib/mcp/mcpConfigResolver.ts` - Update for new schema

### Phase 4: UI Updates

1. **MCP Server Configuration**
   - Update forms to match Responses API requirements
   - Add fields for `server_label`, `headers`, `require_approval`
   - Simplify transport selection (HTTP/SSE only)

2. **Approval Management**
   - Add UI for approval policy configuration
   - Tool-specific approval settings
   - Approval logging/audit trail

## Responses API Integration Details

### Basic MCP Tool Configuration
```typescript
const response = await openai.responses.create({
  model: "gpt-4.1",
  input: userMessage,
  tools: mcpServers.map(server => ({
    type: "mcp",
    server_label: server.server_label,
    server_url: server.server_url,
    headers: server.headers,
    allowed_tools: server.allowed_tools,
    require_approval: server.require_approval
  }))
})
```

### Handling Responses
```typescript
// Parse response outputs
for (const output of response.outputs) {
  switch (output.type) {
    case 'text':
      // Regular text response
      break
    case 'mcp_list_tools':
      // Tools discovered from MCP server
      break
    case 'mcp_call':
      // Tool call executed
      break
    case 'mcp_approval_request':
      // Approval needed for tool call
      break
  }
}
```

### Approval Workflow
```typescript
// When approval is requested
if (output.type === 'mcp_approval_request') {
  // Present approval UI to user
  const approved = await getUserApproval(output)
  
  // Continue conversation with approval response
  const nextResponse = await openai.responses.create({
    model: "gpt-4.1",
    previous_response_id: response.id,
    input: [{
      type: "mcp_approval_response",
      approve: approved,
      approval_request_id: output.id
    }]
  })
}
```

## Multi-Provider Support

### OpenAI (Current)
- Responses API with native MCP support
- Available now with latest SDK

### Anthropic (Future)
```typescript
// When Anthropic adds MCP support
const anthropicResponse = await anthropic.messages.create({
  model: "claude-3-5-sonnet",
  messages: [...],
  tools: mcpServers.map(server => ({
    type: "mcp",
    server_url: server.server_url,
    // Anthropic-specific MCP configuration
  }))
})
```

### Provider Abstraction
```typescript
interface MCPProvider {
  createResponse(config: MCPRequestConfig): Promise<MCPResponse>
  supportsApprovals: boolean
  supportedTransports: ('http' | 'sse' | 'websocket')[]
}

class OpenAIMCPProvider implements MCPProvider {
  async createResponse(config: MCPRequestConfig) {
    return await this.client.responses.create({
      model: config.model,
      input: config.input,
      tools: config.mcpTools
    })
  }
}
```

## Migration Strategy

### Step 1: Parallel Implementation
- Keep existing MCP implementation running
- Add new Responses API endpoint (`/api/chat-responses`)
- Test with same MCP servers

### Step 2: Feature Parity
- Ensure all existing MCP features work with Responses API
- Update UI to support both approaches
- Comprehensive testing

### Step 3: Migration
- Migrate conversations to use Responses API
- Update default to use new implementation
- Deprecation warnings for old approach

### Step 4: Cleanup
- Remove legacy MCP client code
- Clean up database schema
- Update documentation

## Security Considerations

### MCP Server Trust
- **Official Servers**: Prefer servers hosted by service providers
- **Third-party Servers**: Require explicit user consent
- **Server Verification**: Check server authenticity where possible

### Data Protection
- **Approval Workflows**: Default to requiring approval for tool calls
- **Data Logging**: Log all MCP interactions for audit
- **Header Security**: Secure storage of authentication headers
- **Zero Data Retention**: Respect ZDR policies for MCP data

### Authentication
```typescript
interface MCPServerAuth {
  headers: {
    Authorization?: string
    'X-API-Key'?: string
    [key: string]: string
  }
  // Future: OAuth, certificate-based auth
}
```

## Testing Strategy

### Unit Tests
- MCP configuration resolution
- Responses API request building
- Response parsing and handling

### Integration Tests
- End-to-end MCP tool calls
- Approval workflows
- Error handling and fallbacks

### MCP Server Testing
- Test with official MCP servers (Stripe, Shopify, etc.)
- Custom test server for development
- Authentication flow testing

## Performance Considerations

### Latency Optimization
- **Tool Caching**: Cache `mcp_list_tools` responses
- **Approval Batching**: Batch approval requests where possible
- **Connection Pooling**: Let OpenAI handle MCP server connections

### Cost Optimization
- **Tool Filtering**: Use `allowed_tools` to limit scope
- **Smart Approvals**: Configure approval policies to reduce requests
- **Usage Monitoring**: Track MCP tool usage and costs

## Error Handling

### MCP Server Errors
```typescript
if (output.type === 'mcp_call' && output.error) {
  // Handle MCP protocol errors
  // Tool execution errors
  // Connectivity errors
}
```

### Fallback Strategies
- **Server Unavailable**: Continue without MCP tools
- **Authentication Failed**: Prompt user to update credentials
- **Tool Errors**: Display error to user, allow retry

## Monitoring & Observability

### Metrics to Track
- MCP tool call success/failure rates
- Tool call latency and costs
- Approval request patterns
- Server availability and errors

### Logging
```typescript
interface MCPAuditLog {
  conversation_id: string
  mcp_server: string
  tool_name: string
  arguments: any
  result: any
  approved: boolean
  timestamp: Date
  user_id: string
}
```

## Future Enhancements

### Advanced Features
- **Tool Chaining**: Automatic tool call sequences
- **Context Persistence**: Maintain MCP context across conversations
- **Server Discovery**: Registry-based MCP server discovery
- **Custom Approval Logic**: Programmable approval rules

### UI/UX Improvements
- **Tool Call Visualization**: Show tool execution in chat
- **Server Management**: Centralized MCP server configuration
- **Usage Analytics**: Per-tool and per-server usage insights

## Conclusion

The Responses API approach dramatically simplifies our MCP integration while providing better performance, security, and maintainability. By leveraging OpenAI's native MCP support, we can focus on user experience rather than protocol implementation details.

This refactor positions us well for:
- **Multi-provider Support**: Easy to add Anthropic when they support MCP
- **Ecosystem Growth**: Automatic compatibility with new MCP servers
- **Reduced Maintenance**: Less custom code to maintain
- **Better Performance**: Optimized by OpenAI's infrastructure

---

**Next Steps**: Begin Phase 1 implementation with OpenAI SDK upgrade and Responses API integration.