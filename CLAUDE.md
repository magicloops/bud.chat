# CLAUDE.md - Development Notes & Patterns

Important: Think carefully and only action the specific task I have given you with the most concise and elegant solution that changes as little code as possible.

This file contains important patterns, gotchas, and conventions for working with this codebase.

---

## ⚠️ Critical Development Guidelines

### Package Manager
- **ALWAYS use `pnpm`** - This project uses pnpm, not npm or yarn
- Examples: `pnpm install`, `pnpm run dev`, `pnpm build`

### Database Management
- **NEVER run `pnpm supabase db reset`** - This will wipe out all existing data
- Use `pnpm supabase db push` to apply new migrations
- Use `pnpm supabase migration new <name>` to create new migrations
- Test migrations on local database first before applying to production

### Model Mapping & Centralization
- **Use friendly model names** in UI/configs (e.g., `claude-3-5-sonnet`, `gpt-4o`)
- **Automatic API mapping** - system maps to actual API models (e.g., `claude-3-5-sonnet-20241022`)
- **Provider detection** - automatically detects OpenAI vs Anthropic models for MCP routing
- **Centralized model lists** - all UI components use same model definitions
- **Location**: `/lib/modelMapping.ts` - update here when new model versions are released

```typescript
// ✅ GOOD - Use centralized functions
import { getModelsForUI, getDefaultModel } from '@/lib/modelMapping'

// In UI components
{getModelsForUI().map(model => <SelectItem value={model.value}>{model.label}</SelectItem>)}

// For defaults
const defaultConfig = { model: getDefaultModel() }

// ❌ BAD - Don't hardcode models in components
<SelectItem value="gpt-4o">GPT-4o</SelectItem>
<SelectItem value="claude-3-5-sonnet">Claude 3.5 Sonnet</SelectItem>
```

**Centralized Components:**
- ✅ `BudForm.tsx` - Uses `getModelsForUI()`
- ✅ `settings-panel.tsx` - Uses `getModelsForUI()` 
- ✅ `model-context.tsx` - Uses `getDefaultModel()`
- ✅ `budHelpers.ts` - Uses `getDefaultModel()` in templates

---

## Core Architecture Principles

### Event-Based Messaging
- **Unified Format**: Single event model works across all providers
- **Flexible Segments**: Support text, tools, reasoning in one structure
- **Provider Translation**: EventLog handles conversion to/from provider formats

### Conversation Branching
- **Fractional Indexing**: Efficient insertion between messages
- **Fork from Any Point**: Branch conversations from any event
- **Maintains Context**: Parent conversation context preserved

### Streaming First
- **Real-time UX**: All LLM interactions use streaming
- **Progressive Rendering**: Show content as it arrives
- **Error Recovery**: Graceful handling of stream interruptions

### Tool Integration (MCP)
- **Local Servers**: Node.js MCP servers as child processes
- **Remote Servers**: OpenAI-hosted MCP integration
- **Unified Interface**: Same tool handling regardless of source

---

## State Management (Zustand)

### ⚠️ Derived State Pattern - Prevent Infinite Loops

**Problem:** Using derived selectors directly in Zustand can cause infinite re-renders.

```typescript
// ❌ BAD - This causes infinite loops
export const useWorkspaceBuds = (workspaceId: string) =>
  useBudStore((state) => {
    const budIds = state.workspaceBuds[workspaceId] || [] // New array every time!
    return budIds.map(id => state.buds[id]).filter(Boolean)
  })
```

**Solution:** Use shallow comparison for array/object selectors.

```typescript
// ✅ GOOD - This prevents infinite loops
import { shallow } from 'zustand/shallow'

export const useWorkspaceBuds = (workspaceId: string) => {
  return useBudStore(
    (state) => {
      const budIds = state.workspaceBuds[workspaceId]
      if (!budIds) return []
      return budIds.map(id => state.buds[id]).filter(Boolean)
    },
    shallow // Shallow comparison prevents re-renders when array contents are same
  )
}
```

**Alternative:** Use separate selectors + useMemo for complex derived state.

```typescript
// ✅ ALSO GOOD - For more complex computations
export const useWorkspaceBuds = (workspaceId: string) => {
  const budIds = useBudStore((state) => state.workspaceBuds[workspaceId])
  const buds = useBudStore((state) => state.buds)
  
  return useMemo(() => {
    if (!budIds) return []
    return budIds.map(id => buds[id]).filter(Boolean)
  }, [budIds, buds])
}
```

