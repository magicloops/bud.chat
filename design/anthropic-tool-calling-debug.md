# Anthropic Tool Calling Debug Analysis

## Issue Summary

Anthropic tool calls are not being parsed correctly, resulting in empty arguments `{}` being passed to MCP tools instead of the expected parameters. From test logs:

```
Tool Call: read_wiki_contents
Arguments: {}
Tool Result: "MCP error -32602: Invalid arguments for tool read_wiki_contents: Required field 'repoName' missing"
```

## Debug Logging Added

Added comprehensive debug logging in `/lib/chat/ChatEngine.ts` at key points:

1. **Tool use block start** (`content_block_start`) - logs the complete Anthropic event
2. **Tool arguments delta** (`input_json_delta`) - logs argument streaming and ID resolution  
3. **Tool completion** (`content_block_stop`) - logs tool call finalization
4. **Final tool calls** (`message_stop`) - logs final parsed arguments in segments

## Hypotheses for Root Cause

### Hypothesis 1: Missing Tool Arguments in Anthropic Response
**Theory**: Anthropic is not providing tool arguments in the streaming response

**Evidence to look for**:
- `content_block_start` event shows `tool_input: undefined` or missing
- No `input_json_delta` events in the stream
- Tool calls in final segments have empty `args: {}`

**Resolution**: If confirmed, this suggests an issue with how the MCP tools are registered with Anthropic, or tool schema incompatibility.

### Hypothesis 2: Argument Streaming Not Being Captured
**Theory**: Anthropic is sending arguments via `input_json_delta` but our handler isn't capturing them

**Evidence to look for**:
- `input_json_delta` events are being logged but not processed
- `toolCallId` resolution fails (returns null)
- Pending tool calls tracking is broken

**Resolution**: Fix the argument accumulation logic in `addToolCallArguments()` or tool ID mapping.

### Hypothesis 3: Tool Call Completion Issues  
**Theory**: Arguments are captured but not properly parsed during `completeToolCall()`

**Evidence to look for**:
- `input_json_delta` events show `partial_json` data
- Tool completion logs show successful parsing
- But final segments still have empty args

**Resolution**: Fix the JSON parsing or segment replacement logic in `StreamingEventBuilder.completeToolCall()`.

### Hypothesis 4: Event Builder State Management
**Theory**: The `StreamingEventBuilder` is losing tool call state between events

**Evidence to look for**:
- `getPendingToolCalls()` shows empty or incorrect state
- Tool call ID mapping by index fails
- Multiple tool calls interfere with each other

**Resolution**: Fix state management in the legacy compatibility methods.

### Hypothesis 5: MCP Tool Registration Schema Mismatch
**Theory**: Tool schemas sent to Anthropic don't match what MCP expects

**Evidence to look for**:
- Arguments are captured correctly but don't match expected parameter names
- Tool is called with different parameter structure than expected
- Schema validation issues between Anthropic format and MCP format

**Resolution**: Fix tool schema conversion in `getAnthropicTools()` method.

### Hypothesis 6: Index-Based Tool Tracking Issues
**Theory**: Anthropic uses different indexing than expected by our legacy compatibility layer

**Evidence to look for**:
- `event.index` is undefined or unexpected values
- `getToolCallIdAtIndex()` returns null for valid indices
- Multiple tools get mixed up due to incorrect index mapping

**Resolution**: Fix index-based tool call tracking logic.

## Testing Strategy

1. **Run Anthropic tool calling with debug logs** to see which hypothesis is correct
2. **Compare with working OpenAI tool calling** to identify differences
3. **Test single vs multiple tool calls** to isolate state management issues
4. **Verify MCP tool schemas** match between providers

## Key Files to Monitor

- `/lib/chat/ChatEngine.ts` - Main streaming logic (debug logs added)
- `/lib/eventMessageHelpers.ts` - `StreamingEventBuilder` legacy compatibility
- MCP tool registration code - Schema generation for Anthropic vs OpenAI
- Tool execution pipeline - How empty args flow through to MCP

## Expected Debug Output

With debug logging added, we should see:

```
🔧 [ANTHROPIC DEBUG] Tool use block started: { /* full event */ }
🔧 [ANTHROPIC DEBUG] Tool arguments delta: { /* argument streaming */ }  
🔧 [ANTHROPIC DEBUG] Tool call ID resolution: { /* ID mapping */ }
🔧 [ANTHROPIC DEBUG] Completing tool call: { /* finalization */ }
🔧 [ANTHROPIC DEBUG] Final tool calls in segments: { /* parsed results */ }
```

The pattern of these logs will reveal which hypothesis is correct and guide the fix.

## Next Steps

1. Test with debug logging to identify the root cause
2. Implement targeted fix based on the evidence
3. Verify fix with multiple tool scenarios
4. Remove debug logging once stable
5. Add regression tests to prevent future issues