# Conversation Registry Refactor Plan

## **Current State Analysis**

**Problems to solve:**
1. Complex migration logic between temp and real conversation IDs
2. Separate conversation state in ChatStore vs WorkspaceStore 
3. URL transitions causing re-renders and server fetches
4. Timing issues with state cleanup and component switching
5. Duplicate conversation tracking in multiple stores

## **Proposed Architecture**

### **1. Unified Conversation Store Structure**

```typescript
interface ChatStore {
  // Single source of truth for all conversation data
  conversations: Record<ActualConversationId, ConversationState>
  
  // Registry maps display IDs to storage IDs
  registry: Record<DisplayConversationId, ActualConversationId>
  
  // UI state
  selectedConversationId: DisplayConversationId | null
  
  // Workspace organization (replaces WorkspaceStore.conversations)
  workspaceConversations: Record<WorkspaceId, DisplayConversationId[]>
}
```

### **2. Key Changes Needed**

#### **A. ChatStore Changes**
- ✅ Add `registry` mapping
- ✅ Add `workspaceConversations` (move from WorkspaceStore)
- ✅ Update all actions to use registry lookup
- ✅ Remove `migrateConversation`, `syncConversationMessages`
- ✅ Add `promoteConversation(displayId, realId)`

#### **B. Remove WorkspaceStore Conversations**
- ✅ Remove `conversations` array from WorkspaceStore
- ✅ Remove `addConversation`, `removeConversation` actions
- ✅ Update sidebar to read from ChatStore instead

#### **C. Component Simplification**
- ✅ ConversationPage: Remove local state, always use route param as display ID
- ✅ ChatArea: Remove `onConversationIdChange` callback
- ✅ ChatComposer: Remove complex URL update logic
- ✅ Sidebar: Read conversations from ChatStore

#### **D. Streaming Simplification**
- ✅ Remove migration logic from useStreaming
- ✅ Always stream to display ID, registry handles storage
- ✅ Simple promotion when server returns real ID

## **Detailed Implementation Plan**

### **Phase 1: Update ChatStore Structure**

1. **Add registry and workspace tracking:**
```typescript
interface ChatStore {
  conversations: Record<string, ConversationState>
  registry: Record<string, string>  // displayId -> actualId
  workspaceConversations: Record<string, string[]> // workspaceId -> displayId[]
  selectedConversationId: string | null
}
```

2. **Add helper functions:**
```typescript
// Get conversation by display ID
getConversation: (displayId: string) => ConversationState | undefined

// Promote temp conversation to real ID
promoteConversation: (displayId: string, realId: string) => void

// Add conversation to workspace
addConversationToWorkspace: (workspaceId: string, displayId: string) => void
```

### **Phase 2: Update All Store Actions**

1. **Update existing actions** to use registry lookup:
   - `addMessage(displayId, ...)` -> `addMessage(registry[displayId], ...)`
   - `updateMessage(displayId, ...)` -> `updateMessage(registry[displayId], ...)`
   - etc.

2. **Remove migration-related actions:**
   - Remove `migrateConversation`
   - Remove `syncConversationMessages`

### **Phase 3: Simplify Components**

1. **ConversationPage**: Remove local state management
2. **ChatArea**: Remove conversation ID change handling  
3. **ChatComposer**: Simplify to just call `promoteConversation`
4. **Sidebar**: Read from ChatStore instead of WorkspaceStore

### **Phase 4: Update Streaming Logic**

1. **Remove migration from useStreaming**
2. **Add simple promotion on server response**
3. **No more complex state synchronization**

### **Phase 5: Remove WorkspaceStore Conversations** ✅

1. ✅ **Remove conversation arrays from WorkspaceStore**
2. ✅ **Remove related actions and hooks**
3. ✅ **Update all components that were using WorkspaceStore conversations**

## **Key Benefits After Migration**

1. **Simplified mental model**: Display ID never changes, storage ID updates invisibly
2. **No re-renders**: URL stays stable, components don't need to know about promotion
3. **Single source of truth**: All conversation data in one store
4. **Clean separation**: Display logic vs storage logic
5. **No timing issues**: Atomic registry updates
6. **Easier debugging**: Registry makes ID mapping explicit

## **Migration Strategy**

1. **Additive first**: Add new fields without breaking existing code
2. **Update actions**: Make them registry-aware while maintaining compatibility  
3. **Update components**: Switch to new patterns one by one
4. **Remove old code**: Clean up migration logic and duplicate state

## **Implementation Notes**

### **Registry Pattern Example**
```typescript
// User visits /new
registry: { 'new': 'temp-123' }
conversations: { 'temp-123': { messages: [...] } }

// Server creates real conversation
promoteConversation('new', 'real-456')
registry: { 'new': 'real-456' }  // Updated mapping
conversations: { 
  'temp-123': { messages: [...] },  // Temp data
  'real-456': { messages: [...] }   // Promoted data
}

// Component always uses 'new', gets 'real-456' data transparently
```

### **Workspace Integration**
```typescript
workspaceConversations: {
  'workspace-1': ['new', 'conv-123', 'conv-456'],
  'workspace-2': ['conv-789']
}

// Sidebar reads from workspaceConversations[selectedWorkspace]
// Then resolves each displayId through registry to get actual conversation data
```

### **Streaming Simplification**
```typescript
// Before: Complex migration logic
connect('new') -> migrate('new', 'real-id') -> sync messages -> cleanup

// After: Simple promotion
connect('new') -> promoteConversation('new', 'real-id')
```