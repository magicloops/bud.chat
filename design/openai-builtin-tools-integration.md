# OpenAI Built-in Tools Integration Design Document

## Overview

This document outlines the implementation plan for integrating OpenAI's built-in tools (web search and code interpreter) into our existing codebase. These tools are available through the OpenAI Responses API for specific models (o3, GPT-5, etc.) and provide enhanced capabilities for web search and Python code execution.

## Background

The OpenAI Responses API provides built-in tools that extend model capabilities:
- **Web Search Preview**: Searches the web for relevant results to use in responses
- **Code Interpreter**: Runs Python code to help generate responses

These tools stream additional events during execution and require specific configuration in the API request.

## Goals

1. Enable configuration of built-in tools per model
2. Update bud configuration UI to allow tool selection
3. Handle new streaming events from built-in tools
4. Maintain compatibility with existing MCP and function calling systems
5. Provide conversation-level overrides for tool selection

## Architecture Overview

### 1. Model-to-Tools Mapping

Create a centralized mapping system that defines which built-in tools are available for each model.

**Location**: `/lib/modelMapping.ts` (extend existing file)

```typescript
// New interfaces
interface BuiltInTool {
  type: 'web_search_preview' | 'code_interpreter'
  name: string
  description: string
  settings?: {
    // Tool-specific configuration options
    search_context_size?: 'low' | 'medium' | 'high'
    container?: string // For code interpreter
  }
}

interface ModelCapabilities {
  supports_builtin_tools: boolean
  available_builtin_tools: BuiltInTool[]
  uses_responses_api: boolean
}

// Extend existing model mapping
const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-5': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information'
      },
      {
        type: 'code_interpreter', 
        name: 'Code Interpreter',
        description: 'Execute Python code and analyze data'
      }
    ],
    uses_responses_api: true
  },
  'o3': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information'
      },
      {
        type: 'code_interpreter',
        name: 'Code Interpreter', 
        description: 'Execute Python code and analyze data'
      }
    ],
    uses_responses_api: true
  },
  // Other models don't support built-in tools
  'gpt-4o': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  }
}

// Helper functions
export function getModelCapabilities(modelId: string): ModelCapabilities
export function getAvailableBuiltInTools(modelId: string): BuiltInTool[]
export function supportsBuiltInTools(modelId: string): boolean
```

### 2. Database Schema Updates

Extend the existing `buds` table to store built-in tool configurations.

**Migration**: `supabase/migrations/YYYYMMDD_add_builtin_tools_to_buds.sql`

```sql
ALTER TABLE buds 
ADD COLUMN builtin_tools_config JSONB DEFAULT '{}';

-- Example structure:
-- {
--   "enabled_tools": ["web_search_preview", "code_interpreter"],
--   "tool_settings": {
--     "web_search_preview": {
--       "search_context_size": "medium"
--     },
--     "code_interpreter": {
--       "container": "default"
--     }
--   }
-- }
```

### 3. Bud Configuration Updates

Extend the bud configuration interface and forms to include built-in tool selection.

**Files to Update**:
- `/lib/types.ts` - Update `Bud` interface
- `/components/BudForm.tsx` - Add built-in tools section
- `/lib/budHelpers.ts` - Update default configurations

```typescript
// lib/types.ts additions
interface BuiltInToolsConfig {
  enabled_tools: string[]
  tool_settings: Record<string, Record<string, any>>
}

interface Bud {
  // ... existing fields
  builtin_tools_config: BuiltInToolsConfig
}

// BudForm.tsx new section
const BuiltInToolsSection: React.FC<{
  modelId: string
  config: BuiltInToolsConfig
  onChange: (config: BuiltInToolsConfig) => void
}> = ({ modelId, config, onChange }) => {
  const availableTools = getAvailableBuiltInTools(modelId)
  
  if (!supportsBuiltInTools(modelId)) {
    return null
  }

  return (
    <div className="space-y-4">
      <h3>Built-in Tools</h3>
      {availableTools.map(tool => (
        <div key={tool.type}>
          <Checkbox 
            checked={config.enabled_tools.includes(tool.type)}
            onCheckedChange={(checked) => {
              // Update enabled_tools array
            }}
          />
          <span>{tool.name}</span>
          <p className="text-sm text-muted-foreground">{tool.description}</p>
          
          {/* Tool-specific settings */}
          {tool.type === 'web_search_preview' && (
            <Select 
              value={config.tool_settings[tool.type]?.search_context_size || 'medium'}
              onValueChange={(value) => {
                // Update tool settings
              }}
            >
              <SelectItem value="low">Low Context</SelectItem>
              <SelectItem value="medium">Medium Context</SelectItem>
              <SelectItem value="high">High Context</SelectItem>
            </Select>
          )}
        </div>
      ))}
    </div>
  )
}
```

