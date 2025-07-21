# System Message Editing Design Spec

## Overview
Allow users to view and edit system messages (prompts) both before starting a new conversation and within existing conversations. This provides transparency and customization opportunities for users to tailor the AI's behavior for specific conversations, and enables testing different LLM workflows with chains of messages.

## Current State
- System messages are created from Bud configuration
- They are displayed in the chat interface (yellow box)
- They are sent to the API and saved to the database
- Users cannot modify them before or after starting a conversation

## Proposed Design

### 1. User Experience Flow

#### New Conversation Flow
1. **User navigates to new conversation** with a selected Bud
2. **System message is displayed** prominently at the top of the chat interface
3. **User can edit the system message** before sending their first message
4. **System message is updated** in real-time in the events array
5. **When user sends first message**, the (potentially modified) system message is included
6. **System message is saved** to the database as part of the conversation

#### Existing Conversation Flow
1. **User opens existing conversation** with message history
2. **System message is displayed** at the top of the conversation (if exists)
3. **User can click "Edit System Prompt"** to modify the system message
4. **System message is updated** in the database immediately
5. **All future messages** in the conversation use the updated system prompt
6. **Past messages remain unchanged** (maintains conversation integrity)

### 2. UI Components

#### System Message Display
- **Location**: Top of the chat interface in both new and existing conversations
- **Styling**: Distinct from regular messages (yellow/amber background, monospace font)
- **Content**: Full system prompt text from the Bud configuration or saved system message
- **State**: Always editable (with appropriate permissions)

#### Edit Interface
**Option A: Inline Editing**
- Click on system message to enter edit mode
- Text becomes editable with a textarea
- Save/Cancel buttons appear
- Auto-resize textarea to fit content

**Option B: Modal/Popup**
- "Edit System Prompt" button on system message
- Opens modal with larger textarea for editing
- Save/Cancel buttons in modal
- Better for longer system prompts

**Option C: Collapsible Section**
- System message collapsed by default with preview
- "Edit System Prompt" button to expand
- Inline editing within expanded section
- Good balance of space and functionality

#### Visual States
- **Default**: System message visible, with subtle edit indicator
- **Editing**: Clear visual indication of edit mode
- **Modified**: Visual indicator if system message has been changed from default
- **Saved**: Confirmation feedback when system message is updated
- **Loading**: Spinner/loading state while saving to database

### 3. Technical Implementation

#### Frontend Changes
```typescript
// New state for system message editing
const [systemMessageEditing, setSystemMessageEditing] = useState(false)
const [systemMessageContent, setSystemMessageContent] = useState('')
const [systemMessageSaving, setSystemMessageSaving] = useState(false)

// Update system message in events array (new conversations)
const updateSystemMessage = (newContent: string) => {
  setEvents(events => 
    events.map(event => 
      event.role === 'system' 
        ? { ...event, segments: [{ type: 'text', text: newContent }] }
        : event
    )
  )
}

// Update system message in existing conversation (using general event editing)
const updateExistingSystemMessage = async (eventId: string, newContent: string) => {
  setSystemMessageSaving(true)
  try {
    const response = await fetch(`/api/conversations/${conversationId}/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent })
    })
    
    if (!response.ok) throw new Error('Failed to update system message')
    
    // Update local state
    updateSystemMessage(newContent)
    
    // Show success feedback
    setSystemMessageSaving(false)
  } catch (error) {
    setSystemMessageSaving(false)
    // Show error feedback
  }
}
```

#### Component Structure
```
NewConversationPage / ExistingConversationPage
├── EventList (existing)
│   ├── EventItem (existing)
│   │   ├── SystemMessageDisplay (enhanced for system messages)
│   │   ├── EditButton / EditMode (existing editing functionality)
│   │   ├── SaveCancel (existing)
│   │   └── LoadingSpinner (existing)
│   └── ... (other message types)
└── MessageInput (existing)
```

**Note:** System message editing reuses existing `EventItem` editing functionality, just with enhanced styling and UX for system messages.

#### Data Flow

**New Conversations:**
1. Bud loads → System message created from `config.systemPrompt`
2. User edits → System message updated in events array
3. User sends message → All events (including modified system message) sent to API
4. API processes → System message saved to database

**Existing Conversations:**
1. Conversation loads → System message displayed from database
2. User edits → System message updated via API call
3. API updates → System message saved to database
4. Future messages → Use updated system message from database

#### Backend API Changes

**Use Existing Message Editing API: `PATCH /api/conversations/{conversationId}/events/{eventId}`**
```typescript
// Request body
{
  "content": "Updated system prompt content"
}

