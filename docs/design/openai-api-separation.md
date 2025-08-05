# OpenAI API Separation Design

## Overview

Currently, our codebase conflates OpenAI's Chat Completions API and Responses API, leading to incompatibilities when handling MCP (Model Context Protocol) tools and message formats. This document outlines a plan to properly separate these APIs while maintaining our unified event structure.

## Current Issues

1. **Message Role Incompatibility**: Responses API doesn't support `tool` role messages, only `assistant`, `system`, `developer`, and `user`
2. **MCP Integration Differences**: 
   - Chat Completions API uses traditional function calling with tool messages
   - Responses API uses hosted MCP with direct server communication
3. **Context Management**: Tool results are handled differently between the APIs
4. **Model Detection**: Need clear separation between reasoning models (o-series) and standard models

## Proposed Architecture

### 1. Provider Separation

Instead of a single `OpenAIProvider`, create two distinct providers:

```
lib/providers/unified/
├── OpenAIChatProvider.ts      # Chat Completions API (gpt-4, gpt-3.5, etc.)
├── OpenAIResponsesProvider.ts  # Responses API (o1, o3, o4 series)
└── index.ts                    # Export both providers
```

### 2. Model Routing

Update `ProviderFactory` to route models correctly:

```typescript
// lib/providers/unified/factory.ts
export class ProviderFactory {
  static create(model: string): BaseProvider {
    const modelLower = model.toLowerCase();
    
    // OpenAI Responses API (reasoning models)
    if (modelLower.startsWith('o1') || modelLower.startsWith('o3') || modelLower.startsWith('o4')) {
      return new OpenAIResponsesProvider();
    }
    
    // OpenAI Chat Completions API
    if (modelLower.includes('gpt')) {
      return new OpenAIChatProvider();
    }
    
    // Anthropic models
    if (modelLower.includes('claude')) {
      return new AnthropicProvider();
    }
    
    throw new Error(`Unknown model: ${model}`);
  }
}
```

### 3. MCP Handling Differences

#### Chat Completions API (Traditional Function Calling)
- Converts MCP tools to OpenAI function definitions
- Handles tool calls via message round-trips
- Supports local MCP servers (stdio transport)
- Tool results sent as `tool` role messages

#### Responses API (Hosted MCP)
- Uses `tools` array with `type: "mcp"` entries
- Direct server-to-server communication
- Only supports remote MCP servers (HTTP/SSE transport)
- Tool calls and results are separate input items
- Maintains full conversation context including tool interactions

### 4. Message Format Handling

#### OpenAIChatProvider
```typescript
// Supports full message history including tool messages
convertEventsToMessages(events: Event[]): OpenAI.ChatCompletionMessageParam[] {
  // Include all roles: system, user, assistant, tool
  return events.flatMap(event => {
    if (event.role === 'tool') {
      return {
        role: 'tool',
        content: event.segments[0].output,
        tool_call_id: event.segments[0].id
      };
    }
    // ... handle other roles
  });
}
```

#### OpenAIResponsesProvider
```typescript
// Converts events to Responses API input items
convertEventsToInput(events: Event[]): OpenAI.Responses.InputItem[] {
  return events.flatMap(event => {
    const items: OpenAI.Responses.InputItem[] = [];
    
    if (event.role === 'system' || event.role === 'user') {
      // Convert to message input
      items.push({
        id: event.id,
        type: 'message',
        role: event.role,
        content: event.segments.map(seg => {
          if (seg.type === 'text') {
            return { type: 'input_text', text: seg.text };
          }
          // Handle other content types
        })
      });
    } else if (event.role === 'assistant') {
      // Include assistant message
      items.push({
        id: event.id,
        type: 'message',
        role: 'assistant',
        content: event.segments
          .filter(seg => seg.type === 'text')
          .map(seg => ({ type: 'output_text', text: seg.text }))
      });
      
      // Extract tool calls as separate items
      event.segments
        .filter(seg => seg.type === 'tool_call')
        .forEach(toolCall => {
          items.push({
            id: toolCall.id,
            type: 'mcp_call',
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args),
            server_label: toolCall.metadata?.server_label || 'default'
          });
        });
    } else if (event.role === 'tool') {
      // Convert tool results to output items
      const toolResult = event.segments[0];
      items.push({
        id: toolResult.id,
        type: 'mcp_call',
        name: toolResult.name,
        output: JSON.stringify(toolResult.output),
        error: toolResult.error
      });
    }
    
    return items;
  });
}
```

### 5. MCP Configuration Structure

Update the MCP configuration to clearly separate local and remote servers:

```typescript
interface MCPConfig {
  // Local servers (stdio) - only for Chat Completions API
  local_servers?: Array<{
    id: string;
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  
  // Remote servers (HTTP/SSE) - for both APIs
  remote_servers?: Array<{
    server_label: string;
    server_url: string;
    require_approval: 'always' | 'never';
    allowed_tools?: string[];
    headers?: Record<string, string>;
  }>;
}
```