### 4. Conversation Override Configuration

Allow per-conversation overrides of built-in tool settings, similar to existing model/temperature overrides.

**Files to Update**:
- `/components/settings-panel.tsx` - Add built-in tools section
- `/state/eventChatStore.ts` - Add override state

```typescript
// eventChatStore.ts additions
interface ConversationOverrides {
  // ... existing overrides
  builtin_tools_override?: {
    enabled_tools: string[]
    tool_settings: Record<string, Record<string, any>>
  }
}
```

### 5. API Request Handling

Update the OpenAI Responses API provider to include built-in tools in requests.

**Files to Update**:
- `/lib/providers/unified/OpenAIResponsesProvider.ts`

```typescript
// OpenAIResponsesProvider.ts updates
private buildToolsArray(
  mcpTools: any[], 
  builtInTools: BuiltInToolsConfig,
  conversationOverride?: BuiltInToolsConfig
): any[] {
  const tools = [...mcpTools] // Existing MCP tools
  
  const activeBuiltInConfig = conversationOverride || builtInTools
  
  for (const toolType of activeBuiltInConfig.enabled_tools) {
    const toolSettings = activeBuiltInConfig.tool_settings[toolType] || {}
    
    if (toolType === 'web_search_preview') {
      tools.push({
        type: 'web_search_preview',
        search_context_size: toolSettings.search_context_size || 'medium'
      })
    } else if (toolType === 'code_interpreter') {
      tools.push({
        type: 'code_interpreter',
        container: toolSettings.container || 'default'
      })
    }
  }
  
  return tools
}
```

### 6. Streaming Event Handling

Extend the streaming event system to handle new built-in tool events.

**New Event Types**:
```typescript
// lib/types/events.ts additions
interface WebSearchCallEvent {
  type: 'web_search_call'
  id: string
  status: 'in_progress' | 'searching' | 'completed' | 'failed'
  output_index?: number
  sequence_number?: number
}

interface CodeInterpreterCallEvent {
  type: 'code_interpreter_call'  
  id: string
  status: 'in_progress' | 'interpreting' | 'completed' | 'failed'
  output_index?: number
  sequence_number?: number
}

interface CodeInterpreterCodeEvent {
  type: 'code_interpreter_code'
  id: string
  delta?: string // For streaming code
  code?: string  // For final code
  output_index?: number
  sequence_number?: number
}
```

**Files to Update**:
- `/lib/streaming/frontendEventHandler.ts` - Add new event handlers
- `/components/EventList/EventItem.tsx` - Add rendering for built-in tool events

```typescript
// frontendEventHandler.ts additions
private handleWebSearchEvent(data: any): void {
  const { type, item_id, output_index, sequence_number } = data
  
  switch (type) {
    case 'response.web_search_call.in_progress':
      this.addOrUpdateEvent({
        id: item_id,
        role: 'tool',
        segments: [{
          type: 'web_search_call',
          id: item_id,
          status: 'in_progress'
        }]
      })
      break
      
    case 'response.web_search_call.searching':
      this.updateEventSegment(item_id, { status: 'searching' })
      break
      
    case 'response.web_search_call.completed':
      this.updateEventSegment(item_id, { status: 'completed' })
      break
  }
}

private handleCodeInterpreterEvent(data: any): void {
  const { type, item_id, output_index, sequence_number } = data
  
  switch (type) {
    case 'response.code_interpreter_call.in_progress':
      this.addOrUpdateEvent({
        id: item_id,
        role: 'tool',
        segments: [{
          type: 'code_interpreter_call',
          id: item_id,
          status: 'in_progress'
        }]
      })
      break
      
    case 'response.code_interpreter_call_code.delta':
      // Stream code delta
      this.appendToCodeSegment(item_id, data.delta)
      break
      
    case 'response.code_interpreter_call_code.done':
      // Finalize code
      this.finalizeCodeSegment(item_id, data.code)
      break
  }
}
```

### 7. UI Components for Built-in Tool Events

Create new segment renderers for built-in tool events.