### Alternative: getState() for one-time reads

For actions or effects that need current state without subscriptions:

```typescript
// ✅ GOOD - For actions/effects
const handleSomething = () => {
  const currentBuds = useBudStore.getState().buds
  // Use currentBuds...
}
```

---

## Database Schema

### Current Tables
- `users` - Auth users (linked to auth.users)
- `workspaces` - User workspaces
- `workspace_members` - Workspace membership with roles
- `buds` - Reusable AI assistant configurations
  - System prompts, model settings, temperature
  - MCP server configurations (local and remote)
  - Custom themes and UI settings
  - Tool configurations and restrictions
- `conversations` - Chat conversations with optional bud_id
- `events` - Unified message/event storage (replaced legacy messages table)
  - Vendor-agnostic event model with JSONB segments
  - Supports text, tool calls, tool results, and reasoning segments
  - Fractional indexing for conversation ordering
  - Response metadata for API-specific information

### Key Relationships
- `conversations.bud_id` → `buds.id` (optional)
- `buds.workspace_id` → `workspaces.id` (null = personal)
- `buds.owner_user_id` → `auth.users.id`
- `events.conversation_id` → `conversations.id`

### Event Architecture
```typescript
interface Event {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  segments: Segment[]  // Array of content segments
  ts: number          // Unix timestamp
  response_metadata?: ResponseMetadata
}

type Segment = 
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: object }
  | { type: 'tool_result'; id: string; output: object }
  | { type: 'reasoning'; id: string; parts: ReasoningPart[] }
```

---

## API Patterns

### API Routes Overview
- `/api/chat` - Unified endpoint (creates/continues chats and streams responses)
- `/api/chat-new` - Legacy new conversation entry (use `/api/chat`)
- `/api/buds` - Bud CRUD operations
- `/api/workspaces` - Workspace management
- `/api/conversations` - Conversation management
- `/api/mcp` - MCP server operations

### Standard Response Format
```typescript
// Success
{ data: T } 

// Error  
{ error: string }

// List responses
{ items: T[], total?: number }
```

### Authentication
All API routes check user auth via Supabase:
```typescript
const { data: { user }, error } = await supabase.auth.getUser()
if (authError || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### Streaming Architecture
- Server-Sent Events (SSE) for real-time updates
- Custom event format supporting multiple segment types
- Progress indicators for long-running operations
- Graceful error handling and recovery

---

## Component Patterns

### Conditional Rendering with Loading States
```typescript
if (loading) return <Skeleton />
if (error) return <ErrorMessage error={error} />
if (!data) return <EmptyState />
return <DataComponent data={data} />
```

### State Management in Components
- Use Zustand stores for global state
- Use local useState for form/UI state
- Use useEffect sparingly, prefer declarative patterns

---

## File Structure

```
app/                              # Next.js app router
├── (chat)/                       # Chat interface pages  
├── (workspace)/[workspaceId]/    # Workspace-scoped routes
├── api/                          # API route handlers
│   ├── chat/                     # Unified chat endpoint (POST streams)
│   ├── buds/                     # Bud management
│   ├── workspaces/               # Workspace operations
│   └── mcp/                      # MCP server management
└── page.tsx                      # Root landing page

components/
├── ui/                          # shadcn/ui base components  
├── chat/                        # Chat-specific components
├── buds/                        # Bud configuration UI
└── workspace/                   # Workspace management UI

lib/
├── chat/                        # Chat engine and adapters
│   ├── ChatEngine.ts            # Core chat processing
│   ├── types.ts                 # Chat-specific types
│   └── adapters/                # Provider adapters
├── mcp/                         # MCP integration
│   ├── mcpClientManager.ts      # MCP client lifecycle
│   ├── mcpConfigResolver.ts     # Config resolution
│   └── streamingHandler.ts      # Tool streaming
├── providers/                   # LLM provider abstractions
├── streaming/                   # SSE and event handling
│   ├── eventBuilder.ts          # Event construction
│   └── frontendEventHandler.ts  # Client event processing
├── supabase/                    # Database client setup
├── types/                       # TypeScript definitions
│   ├── database.ts              # Generated DB types
│   ├── events.ts                # Event system types
│   └── progress.ts              # Progress tracking
├── modelMapping.ts              # Model configuration
├── eventMessageHelpers.ts       # Event/message conversion
└── types.ts                     # Core type definitions