### 6. Implementation Steps

1. **Create Base Classes**
   - Extract common OpenAI logic to `OpenAIBaseProvider`
   - Implement API-specific logic in child classes

2. **Update Event Processing**
   - Responses API: Handle `mcp_list_tools`, `mcp_approval_request`, reasoning events
   - Chat API: Handle traditional function calling events

3. **Implement Segment-Based Conversion**
   - Chat API: Flatten segments to content + tool_calls
   - Responses API: Expand segments to individual items
   - Both: Support filtering based on context needs

4. **Update MCP Resolution**
   - Automatically separate servers by transport type
   - Route appropriately based on provider type

5. **Testing Strategy**
   - Test both APIs with same prompts
   - Verify tool execution flows
   - Ensure event consistency
   - Test segment filtering for different contexts

### 7. Migration Path

1. **Phase 1**: Create new provider classes alongside existing
2. **Phase 2**: Update ProviderFactory to use new providers
3. **Phase 3**: Remove old unified OpenAIProvider
4. **Phase 4**: Update frontend to handle any UI differences

### 8. Benefits

- **Clear Separation**: Each API's unique features are properly handled
- **Better MCP Support**: Hosted MCP for Responses API, traditional for Chat API
- **Maintainability**: Easier to update when APIs change
- **Type Safety**: API-specific types prevent mixing incompatible features
- **Performance**: Responses API can leverage direct MCP communication
- **Context Preservation**: Tool interactions remain in conversation history for both APIs

### 9. Key Implementation Details

#### Why Segments Work Well
The segment approach within Events is actually ideal for our use case because:

1. **Atomic Assistant Messages**: All activities (reasoning, tool calls, text) that produce a response stay together
2. **Parallel Operations**: Multiple tool calls can be represented naturally within one assistant event
3. **Flexible Filtering**: Can include/exclude segments based on context needs
4. **Natural Streaming**: Add segments as they arrive while keeping the message coherent

#### Event to Input Item Conversion
The Responses API expects a flat list of input items. Our segment-based Events convert naturally:

```typescript
// Example: Assistant event with multiple segments
{
  id: "msg-1",
  role: "assistant",
  segments: [
    { type: "reasoning", text: "Need to check weather..." },
    { type: "tool_call", id: "call-1", name: "get_weather", args: {city: "NYC"} },
    { type: "tool_call", id: "call-2", name: "get_weather", args: {city: "LA"} },
    { type: "text", text: "It's 72°F in NYC and 85°F in LA." }
  ]
}

// Converts to Responses API items:
[
  { type: "message", role: "assistant", content: [{type: "output_text", text: "It's 72°F in NYC and 85°F in LA."}] },
  { type: "mcp_call", id: "call-1", name: "get_weather", arguments: "{\"city\":\"NYC\"}" },
  { type: "mcp_call", id: "call-2", name: "get_weather", arguments: "{\"city\":\"LA\"}" }
]
```

#### Filtering Strategies

1. **For Future API Calls**: Include only text segments (the assistant's "summary")
   - Reasoning and tool internals are omitted since the assistant has already processed them
   - Keeps context focused and token-efficient

2. **For Tool Approvals**: Extract tool_call segments when needed
   - Can present them individually or in batches

3. **For Debugging/Transparency**: Show all segments in UI
   - Users can see reasoning process and tool interactions

4. **For Model Switching**: Convert segments appropriately
   - Chat API: Flatten to content + tool_calls
   - Responses API: Expand to individual items

### 10. Considerations

- **Conversation Continuity**: When switching between models mid-conversation
- **Tool State**: Managing tool results across API boundaries
- **Error Handling**: Different error formats between APIs
- **Feature Parity**: Some features only available in one API
- **Item Ordering**: Responses API expects chronological item order

### 11. Context Management Strategies

With the segment approach, we can implement different context strategies:

#### Minimal Context (Default)
- Include only text segments from assistant messages
- Omit reasoning and tool internals
- Most token-efficient for ongoing conversations

#### Full Context (Debugging/Reasoning Models)
- Include all segments for complete history
- Useful for complex reasoning tasks
- Required when switching to reasoning models mid-conversation

#### Tool Context (When Tools Are Needed)
- Include text segments + recent tool calls/results
- Helps model understand available tools and recent usage
- Can be triggered when user query seems tool-related

#### Adaptive Context
- Dynamically adjust based on:
  - Model type (reasoning vs standard)
  - User query complexity
  - Available context window
  - Cost considerations

### 12. Future Enhancements

- **Automatic Model Selection**: Based on task complexity
- **Hybrid Workflows**: Use Chat API for tool execution, Responses for reasoning
- **MCP Server Discovery**: Auto-detect transport types
- **Caching**: Cache MCP tool lists at appropriate levels
- **Smart Context Selection**: ML-based context filtering
- **Segment Compression**: Summarize old reasoning/tool segments