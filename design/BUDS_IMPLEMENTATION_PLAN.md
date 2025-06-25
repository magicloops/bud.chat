# Buds Implementation Plan

> **Scope:** Complete implementation of Buds functionality as reusable prompt templates with AI model settings, enabling users to create, customize, and use Buds for new conversations within workspaces.

---

## Executive Summary

Buds are reusable prompt templates that combine:
- **System prompt** (personality/instructions)
- **AI model configuration** (model, temperature, etc.)
- **Identity** (name, emoji/avatar, optional greeting)
- **Workspace integration** (ownership, sharing)

The implementation requires database enhancements, UI/UX components, API endpoints, and integration with the existing conversation creation flow.

---

## 1. Current State Analysis

### 1.1 Database Schema ✅
- **Buds table already defined** in `DATABASE.md`
- Current schema supports all core requirements:
  ```sql
  CREATE TABLE buds (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid REFERENCES users(id),
    workspace_id  uuid REFERENCES workspaces(id), -- NULL ⇒ personal only
    name          text NOT NULL,
    default_json  jsonb NOT NULL,
    created_at    timestamptz DEFAULT now()
  );
  ```

### 1.2 Application Architecture ✅
- **Next.js 14** with App Router
- **Zustand** state management (`simpleChatStore`)
- **Supabase** for database/auth
- **TypeScript** types already include `Bud` interface
- **Existing conversation flow** in `/new` route

### 1.3 Missing Components ❌
- No Bud management UI
- No Bud selection in conversation creation
- No Bud configuration forms
- No Bud-based conversation initialization

---

## 2. Implementation Phases

### Phase 1: Core Bud Management (Priority: High)
**Duration:** 4-6 hours
**Goal:** Users can create, edit, and manage Buds within workspaces

#### 2.1 Database Migrations
```sql
-- Ensure buds table exists (may already be created)
-- Add any missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_buds_workspace_owner 
  ON buds(workspace_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_buds_workspace 
  ON buds(workspace_id) WHERE workspace_id IS NOT NULL;
```

#### 2.2 API Endpoints
- **GET** `/api/buds` - List buds for workspace/user
- **POST** `/api/buds` - Create new bud
- **PUT** `/api/buds/[id]` - Update bud
- **DELETE** `/api/buds/[id]` - Delete bud

#### 2.3 Types & Schema
```typescript
// Extend existing BudConfig type
interface BudConfig {
  name: string
  avatar?: string           // emoji or image URL
  systemPrompt: string
  model: string            // 'gpt-4o', 'claude-3.5-sonnet', etc.
  temperature?: number     // 0-1
  maxTokens?: number
  greeting?: string        // optional first assistant message
  tools?: string[]         // for future MCP integration
}

// Database operations
interface CreateBudArgs {
  name: string
  config: BudConfig
  workspaceId: string
  isPublic?: boolean       // workspace-wide vs personal
}
```

#### 2.4 State Management
```typescript
// Add to simpleChatStore or create budStore
interface BudStore {
  buds: Record<string, Bud>
  workspaceBuds: Record<string, string[]> // workspaceId -> budIds
  
  // Actions
  createBud: (args: CreateBudArgs) => Promise<Bud>
  updateBud: (id: string, updates: Partial<BudConfig>) => Promise<void>
  deleteBud: (id: string) => Promise<void>
  loadWorkspaceBuds: (workspaceId: string) => Promise<void>
}
```

### Phase 2: Bud Selection UI (Priority: High)
**Duration:** 3-4 hours
**Goal:** Integrate Bud selection into conversation creation flow

#### 2.1 Home Page Enhancement
Update `/app/page.tsx` to show Bud selection instead of just "New Conversation":

```typescript
// Replace simple "New Conversation" button with Bud grid
<div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
  {workspaceBuds.map(bud => (
    <BudCard 
      key={bud.id}
      bud={bud}
      onClick={() => handleStartChat(bud)}
    />
  ))}
  <CreateBudCard onClick={() => setShowBudCreator(true)} />
</div>
```

#### 2.2 Bud Card Component
```typescript
interface BudCardProps {
  bud: Bud
  onClick: () => void
}

function BudCard({ bud, onClick }: BudCardProps) {
  const config = bud.default_json as BudConfig
  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{config.avatar || '🤖'}</span>
          <CardTitle className="text-sm">{config.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {config.systemPrompt.slice(0, 80)}...
        </p>
        <Badge variant="secondary" className="mt-2 text-xs">
          {config.model}
        </Badge>
      </CardContent>
    </Card>
  )
}
```

