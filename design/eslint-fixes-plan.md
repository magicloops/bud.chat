# ESLint Fixes Plan

This document outlines all current ESLint errors and our systematic plan to fix them. We'll categorize the issues and tackle them methodically.

## Issue Categories

### 1. TypeScript `any` Types (`@typescript-eslint/no-explicit-any`)
**Priority: HIGH** - These break type safety and should be properly typed

### 2. HTML Entity Escaping (`react/no-unescaped-entities`)
**Priority: MEDIUM** - These are cosmetic but should be fixed for proper React compliance

### 3. Variable Declaration (`prefer-const`)
**Priority: LOW** - Code quality improvements

---

## Detailed Issue Breakdown

### 🚨 HIGH PRIORITY: TypeScript `any` Types

#### API Routes - Chat & Events
- **`/app/(chat)/new/page.tsx`**: 7 instances
  - Lines: 99, 162, 215, 259, 260, 374, 449
  - **Context**: Event handling, form data, API responses
  
- **`/app/api/chat-events/route.ts`**: 4 instances  
  - Lines: 25, 28, 296, 339
  - **Context**: Request parsing, error handling
  
- **`/app/api/chat-new/route.ts`**: 9 instances
  - Lines: 25×2, 38, 39, 82, 85, 397, 456, 517, 606
  - **Context**: Request body parsing, MCP integration
  
- **`/app/api/chat-responses/route.ts`**: 6 instances
  - Lines: 56, 57, 109, 136, 141, 142
  - **Context**: Response handling, error management

#### API Routes - CRUD Operations  
- **`/app/api/buds/[id]/route.ts`**: 1 instance
  - Line: 127
  - **Context**: Database operations

- **`/app/api/chat/[conversationId]/route.ts`**: 2 instances
  - Lines: 310, 339  
  - **Context**: Conversation management

- **`/app/api/conversations/[id]/route.ts`**: 9 instances
  - Lines: 54, 56, 67, 80, 148, 150, 157, 218, 220
  - **Context**: Database queries, response formatting

- **`/app/api/conversations/[id]/branch/route.ts`**: 2 instances
  - Lines: 85, 91
  - **Context**: Conversation branching logic

- **`/app/api/conversations/route.ts`**: 1 instance
  - Line: 67
  - **Context**: Database operations

- **`/app/api/mcp/servers/[id]/route.ts`**: 1 instance
  - Line: 129
  - **Context**: MCP server configuration

- **`/app/api/workspaces/route.ts`**: 1 instance
  - Line: 56
  - **Context**: Workspace management

#### Components
- **`/components/DebugPanel.tsx`**: 2 instances
  - Lines: 12, 170
  - **Context**: Debug information display

- **`/components/EventList/EventItem.tsx`**: 4 instances
  - Lines: 268, 269, 488, 489
  - **Context**: Event rendering, tool call handling

- **`/components/EventList/index.tsx`**: 1 instance
  - Line: 214
  - **Context**: Event list management

- **`/components/EventMessage.tsx`**: 4 instances
  - Lines: 85, 86, 169, 170
  - **Context**: Message rendering

- **`/components/EventStream.tsx`**: 3 instances
  - Lines: 17, 330, 332
  - **Context**: Stream event handling

- **`/components/MCP/MCPConfigurationPanel.tsx`**: 1 instance
  - Line: 47
  - **Context**: MCP configuration

- **`/components/Sidebar/ConversationList.tsx`**: 1 instance
  - Line: 108
  - **Context**: Conversation metadata

- **`/components/Sidebar/UserMenu.tsx`**: 1 instance
  - Line: 41
  - **Context**: User profile data

- **`/components/markdown-renderer.tsx`**: 2 instances
  - Lines: 27, 28
  - **Context**: Markdown processing

- **`/components/settings-panel.tsx`**: 1 instance (truncated)
  - Line: 161
  - **Context**: Settings configuration

**Total `any` types: ~55 instances**

### 🔧 MEDIUM PRIORITY: HTML Entity Escaping