// Response
{
  "success": true,
  "event": {
    "id": "event-id",
    "role": "system",
    "segments": [{ "type": "text", "text": "Updated system prompt content" }],
    "ts": 1234567890
  }
}
```

**Implementation:**
- Reuse existing message editing infrastructure
- System messages are just events with `role: 'system'`
- No special handling required - unified editing experience
- Supports multiple system messages (OpenAI) naturally

**Database Changes:**
- No changes needed - use existing event editing functionality
- System messages are stored as regular events with `role: 'system'`
- Update event's `segments[0].text` using existing update mechanism

### 4. Design Decisions

#### Recommended Approach: Option C (Collapsible Section)
**Pros:**
- Doesn't overwhelm the UI for users who don't want to edit
- Provides good editing experience when expanded
- Clear visual hierarchy
- Scales well with different system prompt lengths

**UI Mockup:**
```
┌─────────────────────────────────────────────────────┐
│ 🤖 System Prompt                          [Edit] │
│ You are a helpful assistant that...         [▼]   │
│                                                     │
│ [When expanded:]                                    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ You are a helpful assistant that specializes   │ │
│ │ in answering questions about GitHub repos...    │ │
│ │                                                 │ │
│ │ [Additional instructions can be added here]     │ │
│ └─────────────────────────────────────────────────┘ │
│                                    [Save] [Cancel]   │
└─────────────────────────────────────────────────────┘
```

#### Alternative: Option A (Inline Editing)
**For simpler implementation:**
- Click anywhere on system message to edit
- Good for shorter system prompts
- More direct, less UI complexity

### 5. Implementation Plan

#### Phase 1: Basic Editing
- [ ] Create `SystemMessageEditor` component
- [ ] Add edit/save/cancel functionality for new conversations
- [ ] Update system message in events array when edited
- [ ] Test with existing API flow

#### Phase 2: Existing Conversation Editing
- [ ] Integrate with existing message editing API
- [ ] Add system message editing for existing conversations
- [ ] Implement loading states and error handling
- [ ] Add visual indicators for modified system messages

#### Phase 3: Enhanced UX
- [ ] Implement collapsible/expandable interface
- [ ] Add confirmation dialogs for unsaved changes
- [ ] Keyboard shortcuts (Ctrl+S to save, Esc to cancel)
- [ ] Show system message change history/diff

#### Phase 4: Advanced Features
- [ ] System message templates/presets
- [ ] Validation and character limits
- [ ] Markdown support in system messages
- [ ] Branch conversations when system message changes
- [ ] A/B testing different system messages

### 6. Technical Considerations

#### State Management
- System message editing state should be local to new conversation page
- Changes should update the events array immediately
- No need to persist changes until conversation is created

#### Validation
- Minimum/maximum length limits for system messages
- Prevent empty system messages
- Sanitize input to prevent malicious content

#### Performance
- Debounce updates to events array during typing
- Lazy load system message content for better performance
- Efficient re-rendering of EventList when system message changes

#### Edge Cases
- User navigates away with unsaved changes
- System message from Bud is empty/undefined
- Very long system messages (>1000 characters)
- System message contains special characters or formatting

### 7. Success Metrics
- User engagement with system message editing feature
- Improved conversation quality (subjective)
- Reduced support requests about "how to change AI behavior"
- User retention on new conversation page

### 8. Future Enhancements
- Save custom system messages as personal templates
- Share system message modifications with team/workspace
- A/B test different system message approaches
- Analytics on most common system message patterns

## Conclusion
This feature will provide users with greater control and transparency over AI behavior, leading to more tailored and effective conversations. The implementation should start simple (inline editing) and evolve based on user feedback and usage patterns.