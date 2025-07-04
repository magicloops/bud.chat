# JavaScript Eval MCP Test Server

This is a simple MCP (Model Context Protocol) server for testing the MCP client integration in bud.chat. It provides JavaScript execution capabilities in a sandboxed environment.

## Features

The server provides three tools:

### 1. `eval_javascript`
Execute arbitrary JavaScript code in a sandboxed environment.
- **Parameters**: `code` (string) - JavaScript code to execute
- **Example**: `console.log("Hello, World!"); return 42;`

### 2. `calculate` 
Perform mathematical calculations.
- **Parameters**: `expression` (string) - Mathematical expression to evaluate
- **Example**: `2 + 2 * 3`

### 3. `array_operations`
Perform operations on arrays of numbers.
- **Parameters**: 
  - `operation` (string) - One of: sum, average, max, min, sort
  - `numbers` (array) - Array of numbers to operate on
- **Example**: `{"operation": "sum", "numbers": [1, 2, 3, 4, 5]}`

## Testing the Server

### 1. Start the Server
```bash
cd test-mcp-server
node server.js
```

### 2. Test with MCP Client
You can test the server using the MCP client in your bud.chat application:

1. Add the server to your workspace using the API
2. Configure a Bud to use this MCP server  
3. Start a conversation and try commands like:
   - "Calculate 2 + 2 * 3"
   - "Find the sum of the numbers 1, 2, 3, 4, 5"
   - "Execute this JavaScript: let x = 10; let y = 20; return x + y;"

### 3. Manual Testing via stdio
You can also test the server manually by sending JSON-RPC messages:

```bash
# List available tools
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | node server.js

# Call a tool
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "calculate", "arguments": {"expression": "2 + 2 * 3"}}}' | node server.js
```

## Security Notes

⚠️ **This server is for testing only!** 

While it includes basic sandboxing to prevent access to dangerous globals like `process`, `require`, etc., it still uses `eval()` which is inherently unsafe. Never use this in production or with untrusted input.

The sandbox includes:
- Basic JavaScript objects (Math, Date, JSON, etc.)
- Console methods (log, error, warn, info)
- Utility functions (sum, avg, max, min)
- Blocked access to Node.js globals (process, require, etc.)

## Configuration in bud.chat

To add this server to your bud.chat workspace:

1. **Server Configuration**:
   - **Name**: JavaScript Eval Test Server
   - **Endpoint**: `node /absolute/path/to/test-mcp-server/server.js`
   - **Transport Type**: stdio
   - **Active**: true

2. **Bud Configuration**:
   Add the server ID to your bud's `mcp_config`:
   ```json
   {
     "servers": ["your-server-id"],
     "tool_choice": "auto"
   }
   ```

3. **Test Prompts**:
   - "What's 15% of 250?"
   - "Calculate the average of these numbers: 10, 20, 30, 40, 50"
   - "Run this JavaScript code: Math.sqrt(144)"