#### React Components
- **`/app/(chat)/chat/[conversationId]/page.tsx`**: 3 instances
  - Line: 130 (3 apostrophes)
  - **Fix**: Replace `'` with `&apos;` or use proper quotes

- **`/components/BudCard.tsx`**: 2 instances
  - Line: 104 (2 quotes)
  - **Fix**: Replace `"` with `&quot;`

- **`/components/BudForm.tsx`**: 1 instance
  - Line: 170 (1 apostrophe)
  - **Fix**: Replace `'` with `&apos;`

- **`/components/MCP/MCPServerForm.tsx`**: 4 instances
  - Lines: 137 (2 quotes), 163 (2 quotes)
  - **Fix**: Replace `"` with `&quot;`

- **`/components/auth/login-form.tsx`**: 1 instance
  - Line: 117 (1 apostrophe)
  - **Fix**: Replace `'` with `&apos;`

- **`/components/auth/signup-form.tsx`**: 1 instance
  - Line: 72 (1 apostrophe)  
  - **Fix**: Replace `'` with `&apos;`

**Total entity escaping issues: ~12 instances**

### 📝 LOW PRIORITY: Code Quality

#### Variable Declarations (`prefer-const`)
- **`/app/api/chat/[conversationId]/route.ts`**: 1 instance
  - Line: 254: `maxIterations` should be `const`

- **`/app/api/chat-events/route.ts`**: 1 instance  
  - Line: 296: `maxIterations` should be `const`

- **`/app/api/chat-new/route.ts`**: 1 instance
  - Line: 397: `maxIterations` should be `const`

- **`/app/api/conversations/[id]/branch/route.ts`**: 1 instance
  - Line: 175: `insertedEvents` should be `const`

**Total const issues: 4 instances**

---

## Fix Strategy

### Phase 1: Type Safety Foundation (HIGH PRIORITY)
1. **API Request/Response Types**
   - Create proper interfaces for request bodies (`BudCreateRequest`, `ChatRequest`, etc.)
   - Define response types (`ApiResponse<T>`, `ErrorResponse`)
   - Replace `any` in error handling with `Error | unknown`

2. **Database Types** 
   - Use generated Supabase types instead of `any`
   - Create specific row types for queries

3. **Event System Types**
   - Ensure all event handlers use proper `Event` types  
   - Replace `any` in tool call handling with proper interfaces

4. **MCP Integration Types**
   - Use proper MCP SDK types instead of `any`
   - Create configuration interfaces

### Phase 2: React Compliance (MEDIUM PRIORITY)
1. **HTML Entity Escaping**
   - Replace all unescaped quotes and apostrophes
   - Use React-safe alternatives or escape characters

### Phase 3: Code Quality (LOW PRIORITY)  
1. **Variable Declarations**
   - Convert `let` to `const` where values don't change
   - Review variable scoping

---

## Implementation Plan

### Step 1: Create Type Definitions
- Add to `/lib/types.ts`:
  ```typescript
  // API Request/Response types
  interface ApiResponse<T> { data: T }
  interface ErrorResponse { error: string }
  
  // Request body types  
  interface BudCreateRequest { ... }
  interface ChatRequest { ... }
  ```

### Step 2: Fix API Routes (Highest Impact)
- Start with most critical: chat endpoints (`/api/chat-*`)
- Move to CRUD endpoints (`/api/conversations`, `/api/buds`)  
- Finish with MCP/workspace endpoints

### Step 3: Fix Components  
- Priority: Event handling components (EventList, EventMessage)
- Then: Configuration components (MCP, Settings)
- Finally: UI components (Sidebar, Auth)

### Step 4: HTML Entity Fixes
- Batch replace all unescaped entities
- Test rendering to ensure no visual changes

### Step 5: Code Quality  
- Quick const fixes
- Final linting validation

---

## Success Criteria

✅ **Zero `@typescript-eslint/no-explicit-any` errors**  
✅ **Zero `react/no-unescaped-entities` errors**  
✅ **Zero `prefer-const` errors**  
✅ **All types properly defined and documented**  
✅ **No runtime errors introduced by type changes**

**Target: Complete type safety across the entire codebase**