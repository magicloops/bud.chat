# MCP Settings Debug Investigation

## Issue Summary

MCP servers are not showing as selected in the Chat Settings sidebar, even when they are configured on the source bud. All servers appear unchecked by default.

## Key Findings from Frontend Logs

```javascript
🔧 Settings Panel - Data loaded: {
  panelMode: 'chat', 
  conversation: {
    assistant_avatar: "🤖",
    assistant_name: "Claude DeepWiki 2",
    source_bud_id: "e7de246a-b622-49c6-abab-85edbec3d44f", // BUD ID EXISTS
    mcp_config_overrides: null, // No conversation-level MCP overrides
    model_config_overrides: {...}
  }, 
  bud: undefined, // ❌ BUD IS NOT LOADED
  budConfig: null, // ❌ NO BUD CONFIG AVAILABLE
  conversationOverrides: {...},
  mcpOverrides: null
}
```

## Root Cause Analysis

### Problem 1: Bud Not Loading in Chat Mode
- **Issue**: `source_bud_id` exists in conversation metadata but `bud` is `undefined`
- **Location**: `settings-panel.tsx:54` - `const bud = useBud(targetBudId || '');`
- **Impact**: Without the bud, we can't access `budConfig.mcpConfig`

### Problem 2: MCP Config Resolution Logic
In chat mode, the MCP config resolution follows this hierarchy:
1. `mcpOverrides` (conversation-level overrides) - `null` ✅ 
2. `budConfig?.mcpConfig` (bud default config) - **MISSING** ❌
3. `{}` (empty fallback)

Since `budConfig` is `null`, we always get an empty `{}` config, so no servers appear selected.

## Investigation Steps

### Step 1: Verify Bud Store Logic
Check if `useBud()` hook is properly fetching the bud data:
- Does `useBud("e7de246a-b622-49c6-abab-85edbec3d44f")` trigger a fetch?
- Is the bud actually stored in the database with MCP configuration?
- Are there any errors in the bud loading process?

### Step 2: Check Bud API and Database
Verify the bud exists and has MCP configuration:
```sql
SELECT id, name, default_json FROM buds 
WHERE id = 'e7de246a-b622-49c6-abab-85edbec3d44f';
```
Expected `default_json` structure:
```json
{
  "name": "Claude DeepWiki 2",
  "mcpConfig": {
    "servers": ["server-id-1", "server-id-2"]
  }
}
```

### Step 3: Check targetBudId Resolution
Verify the `targetBudId` logic in settings panel:
```typescript
// Line 54: For chat mode, should use conversation's source_bud_id
const targetBudId = isPreConversation ? urlBudId : conversation?.meta.source_bud_id;
```
Should resolve to: `"e7de246a-b622-49c6-abab-85edbec3d44f"`

## Potential Fixes

### Fix 1: Ensure Bud Loading in Chat Mode
If `useBud()` isn't triggering properly:
- Check if `targetBudId` is correctly resolved
- Verify `useBud()` hook implementation  
- Add loading states to prevent premature rendering

### Fix 2: Add Fallback MCP Config Loading
If bud loading is async and slow:
- Load MCP config directly from conversation metadata
- Cache bud data more aggressively
- Show loading state until bud is available

### Fix 3: Fix Bud Store State Management
If there's a race condition:
- Ensure bud is loaded when conversation references it
- Pre-load bud data when loading conversations
- Fix any Zustand state synchronization issues

## Next Steps

1. **Immediate**: Add debug logging to `useBud()` hook to see if it's being called
2. **Verify**: Check if bud exists in database with correct MCP config
3. **Fix**: Address the root cause of bud not loading in chat mode
4. **Test**: Verify MCP servers show as selected after fix

## Debug Commands to Run

```typescript
// In settings panel, add these logs:
console.log('🔍 Debug - targetBudId resolution:', {
  isPreConversation,
  urlBudId, 
  conversationSourceBudId: conversation?.meta.source_bud_id,
  finalTargetBudId: targetBudId
});

console.log('🔍 Debug - useBud result:', {
  targetBudId,
  budExists: !!bud,
  budId: bud?.id,
  budConfig: bud?.default_json
});
```

## Expected Behavior

When a conversation has `source_bud_id`, the settings panel should:
1. Load the source bud using `useBud(source_bud_id)`
2. Extract `budConfig.mcpConfig` from the loaded bud
3. Pass this config to `MCPConfigurationPanel`
4. Display the configured servers as selected/checked

Currently step 1 is failing, causing the entire chain to break.