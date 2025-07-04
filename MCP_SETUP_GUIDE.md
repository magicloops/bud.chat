# MCP Setup Guide

This guide walks you through setting up MCP (Model Context Protocol) tools in bud.chat.

## Quick Setup Steps

### 1. Start the Development Server
```bash
pnpm run dev
```

### 2. Add the Test MCP Server

**Option A: Via API (Recommended)**
```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "name": "JavaScript Eval Test Server",
    "endpoint": "node /absolute/path/to/bud.chat/test-mcp-server/server.js",
    "transport_type": "stdio",
    "metadata": {
      "description": "Test server for JavaScript execution and calculations",
      "tools": ["eval_javascript", "calculate", "array_operations"]
    }
  }'
```

**Option B: Manual Database Insert**
```sql
INSERT INTO mcp_servers (workspace_id, name, endpoint, transport_type, metadata, is_active)
VALUES (
  'your-workspace-id',
  'JavaScript Eval Test Server', 
  'node /absolute/path/to/bud.chat/test-mcp-server/server.js',
  'stdio',
  '{"description": "Test server for JavaScript execution", "tools": ["eval_javascript", "calculate", "array_operations"]}',
  true
);
```

### 3. Configure a Bud

1. **Create/Edit a Bud** in the UI
2. Scroll to **"Tool Integration"** section  
3. Select **"JavaScript Eval Test Server"**
4. Keep **Tool Choice** as **"Auto"**
5. Save the Bud

### 4. Test the Integration

Start a conversation with your Bud and try these prompts:

**Mathematical Calculations:**
- "What's 15% of 250?"
- "Calculate (5 + 3) * 2 - 4"

**Array Operations:**
- "Find the sum of these numbers: 10, 20, 30, 40, 50"
- "What's the average of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]?"

**JavaScript Execution:**
- "Execute this JavaScript: Math.sqrt(144)"
- "Run this code: let x = 10; let y = 20; return x * y;"

## What You Should See

1. **User Message**: Your request appears normally
2. **Tool Call Card**: Blue card showing the tool being called with parameters  
3. **Tool Result Card**: Green card showing the execution result
4. **AI Response**: The AI incorporates the tool result into its response

## Troubleshooting

### Common Issues

**"No MCP servers configured"**
- Make sure you added the server via API or database
- Check that `is_active = true` in the database
- Verify the workspace ID matches

**Tool calls don't appear**
- Check the Bud has the MCP server selected in "Tool Integration"
- Ensure `tool_choice` is set to "auto" (not "none")
- Try more explicit prompts like "Use the calculator to find..."

**"Server not found or not initialized"**
- Check the server endpoint path is correct and absolute
- Make sure Node.js can execute the server script
- Test the server manually: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node test-mcp-server/server.js`

**Frontend errors**
- Check browser console for any React/component errors
- Verify all MCP components are properly imported

### Debugging Steps

1. **Check server registration:**
   ```sql
   SELECT * FROM mcp_servers WHERE workspace_id = 'your-workspace-id';
   ```

2. **Test server connection:**
   ```bash
   curl -X POST http://localhost:3000/api/mcp/servers/SERVER_ID/test
   ```

3. **Check Bud configuration:**
   ```sql
   SELECT name, mcp_config FROM buds WHERE workspace_id = 'your-workspace-id';
   ```

4. **Monitor server logs:**
   The test server logs to stderr, you can see debug output in your terminal

## Next Steps

Once basic testing works:

1. **Create Custom MCP Servers** for your specific use cases
2. **Add More Tools** to the test server
3. **Configure Different Buds** with different tool sets
4. **Set up Conversation-level Overrides** in settings

## Security Notes

⚠️ **The test server uses `eval()` and is not safe for production!**

For production MCP servers:
- Use proper sandboxing (Docker, VM-based, etc.)
- Validate and sanitize all inputs
- Implement proper authentication
- Use secure transport (HTTPS for HTTP transport)
- Monitor and rate-limit tool usage