#### 2.3 Enhanced New Chat Flow
Update `/app/(chat)/new/page.tsx` to accept `budId` param:

```typescript
// URL: /new?bud=uuid or /new (uses default)
const searchParams = useSearchParams()
const budId = searchParams.get('bud')

useEffect(() => {
  if (budId) {
    // Load bud config and initialize messages
    loadBudAndInitialize(budId)
  }
}, [budId])
```

### Phase 3: Bud Management Interface (Priority: Medium)
**Duration:** 4-5 hours
**Goal:** Full CRUD interface for Buds within workspace settings

#### 3.1 Bud Management Page
Create `/app/(workspace)/[workspaceId]/buds/page.tsx`:

```typescript
function BudsManagementPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Workspace Buds</h1>
        <Button onClick={() => setShowCreator(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Bud
        </Button>
      </div>
      
      <BudsList 
        buds={workspaceBuds}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
      
      {showCreator && (
        <BudCreatorDialog 
          onSave={handleCreate}
          onClose={() => setShowCreator(false)}
        />
      )}
    </div>
  )
}
```

#### 3.2 Bud Creator/Editor Form
```typescript
interface BudFormProps {
  bud?: Bud
  onSave: (config: BudConfig) => Promise<void>
  onCancel: () => void
}

function BudForm({ bud, onSave, onCancel }: BudFormProps) {
  const [config, setConfig] = useState<BudConfig>(
    bud?.default_json || {
      name: '',
      systemPrompt: '',
      model: 'gpt-4o',
      temperature: 0.7,
      avatar: '🤖'
    }
  )
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name">
          <Input 
            value={config.name}
            onChange={(e) => setConfig({...config, name: e.target.value})}
          />
        </FormField>
        
        <FormField label="Avatar">
          <EmojiPicker 
            value={config.avatar}
            onSelect={(emoji) => setConfig({...config, avatar: emoji})}
          />
        </FormField>
      </div>
      
      <FormField label="System Prompt">
        <Textarea 
          value={config.systemPrompt}
          onChange={(e) => setConfig({...config, systemPrompt: e.target.value})}
          rows={6}
          placeholder="You are a helpful assistant that..."
        />
      </FormField>
      
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Model">
          <Select value={config.model} onValueChange={(model) => setConfig({...config, model})}>
            <SelectItem value="gpt-4o">GPT-4o</SelectItem>
            <SelectItem value="claude-3.5-sonnet">Claude 3.5 Sonnet</SelectItem>
            <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
          </Select>
        </FormField>
        
        <FormField label="Temperature">
          <Slider 
            value={[config.temperature || 0.7]} 
            onValueChange={([temp]) => setConfig({...config, temperature: temp})}
            min={0} max={1} step={0.1}
          />
        </FormField>
      </div>
      
      <FormField label="Greeting (Optional)">
        <Textarea 
          value={config.greeting || ''}
          onChange={(e) => setConfig({...config, greeting: e.target.value})}
          rows={3}
          placeholder="Hello! I'm here to help you with..."
        />
      </FormField>
    </form>
  )
}
```

### Phase 4: Conversation Integration (Priority: High)
**Duration:** 4-6 hours
**Goal:** Conversations properly initialize with Bud configuration and display Bud identity

#### 4.1 Conversation as Source of Truth
**Key Insight:** Conversations are the source of truth for all chat settings. Buds are just presets/templates that seed initial conversation configuration.

