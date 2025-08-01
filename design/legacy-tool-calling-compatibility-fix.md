# Legacy Tool Calling Compatibility Fix

## Problem Statement

After implementing OpenAI's Responses API integration with reasoning models, we broke compatibility with legacy tool calling for:

1. **Non-Responses API models** (GPT-4o, GPT-3.5, Claude, etc.)
2. **Stdio MCP servers** (servers that communicate over standard input/output)
3. **Local MCP servers** that handle tools on our end rather than remotely

The immediate error we're seeing:

```
Error in OpenAI stream handling: TypeError: this.eventBuilder.startToolCall is not a function
    at ChatStreamHandler.handleOpenAIStream (lib/streaming/chatStreamHandler.ts:169:32)
```

## Root Cause Analysis

### Event Builder Method Mismatch

The issue stems from a **method signature mismatch** between what `ChatStreamHandler` expects and what `StreamingEventBuilder` provides:

**ChatStreamHandler expects:**
```typescript
this.eventBuilder.startToolCall(toolCallId, toolName);
this.eventBuilder.addToolCallArguments(toolCallId, arguments);
this.eventBuilder.completeToolCall(toolCallId);
this.eventBuilder.getToolCallIdAtIndex(index);
```

**StreamingEventBuilder provides:**
```typescript
addToolCall(id, name, args, options?)  // Complete tool call in one method
addToolResult(id, output, error?)      // Tool result
// No separate startToolCall, addToolCallArguments, completeToolCall methods
```

### Architecture Inconsistency

We have **two different event building approaches**:

1. **New Approach (StreamingEventBuilder)**: Segment-based, designed for Responses API with complete tool calls
2. **Legacy Approach (Expected by ChatStreamHandler)**: Incremental streaming with separate start/args/complete phases

## Current Code Paths

### Working Path: OpenAI Responses API + Remote MCP
- Uses `FrontendEventHandler` → `processResponsesAPIStream` → `transformOpenAIReasoningEvent`
- Tools are handled remotely by OpenAI, we just render the results
- Works because tools come pre-resolved from OpenAI

### Broken Path: ChatCompletions API + Local MCP  
- Uses `ChatEngine` → `ChatStreamHandler` → `StreamingEventBuilder`
- Tools need to be executed locally, requiring incremental building
- Fails because `StreamingEventBuilder` lacks legacy methods

## Solution Design

### Option 1: Backward Compatible StreamingEventBuilder (Recommended)

Extend `StreamingEventBuilder` to support the legacy interface:

```typescript
export class StreamingEventBuilder {
  private pendingToolCalls: Map<string, {id: string, name: string, args: string}> = new Map();
  
  // Legacy compatibility methods
  startToolCall(id: string, name: string) {
    this.pendingToolCalls.set(id, { id, name, args: '' });
    // Trigger update to show tool call starting
    this.triggerUpdate();
  }
  
  addToolCallArguments(id: string, args: string) {
    const pending = this.pendingToolCalls.get(id);
    if (pending) {
      pending.args += args;
      this.triggerUpdate();
    }
  }
  
  completeToolCall(id: string) {
    const pending = this.pendingToolCalls.get(id);
    if (pending) {
      try {
        const parsedArgs = JSON.parse(pending.args);
        this.addToolCall(id, pending.name, parsedArgs);
        this.pendingToolCalls.delete(id);
      } catch (error) {
        console.error('Failed to parse tool arguments:', error);
      }
    }
  }
  
  getToolCallIdAtIndex(index: number): string | null {
    // Find tool call by index in segments
    const toolCalls = this.event.segments.filter(s => s.type === 'tool_call');
    return toolCalls[index]?.id || null;
  }
  
  // ... existing methods remain unchanged
}
```

### Option 2: Create Legacy Wrapper Class

Create a wrapper that adapts the old interface to the new one:

```typescript
export class LegacyEventBuilderAdapter {
  constructor(private builder: StreamingEventBuilder) {}
  
  startToolCall(id: string, name: string) {
    // Store in pending state and delegate to modern builder when complete
  }
  
  // ... other legacy methods
}
```

### Option 3: Separate Legacy Builder (Not Recommended)

Maintain two separate builders, but this creates code duplication and maintenance burden.

## Implementation Plan

### Phase 1: Add Legacy Compatibility Methods
1. **Extend StreamingEventBuilder** with backward-compatible methods
2. **Add pending tool call state** to track incomplete tool calls
3. **Update method signatures** to be consistent with legacy expectations

### Phase 2: Fix Tool Call Rendering
1. **Update tool call segments** to show "building" state during args streaming
2. **Add tool call progress indicators** for better UX
3. **Handle partial JSON parsing** for streaming arguments

### Phase 3: MCP Integration Fixes
1. **Ensure stdio MCP servers** use the ChatCompletions path
2. **Test local tool execution** with various MCP server types
3. **Add fallback handling** for MCP server failures

## Testing Strategy

### Test Cases to Cover
1. **GPT-4o with stdio MCP server** (the failing case)
2. **Claude with local tools**
3. **GPT-3.5 with function calling**
4. **Mixed conversations** (some tools local, some remote)

### Compatibility Matrix

| Model Type | MCP Server Type | Tool Handling | Expected Path | Status |
|------------|----------------|---------------|---------------|---------|
| o3-mini | Remote MCP | OpenAI handles | Responses API | ✅ Working |
| GPT-4o | Stdio MCP | Local execution | ChatCompletions | ❌ Broken |
| Claude | Local tools | Local execution | ChatCompletions | ❌ Likely broken |
| GPT-3.5 | Function calls | Local execution | ChatCompletions | ❌ Likely broken |

## Risk Assessment

### Low Risk
- Adding backward compatibility methods to existing class
- Maintaining existing behavior for working paths

### Medium Risk
- Tool call state management during streaming
- JSON parsing of partial arguments

### High Risk
- Breaking existing Responses API functionality
- Performance impact of dual state tracking

## Files to Modify

### Core Changes
- `lib/eventMessageHelpers.ts` - Add legacy methods to StreamingEventBuilder
- `lib/streaming/chatStreamHandler.ts` - Ensure proper error handling

### Testing
- Add integration tests for each tool calling path
- Test MCP server compatibility matrix

### Documentation
- Update API documentation for event builders
- Document the dual compatibility approach

## Success Criteria

1. **GPT-4o + stdio MCP servers work** without the `startToolCall` error
2. **All existing Responses API functionality** continues to work
3. **Tool calling performance** is not significantly impacted
4. **MCP server compatibility** is maintained across server types

## Long-term Vision

Eventually, we should migrate all tool calling to use the unified segments model, but this compatibility layer ensures we don't break existing functionality while transitioning.

The goal is to have **one event builder** that works for both legacy ChatCompletions streaming and modern Responses API, providing a smooth migration path for all model types and MCP configurations.