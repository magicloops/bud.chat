# Bud.chat Architecture Overview

## Executive Summary

Bud.chat is a multi-user LLM workspace application that provides pre-configured AI assistants ("Buds"), conversation branching, and integrated tool calling capabilities through MCP (Model Context Protocol). The application has recently evolved from a message-based architecture to an event-based system that unifies support for both Anthropic and OpenAI models, including advanced reasoning models via OpenAI's Responses API.

## Core Architecture Components

### 1. Database Schema

The application uses Supabase (PostgreSQL) with the following core tables:

#### User & Workspace Management
- **users** - Linked to Supabase auth.users
- **workspaces** - User-owned workspaces for collaboration
- **workspace_members** - Membership and role management

#### Conversation System
- **buds** - Reusable AI assistant configurations
  - System prompts, model settings, temperature
  - MCP server configurations (local and remote)
  - Custom themes and UI settings
  - Tool configurations and restrictions
  
- **conversations** - Chat conversations
  - Optional link to a bud configuration
  - Workspace-scoped with RLS policies
  - Metadata for assistant identity overrides
  
- **events** - Unified message/event storage (replacing legacy messages table)
  - Vendor-agnostic event model
  - Supports text, tool calls, tool results, and reasoning segments
  - Fractional indexing for conversation ordering
  - JSONB segments for flexible content types
  - Response metadata for API-specific information

### 2. Event-Based Architecture

The system has migrated from traditional messages to a flexible event system:

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

This design enables:
- Unified handling of different provider formats
- Support for streaming reasoning models
- Flexible tool calling patterns
- Conversation branching from any event

### 3. Provider Abstraction

#### Model Mapping System
- Friendly model names (e.g., "claude-3-5-sonnet") map to API versions
- Automatic provider detection based on model selection
- Centralized configuration in `/lib/modelMapping.ts`
- Support for reasoning models (o1, o3, etc.) with special handling

#### API Integration
- **Anthropic SDK** - Direct integration for Claude models
- **OpenAI SDK** - ChatCompletion API for standard models
- **OpenAI Responses API** - For reasoning models (o-series)
- Unified streaming response format across providers

### 4. Tool Calling & MCP Integration

#### Local MCP Servers
- Node.js-based MCP server support
- Server configuration in workspace settings
- Dynamic tool discovery and registration
- Process management for server lifecycle

#### Remote MCP (OpenAI Integration)
- Support for OpenAI-hosted MCP servers
- Tool approval workflows (never/always/selective)
- Custom headers and authentication
- Unified tool result handling

#### Tool Architecture
- Events store tool calls and results as segments
- Tool state tracking across conversation
- Streaming tool execution support
- Provider-specific formatting (tool_use vs function calls)

### 5. State Management

#### Zustand Stores
- **budStore** - Bud CRUD operations and workspace associations
- **eventChatStore** - Conversation state, streaming, and optimistic updates
- **workspaceStore** - Workspace and membership management

#### Key Patterns
- Shallow comparison for derived state (prevents re-render loops)
- Optimistic updates for better UX
- Normalized data structures (ID-based lookups)
- Separate loading states per entity

### 6. API Routes

#### Chat Endpoints
- `/api/chat-new` - Create new conversations
- `/api/chat-events` - Streaming chat with events
- `/api/chat-responses` - OpenAI Responses API integration
- `/api/chat/[conversationId]` - Legacy endpoint (being phased out)

#### Resource Management
- `/api/buds` - Bud CRUD operations
- `/api/workspaces` - Workspace management
- `/api/conversations` - Conversation management
- `/api/mcp` - MCP server operations

### 7. Frontend Architecture

#### Component Structure
- Next.js 15 App Router with React 19
- Server Components for initial data loading
- Client Components for interactive features
- Tailwind CSS with shadcn/ui components

#### Key Components
- Chat interface with streaming support
- Bud configuration forms
- Workspace management UI
- Settings panels for MCP configuration
- Conversation branching interface

### 8. Streaming Architecture

#### Event Streaming
- Server-Sent Events (SSE) for real-time updates
- Custom event format supporting multiple segment types
- Progress indicators for long-running operations
- Graceful error handling and recovery

#### Reasoning Model Support
- Chunked reasoning display
- Real-time token counting
- Effort level visualization
- Seamless integration with standard chat flow

### 9. Security & Authentication

#### Row Level Security (RLS)
- PostgreSQL RLS policies on all tables
- Workspace-based access control
- User ownership verification
- Hierarchical permission model

#### API Security
- Supabase authentication on all endpoints
- Workspace membership validation
- Input sanitization and validation
- Rate limiting considerations

### 10. Development Patterns

#### Package Management
- **pnpm** as the package manager (critical - not npm/yarn)
- Workspace configuration for monorepo potential

#### Code Organization
```
app/           - Next.js app router pages
├── api/       - API route handlers
├── (chat)/    - Chat interface pages
└── workspace/ - Workspace management

lib/           - Core business logic
├── chat/      - Chat engine and adapters
├── mcp/       - MCP integration
├── providers/ - LLM provider abstractions
├── streaming/ - SSE and event handling
├── supabase/  - Database client
└── types/     - TypeScript definitions

components/    - React components
├── ui/        - Base UI components (shadcn)
└── [feature]/ - Feature-specific components

state/         - Zustand stores
```

#### Key Design Decisions
1. **Event-based messaging** - Flexibility for multiple providers
2. **Fractional indexing** - Efficient conversation branching
3. **JSONB segments** - Extensible content types
4. **Streaming-first** - Better UX for LLM interactions
5. **Provider abstraction** - Easy addition of new models/providers

## Recent Major Changes

1. **Migration from Messages to Events** - Unified data model for all providers
2. **OpenAI Responses API Integration** - Support for reasoning models
3. **MCP Integration** - Both local and remote tool execution
4. **Model Mapping System** - Centralized model configuration
5. **Streaming Improvements** - Better handling of complex responses

## Configuration & Environment

### Required Environment Variables
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `OPENAI_API_KEY` - OpenAI API access
- `ANTHROPIC_API_KEY` - Anthropic API access

### Database Migrations
- Located in `/supabase/migrations/`
- Applied via `pnpm supabase db push`
- Never use `db reset` (data loss)

## Performance Considerations

- Indexed database queries on common patterns
- Shallow state selectors to prevent re-renders
- Lazy loading for heavy components
- Streaming responses for better perceived performance
- Normalized state structures for efficient updates

## Areas of Complexity

1. **Event/Message Format Translation** - Converting between provider formats
2. **MCP Tool Handling** - Managing local/remote tool execution
3. **Streaming State Management** - Complex state updates during streaming
4. **Conversation Branching** - Fractional indexing complexity
5. **Provider-Specific Quirks** - Different API behaviors and requirements