```typescript
// Conversation schema enhancement
interface Conversation {
  id: string
  workspace_id: string
  title: string
  
  // Chat Identity (from Bud preset)
  assistant_name: string           // e.g. "Code Assistant", "Creative Writer"
  assistant_avatar: string         // emoji or image URL
  
  // Bud relationship
  source_bud_id?: string          // Which bud seeded this conversation
  bud_disconnected: boolean       // true if settings diverged from source bud
  
  // Flexible model settings in JSON
  model_config: {
    model: string                 // 'gpt-4o', 'claude-3.5-sonnet', etc.
    temperature: number           // 0-1
    max_tokens?: number
    system_prompt: string
    greeting?: string
    // Model-specific settings without DB migrations:
    top_p?: number               // For OpenAI models
    presence_penalty?: number    // For OpenAI models  
    anthropic_version?: string   // For Anthropic models
    // ... future model settings
  }
  
  created_at: timestamp
  updated_at: timestamp
}

// When creating conversation from bud:
const conversation = {
  assistant_name: budConfig.name,
  assistant_avatar: budConfig.avatar || '🤖',
  source_bud_id: bud.id,
  bud_disconnected: false,
  model_config: {
    model: budConfig.model,
    temperature: budConfig.temperature || 0.7,
    system_prompt: budConfig.systemPrompt,
    greeting: budConfig.greeting,
    max_tokens: budConfig.maxTokens
  }
}
```

#### 4.2 Bud Disconnection Detection
**Goal:** Track when conversation settings diverge from the source Bud

```typescript
// Check if conversation has diverged from source bud
export function checkBudDisconnection(conversation: Conversation, sourceBud?: Bud): boolean {
  if (!sourceBud || !conversation.source_bud_id) return false
  
  const budConfig = sourceBud.default_json as BudConfig
  const { model_config, assistant_name, assistant_avatar } = conversation
  
  // Compare key settings
  return (
    assistant_name !== budConfig.name ||
    assistant_avatar !== (budConfig.avatar || '🤖') ||
    model_config.model !== budConfig.model ||
    model_config.temperature !== (budConfig.temperature || 0.7) ||
    model_config.system_prompt !== budConfig.systemPrompt ||
    model_config.max_tokens !== budConfig.maxTokens
  )
}

// Update conversation disconnection status
export async function updateBudDisconnectionStatus(
  conversationId: string, 
  conversation: Conversation, 
  sourceBud?: Bud
) {
  const isDisconnected = checkBudDisconnection(conversation, sourceBud)
  
  if (conversation.bud_disconnected !== isDisconnected) {
    await supabase
      .from('conversations')
      .update({ bud_disconnected: isDisconnected })
      .eq('id', conversationId)
  }
}
```

#### 4.3 Assistant Identity in Messages
**Goal:** Assistant messages display conversation's assistant name and avatar

```typescript
// Update message display logic - reads from conversation, not bud
export function getMessageDisplayName(message: Message, conversation?: Conversation): string {
  if (message.role === 'assistant' && conversation?.assistant_name) {
    return conversation.assistant_name
  }
  return message.role === 'user' ? 'You' : 'Assistant'
}

export function getMessageAvatar(message: Message, conversation?: Conversation): string {
  if (message.role === 'assistant' && conversation?.assistant_avatar) {
    return conversation.assistant_avatar
  }
  return message.role === 'user' ? '👤' : '🤖'
}
```

#### 4.4 Enhanced Message Helpers
Update `/lib/messageHelpers.ts`:

```typescript
export function createSystemMessageFromConversation(conversation: Conversation): Message {
  return {
    id: generateId(),
    conversation_id: conversation.id,
    role: 'system',
    content: conversation.model_config.system_prompt,
    order_key: generateKeyBefore(null),
    json_meta: { type: 'system' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

export function createGreetingMessageFromConversation(conversation: Conversation): Message | null {
  if (!conversation.model_config.greeting) return null
  
  return {
    id: generateId(),
    conversation_id: conversation.id,
    role: 'assistant',
    content: conversation.model_config.greeting,
    order_key: generateKeyAfter(null),
    json_meta: { type: 'greeting' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}
```

#### 4.5 Update Chat API
Enhance `/api/chat-new/route.ts` to use conversation configuration:

```typescript
// Get conversation to extract model config
const { data: conversation } = await supabase
  .from('conversations')
  .select('*')
  .eq('id', conversationId)
  .single()

if (!conversation) {
  throw new Error('Conversation not found')
}

// Use conversation's model config directly
const modelConfig = conversation.model_config

// Use modelConfig in OpenAI/Anthropic client
const stream = await openai.chat.completions.create({
  model: modelConfig.model,
  temperature: modelConfig.temperature,
  max_tokens: modelConfig.max_tokens,
  // Add model-specific settings:
  top_p: modelConfig.top_p,
  presence_penalty: modelConfig.presence_penalty,
  // ... other settings from JSON
})
```

