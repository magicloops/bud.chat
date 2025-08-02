# Bud Management & MCP Configuration Analysis

## Current Issue Summary

**Problem**: MCP servers not showing as selected in Chat Settings, even when configured on the source bud.

**Latest Findings**: Bud loads successfully but `budMcpConfig` is `undefined` despite `budHasConfig: true`.

```javascript
🔍 [Settings Debug] Bud loading result: {
  targetBudId: 'e7de246a-b622-49c6-abab-85edbec3d44f', 
  budExists: true,        // ✅ Bud loads successfully
  budHasConfig: true,     // ✅ default_json exists  
  budMcpConfig: undefined // ❌ MCP config missing from default_json
}
```

## Bud Management Architecture

### Data Flow Overview
```
Database (buds table) 
  ↓ 
API /api/buds/[budId] 
  ↓ 
BudManager.getBud() 
  ↓ 
BudStore (state.buds[budId])
  ↓ 
useBud() hook
  ↓ 
Settings Panel
```

### Current Bud Loading Strategy
1. **Workspace Level**: `loadWorkspaceBuds(workspaceId)` loads all buds for a workspace
2. **Individual Access**: `useBud(budId)` returns bud from store cache
3. **No Individual Loading**: Missing `loadBud(budId)` for single bud fetches

### Bud Data Structure
```typescript
interface Bud {
  id: string
  name: string
  default_json: BudConfig  // Contains model, systemPrompt, mcpConfig, etc.
  mcp_config: Json         // Separate MCP config field (possibly deprecated?)
}

interface BudConfig {
  name: string
  model: string
  systemPrompt?: string
  mcpConfig?: MCPConfiguration  // This should contain server selections
}
```

## MCP Configuration Investigation

### Hypothesis 1: Database Schema Issue
**Theory**: MCP config is stored in wrong field or not being saved properly

**Evidence to Check**:
```sql
SELECT id, name, default_json, mcp_config 
FROM buds 
WHERE id = 'e7de246a-b622-49c6-abab-85edbec3d44f';
```

**Expected Structure**:
```json
{
  "default_json": {
    "name": "Claude DeepWiki",
    "model": "claude-3-5-sonnet",
    "mcpConfig": {
      "servers": ["server-id-1"],
      "tool_choice": "auto"
    }
  }
}
```

### Hypothesis 2: BudConfig Type Mismatch
**Theory**: `default_json` field doesn't match `BudConfig` interface

**Evidence**: Settings panel casts `bud?.default_json as unknown as BudConfig`
- The `as unknown as` suggests type issues
- MCP config might be stored under different key name
- Database Json type vs TypeScript interface mismatch

### Hypothesis 3: MCP Config Saving Issue  
**Theory**: MCP config isn't being saved to bud when configured

**Check**: Review bud update logic in settings panel
```typescript
// In handleSave() - does this preserve mcpConfig?
const updatedConfig: BudConfig = {
  ...currentConfig,
  mcpConfig: mcpConfig  // Is this being saved correctly?
};
```

### Hypothesis 4: Legacy MCP Field Confusion
**Theory**: Using wrong MCP field (separate `mcp_config` vs `default_json.mcpConfig`)

**Evidence**: Bud schema has both:
- `mcp_config: Json` (top-level field)  
- `default_json.mcpConfig` (nested in config)

### Hypothesis 5: Workspace-Level Bud Loading Issue
**Theory**: Bud loaded via workspace doesn't include complete MCP data

**Check**: Compare API responses:
- `/api/buds?workspaceId=X` (workspace loading)
- `/api/buds/budId` (individual loading)

## Investigation Steps

### Step 1: Database Verification
Check actual database content:
```sql
SELECT 
  id, 
  name,
  json_extract(default_json, '$.mcpConfig') as mcp_config_nested,
  mcp_config as mcp_config_top_level
FROM buds 
WHERE id = 'e7de246a-b622-49c6-abab-85edbec3d44f';
```

### Step 2: API Response Analysis
Compare bud data from different API endpoints:
```javascript
// Workspace loading
console.log('Workspace API response:', await fetch('/api/buds?workspaceId=...'));

// Individual loading  
console.log('Individual API response:', await fetch('/api/buds/e7de246a-b622-49c6-abab-85edbec3d44f'));
```

### Step 3: Type System Verification
Check if `BudConfig` interface matches actual data:
```typescript
// Add runtime logging
console.log('Raw default_json:', bud?.default_json);
console.log('default_json keys:', Object.keys(bud?.default_json || {}));
console.log('mcpConfig exists:', 'mcpConfig' in (bud?.default_json || {}));
```

### Step 4: Save Flow Verification
Trace MCP config through save process:
1. User selects MCP servers in UI
2. `handleMcpConfigChange()` updates local state
3. `handleSave()` constructs `BudConfig`
4. `updateBud()` sends to API
5. Database update occurs

## Potential Root Causes & Fixes

### Fix 1: Database Field Mapping
If using wrong MCP field:
```typescript
// Wrong: Looking in default_json.mcpConfig
const mcpConfig = budConfig?.mcpConfig;

// Right: Looking in top-level mcp_config
const mcpConfig = bud?.mcp_config;
```

### Fix 2: API Response Completeness
If workspace API doesn't return complete data:
- Ensure `/api/buds?workspaceId=X` includes all fields
- Consider separate API for MCP-enriched bud data
- Pre-load individual buds when workspace buds are fetched

### Fix 3: Type System Alignment
If `BudConfig` doesn't match database:
- Update `BudConfig` interface to match actual schema
- Fix database schema to match expected interface
- Add runtime validation/migration

### Fix 4: Bud Loading Architecture  
Implement proper bud loading at conversation level:
```typescript
// In conversation loading logic
useEffect(() => {
  if (conversation?.meta.source_bud_id) {
    // Ensure source bud is loaded for this conversation
    ensureBudLoaded(conversation.meta.source_bud_id);
  }
}, [conversation?.meta.source_bud_id]);
```

## Next Actions

1. **Immediate**: Check database to see actual MCP config storage format
2. **Debug**: Add logging to see raw `default_json` structure  
3. **Verify**: Compare workspace vs individual API responses
4. **Fix**: Address root cause based on findings
5. **Architecture**: Move bud loading to conversation/chat level

## Success Criteria

When fixed, the settings panel should:
1. Load bud successfully: `budExists: true` ✅ 
2. Have bud configuration: `budHasConfig: true` ✅ 
3. **Extract MCP config: `budMcpConfig: {...}` ❌ BROKEN**
4. Display selected servers as checked in UI
5. Persist MCP changes correctly

The key missing piece is step 3 - extracting the MCP configuration from the loaded bud data.