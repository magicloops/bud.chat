# CLAUDE.md - Development Notes & Patterns

This file contains important patterns, gotchas, and conventions for working with this codebase.

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
- `buds` - Reusable prompt templates
- `conversations` - Chat conversations with optional bud_id
- `messages` - Chat messages with fractional indexing
- `message_revisions` - Audit trail for message edits

### Key Relationships
- `conversations.bud_id` → `buds.id` (optional)
- `buds.workspace_id` → `workspaces.id` (null = personal)
- `buds.owner_user_id` → `auth.users.id`

---

## API Patterns

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
app/
├── (workspace)/[workspaceId]/    # Workspace-scoped routes
├── api/                          # API routes
└── page.tsx                      # Root page

components/
├── ui/                          # shadcn/ui components  
└── [feature]/                   # Feature-specific components

lib/
├── supabase/                    # Database client setup
├── types.ts                     # Shared TypeScript types
└── [feature]Helpers.ts          # Utility functions

state/
└── [feature]Store.ts            # Zustand stores
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