#### 4.6 Database Migration
Add new fields to conversations table:

```sql
-- Add new columns to conversations table
ALTER TABLE conversations 
ADD COLUMN assistant_name text DEFAULT 'Assistant',
ADD COLUMN assistant_avatar text DEFAULT '🤖',
ADD COLUMN source_bud_id uuid REFERENCES buds(id),
ADD COLUMN bud_disconnected boolean DEFAULT false,
ADD COLUMN model_config jsonb DEFAULT '{"model": "gpt-4o", "temperature": 0.7, "system_prompt": "You are a helpful assistant."}';

-- Update existing conversations with default values
UPDATE conversations 
SET model_config = jsonb_build_object(
  'model', 'gpt-4o',
  'temperature', 0.7,
  'system_prompt', 'You are a helpful assistant.'
) 
WHERE model_config IS NULL;

-- Add index for source_bud_id lookups
CREATE INDEX idx_conversations_source_bud ON conversations(source_bud_id);
```

#### 4.7 UI Updates for Assistant Identity
Update message components to show conversation's assistant identity:

```typescript
// In message display component
function MessageBubble({ message, conversation }: { message: Message, conversation?: Conversation }) {
  const displayName = getMessageDisplayName(message, conversation)
  const avatar = getMessageAvatar(message, conversation)
  
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0">
        <span className="text-2xl">{avatar}</span>
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-muted-foreground mb-1">
          {displayName}
          {conversation?.bud_disconnected && conversation?.source_bud_id && (
            <Badge variant="outline" className="ml-2 text-xs">
              Custom
            </Badge>
          )}
        </div>
        <div className="prose">{message.content}</div>
      </div>
    </div>
  )
}
```

---

## 3. Technical Implementation Details

### 3.1 File Structure
```
app/
├── (workspace)/
│   └── [workspaceId]/
│       └── buds/
│           ├── page.tsx          # Bud management interface
│           └── [budId]/
│               └── edit/
│                   └── page.tsx  # Edit specific bud
├── api/
│   └── buds/
│       ├── route.ts              # GET, POST /api/buds
│       └── [id]/
│           └── route.ts          # PUT, DELETE /api/buds/[id]
└── page.tsx                      # Enhanced with bud selection

components/
├── BudCard.tsx                   # Bud selection card
├── BudForm.tsx                   # Create/edit form
├── BudsList.tsx                  # Management list view
└── EmojiPicker.tsx              # Avatar selection

lib/
├── budHelpers.ts                 # Bud-related utilities
└── messageHelpers.ts            # Enhanced with bud support
```

### 3.2 Database Operations
```typescript
// lib/budHelpers.ts
export async function createBud(args: CreateBudArgs): Promise<Bud> {
  const { data, error } = await supabase
    .from('buds')
    .insert({
      name: args.name,
      default_json: args.config,
      workspace_id: args.workspaceId,
      owner_user_id: (await supabase.auth.getUser()).data.user?.id
    })
    .select()
    .single()
    
  if (error) throw error
  return data
}

export async function getWorkspaceBuds(workspaceId: string): Promise<Bud[]> {
  const { data, error } = await supabase
    .from('buds')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    
  if (error) throw error
  return data || []
}
```

### 3.3 URL Structure
- `/` - Home with Bud selection grid
- `/new` - Generic new chat (uses default bud)
- `/new?bud=uuid` - New chat with specific bud
- `/workspace/[id]/buds` - Bud management
- `/workspace/[id]/buds/[budId]/edit` - Edit specific bud

---

## 4. UX/UI Considerations

### 4.1 Home Page Flow
1. **User lands on `/`** → sees workspace buds in grid layout
2. **Clicks bud card** → navigates to `/new?bud=uuid`
3. **New chat initializes** with bud's system prompt + greeting
4. **User sends first message** → conversation saves with `bud_id` reference

### 4.2 Bud Management Flow
1. **Access via workspace settings** or dedicated `/workspace/[id]/buds` route
2. **Create/Edit forms** with live preview of bud personality
3. **Template suggestions** for common bud types (coding assistant, creative writer, etc.)

### 4.3 Visual Design
- **Bud cards** show avatar (emoji), name, model badge, truncated prompt
- **Color coding** by model type (OpenAI vs Anthropic vs local)
- **Usage indicators** showing how many conversations used each bud