**New Components**:
- `/components/EventList/WebSearchSegment.tsx`
- `/components/EventList/CodeInterpreterSegment.tsx`

```typescript
// WebSearchSegment.tsx
const WebSearchSegment: React.FC<{
  segment: WebSearchCallEvent
}> = ({ segment }) => {
  return (
    <div className="border rounded-lg p-3 bg-blue-50">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4" />
        <span className="font-medium">Web Search</span>
        <Badge variant={segment.status === 'completed' ? 'default' : 'secondary'}>
          {segment.status}
        </Badge>
      </div>
      
      {segment.status === 'searching' && (
        <div className="mt-2 text-sm text-muted-foreground">
          Searching the web for relevant information...
        </div>
      )}
      
      {segment.status === 'completed' && (
        <div className="mt-2 text-sm text-green-600">
          Search completed successfully
        </div>
      )}
    </div>
  )
}

// CodeInterpreterSegment.tsx  
const CodeInterpreterSegment: React.FC<{
  segment: CodeInterpreterCallEvent & { code?: string }
}> = ({ segment }) => {
  return (
    <div className="border rounded-lg p-3 bg-green-50">
      <div className="flex items-center gap-2">
        <Code className="h-4 w-4" />
        <span className="font-medium">Code Interpreter</span>
        <Badge variant={segment.status === 'completed' ? 'default' : 'secondary'}>
          {segment.status}
        </Badge>
      </div>
      
      {segment.code && (
        <div className="mt-2">
          <CodeBlock language="python" code={segment.code} />
        </div>
      )}
      
      {segment.status === 'interpreting' && (
        <div className="mt-2 text-sm text-muted-foreground">
          Running Python code...
        </div>
      )}
    </div>
  )
}
```

### 8. Update Existing Components

**Files to Update**:
- `/components/EventList/SequentialSegmentRenderer.tsx` - Add cases for new segment types
- `/lib/modelMapping.ts` - Export new helper functions
- `/components/settings-panel.tsx` - Add built-in tools override section

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
1. ✅ Create design document
2. Extend model mapping with capabilities system
3. Create database migration for built-in tools config
4. Update Bud interface and types

### Phase 2: Configuration UI (Week 2) 
1. Update BudForm with built-in tools section
2. Add built-in tools to settings panel overrides
3. Update model selection logic to show available tools
4. Add validation for tool configurations

### Phase 3: API Integration (Week 2-3)
1. Update OpenAIResponsesProvider to include built-in tools
2. Implement tool configuration merging (bud config + overrides)
3. Test API requests with built-in tools
4. Handle tool selection and tool_choice logic

### Phase 4: Streaming & UI (Week 3-4)
1. Extend streaming event handlers for new event types
2. Create UI components for built-in tool events
3. Update event list rendering
4. Test end-to-end streaming with built-in tools

### Phase 5: Testing & Polish (Week 4)
1. Comprehensive testing with different tool combinations
2. Error handling for failed tool calls
3. Performance testing with streaming events
4. Documentation updates

## Technical Considerations

### Compatibility
- Built-in tools only work with Responses API models
- Need graceful fallback when tools aren't supported
- Existing MCP and function calling should work alongside built-in tools

### Performance
- Built-in tool events may generate high-frequency streams
- Need efficient event batching and UI updates
- Consider rate limiting or throttling for rapid events

### Error Handling
- Built-in tools can fail independently of the main response
- Need clear error states and retry mechanisms
- Graceful degradation when tools are unavailable

### Security
- Built-in tools access external resources (web, code execution)
- Need appropriate warnings and user consent
- Consider usage limits and monitoring

## Future Enhancements

1. **Tool Result Inclusion**: Use the `include` parameter to show tool outputs
2. **Tool Analytics**: Track usage and success rates of built-in tools
3. **Custom Tool Settings**: More granular control over tool behavior
4. **Tool Chaining**: Coordinate between MCP tools and built-in tools
5. **Workspace-Level Policies**: Admin controls for built-in tool usage

## Migration Strategy

This is an additive change that maintains backward compatibility:

1. New database columns are nullable with defaults
2. Existing buds continue to work without built-in tools
3. UI gracefully handles models without built-in tool support
4. API requests work with or without built-in tools

## Success Metrics

1. Users can successfully configure built-in tools in buds
2. Web search and code interpreter tools execute successfully
3. Streaming events display properly in the UI
4. Performance remains acceptable with tool streaming
5. No regressions in existing MCP or function calling functionality