# Setup Scripts

Simple scripts to help set up MCP integration in bud.chat.

## Quick Start

### 1. Find Your Workspace ID
```bash
node scripts/find-workspace-id.js
```

### 2. Add the Test MCP Server
```bash
node scripts/add-test-mcp-server.js <workspace-id>
```

### 3. Configure a Bud
1. Open your bud.chat app
2. Create/edit a Bud
3. Go to "Tool Integration" section  
4. Select "JavaScript Eval Test Server"
5. Save the Bud

### 4. Test It!
Start a conversation and try:
- "Calculate 15% of 250"
- "Find the sum of [1, 2, 3, 4, 5]"
- "Execute: Math.sqrt(144)"

## Scripts

### `find-workspace-id.js`
Helps you find workspace IDs from your database.

**Requirements:**
- Supabase credentials in environment variables
- Access to the workspaces table

**Fallback:**
If credentials aren't available, it provides manual methods to find workspace IDs.

### `add-test-mcp-server.js`
Adds the JavaScript Eval test MCP server to your specified workspace.

**Usage:**
```bash
node scripts/add-test-mcp-server.js <workspace-id>
```

**What it does:**
- Calls the MCP servers API to register the test server
- Uses the stdio transport with the local test server
- Includes metadata about available tools
- Provides next steps for configuration

**Requirements:**
- Dev server running (`pnpm run dev`)
- Valid workspace ID
- Test MCP server installed (`cd test-mcp-server && pnpm install`)

## Environment Variables

For the workspace finder script:
```bash
# Set these in your .env.local or environment
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key

# OR the Next.js public versions
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url  
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Troubleshooting

### "Workspace not found"
- Double-check the workspace ID
- Make sure you have access to the workspace
- Try the find-workspace-id script first

### "Connection refused"
- Make sure your dev server is running: `pnpm run dev`
- Check the BASE_URL if not using localhost:3000

### "Unauthorized"
- The API requires authentication
- Make sure you're logged into the app
- You might need to add auth headers to the script

### "Test server not found"
- Run `cd test-mcp-server && pnpm install` first
- Make sure the server path is correct

## Manual Setup

If the scripts don't work, you can add the server manually:

### Via SQL:
```sql
INSERT INTO mcp_servers (workspace_id, name, endpoint, transport_type, metadata, is_active)
VALUES (
  'your-workspace-id',
  'JavaScript Eval Test Server',
  'node /absolute/path/to/test-mcp-server/server.js',
  'stdio',
  '{"description": "Test server for JavaScript execution", "tools": ["eval_javascript", "calculate", "array_operations"]}',
  true
);
```

### Via API:
```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "your-workspace-id",
    "name": "JavaScript Eval Test Server",
    "endpoint": "node /absolute/path/to/test-mcp-server/server.js",
    "transport_type": "stdio"
  }'
```