---

## 5. Success Metrics

### 5.1 Phase 1 Complete ✅
- [x] Users can create buds via form interface
- [x] Buds are properly saved to database with workspace association
- [x] Basic CRUD operations work for bud management

### 5.2 Phase 2 Complete ✅
- [x] Home page shows bud selection grid instead of single "New Chat" button
- [x] Clicking bud card starts new conversation with proper initialization
- [x] Bud configuration (system prompt, model) is respected in conversations

### 5.3 Phase 3 Complete ✅
- [x] Full management interface for workspace buds
- [x] Users can edit existing buds and see changes reflected immediately
- [x] Proper permission handling (owners can edit, members can use)

### 5.4 Phase 4 Complete ✅
- [x] Conversations properly associate with originating bud
- [x] Model configuration from bud is used in API calls
- [x] Assistant messages display bud name and avatar consistently
- [x] Optimistic messages show bud identity immediately
- [x] Existing conversations work properly with override-only approach

---

## 6. Future Enhancements (Post-MVP)

### 6.1 Advanced Features
- **Bud templates** - Pre-made buds for common use cases
- **Bud sharing** - Export/import bud configurations
- **Usage analytics** - Track which buds are most popular
- **A/B testing** - Compare bud variations
- **Create Bud from Chat** - Convert existing conversations into reusable Buds

#### 6.1.1 Create Bud from Chat (Phase 5)
**Goal:** Allow users to create new Buds based on successful conversation patterns

```typescript
// Extract conversation characteristics to create bud
interface ChatToBudAnalysis {
  inferredSystemPrompt: string     // Analyze conversation pattern
  modelUsed: string               // From conversation metadata
  averageTemperature: number      // From API calls
  suggestedName: string          // Based on conversation topic
  suggestedAvatar: string        // Based on conversation type
}

// UI workflow:
// 1. User clicks "Create Bud from this Chat" in conversation menu
// 2. System analyzes conversation history and suggests bud configuration
// 3. User reviews and adjusts suggested configuration
// 4. New bud is created and available for future conversations
```

### 6.2 MCP Integration (Phase 5)
- **Tool binding** - Associate MCP tools with specific buds
- **Bud-as-server** - Expose buds as MCP endpoints for other tools
- **Tool registry sidebar** - Browse available tools per bud

### 6.3 Advanced Configuration
- **Multiple system messages** - Complex prompt engineering
- **Conditional logic** - Bud behavior based on context
- **Memory/RAG** - Bud-specific knowledge bases

---

## 7. Risk Assessment & Mitigation

### 7.1 Technical Risks
- **Performance** - Loading many buds on home page
  - *Mitigation*: Pagination, lazy loading, aggressive caching
- **State complexity** - Managing bud state alongside chat state
  - *Mitigation*: Separate stores, clear data flow patterns

### 7.2 UX Risks  
- **Cognitive overload** - Too many bud options overwhelming users
  - *Mitigation*: Smart defaults, categorization, search/filter
- **Configuration complexity** - Bud creation too complicated
  - *Mitigation*: Progressive disclosure, templates, guided setup

### 7.3 Data Risks
- **Bud conflicts** - Multiple users editing same bud
  - *Mitigation*: Optimistic locking, conflict resolution UI
- **Prompt injection** - Malicious system prompts
  - *Mitigation*: Content filtering, user education, workspace isolation

---

## 8. Implementation Timeline

| Phase | Duration | Dependencies | Risk Level |
|-------|----------|--------------|------------|
| **Phase 1**: Core Management | 4-6 hours | Database migrations | Low |
| **Phase 2**: Selection UI | 3-4 hours | Phase 1 complete | Low |
| **Phase 3**: Full Management | 4-5 hours | Phases 1-2 complete | Medium |
| **Phase 4**: Integration | 2-3 hours | All previous phases | Medium |

**Total Estimated Time:** 13-18 hours (2-3 days of focused development)

---

## Next Steps

1. **Start with Phase 1** - Implement basic Bud CRUD operations
2. **Validate database schema** - Ensure migrations are ready
3. **Create API endpoints** - Build the foundation for Bud management
4. **Implement Bud creation form** - Enable users to create their first Buds

The implementation should be incremental, with each phase building on the previous one while maintaining backward compatibility with existing conversations.