state/                           # Zustand stores
├── budStore.ts                  # Bud state management
├── eventChatStore.ts            # Chat/event state
└── workspaceStore.ts            # Workspace state
```

---

## Common Gotchas

### 1. Zustand Selector Performance
- Always use shallow selectors when possible
- Memoize derived computations
- Don't create new objects/arrays in selectors

### 2. Supabase RLS
- Check RLS policies when queries fail mysteriously
- Use `auth.users.id` not `users.id` for user references
- Test with different user roles

### 3. Next.js App Router
- Server Components can't use hooks
- Client Components need 'use client' directive
- Prefer Server Components when possible

### 4. TypeScript Database Types
- Regenerate types after schema changes: `npx supabase gen types typescript`
- Use Database['public']['Tables']['table_name']['Row'] for row types

### 5. Event Format Conversions
- Events are provider-agnostic, need conversion for API calls
- Use EventLog class methods for conversions
- Tool results have different formats (Anthropic vs OpenAI)

### 6. MCP Tool Calling
- Local MCP servers run as child processes
- Remote MCP servers (OpenAI) require approval configuration
- Tool IDs must be unique across the conversation
- Always check for unresolved tool calls before continuing

---

## Provider Integration Patterns

### Model Selection
```typescript
// ✅ GOOD - Use model mapping functions
import { getApiModelName, getModelProvider, isReasoningModel } from '@/lib/modelMapping'

const apiModel = getApiModelName('claude-3-5-sonnet') // Returns actual API identifier
const provider = getModelProvider('gpt-4o') // Returns 'openai' or 'anthropic'
const useResponsesAPI = isReasoningModel('o1') // Returns true for o-series models
```

### Provider-Specific Handling
- **Anthropic**: System message as parameter, tool_use/tool_result format
- **OpenAI ChatCompletion**: System message in messages array, function calls
- **OpenAI Responses**: Reasoning segments, no temperature support

### MCP Configuration
```typescript
interface MCPBudConfig {
  servers?: string[]              // Local MCP server IDs
  remote_servers?: RemoteMCPConfig[] // OpenAI-hosted servers
  available_tools?: string[]      // Format: "server_id.tool_name"
  disabled_tools?: string[]       // Tools to disable
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}
```

---

## Development Workflow

### Adding New Features
1. Update database schema (if needed)
2. Create API endpoints with proper auth/validation
3. Add helper functions for business logic
4. Create Zustand store for state management
5. Build UI components
6. Test CRUD operations
7. Update this CLAUDE.md with new patterns

### Adding New Models
1. Add model to `MODEL_MAPPING` in `/lib/modelMapping.ts`
2. Test provider detection works correctly
3. Add any special handling (e.g., reasoning models)
4. Update UI if needed for model-specific features

### Working with Events
1. Always use Event/Segment types from `/lib/types/events.ts`
2. Use EventLog for format conversions
3. Maintain unique IDs for tool calls
4. Test streaming with different segment types

### Testing Patterns
- API endpoints: Test auth, validation, error cases
- State management: Test loading/error states
- Components: Test different data states
- Integration: Test full user workflows

---

## Performance Considerations

### Database
- Use indexes for common query patterns
- Implement pagination for large lists
- Use RLS policies efficiently

### Frontend  
- Lazy load heavy components
- Implement optimistic updates
- Cache API responses appropriately
- Use React.memo for expensive renders

### State Management
- Normalize data structures (id-based lookups)
- Separate loading states per entity
- Clear unused data periodically

---

## Security Notes

### Authentication
- All API routes require valid Supabase session
- Check workspace membership before data access
- Use RLS as defense in depth

### Data Validation
- Validate all inputs on both client and server
- Sanitize user content (especially system prompts)
- Rate limit API endpoints

### Secrets Management
- Never commit API keys or secrets
- Use environment variables via process.env (handled for us on Render automatically)
- Rotate keys regularly

---

*This file should be updated whenever new patterns emerge or gotchas are discovered.*
