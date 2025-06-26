# Settings Panel Behavior Specification

## Overview
The settings panel behavior should change based on whether the user is in a pre-conversation state (on `/new` page) or in an active conversation (on `/chat/[id]` page).

## States

### 1. Pre-Conversation State (`/new` page)
**Context**: User is on `/new?bud={budId}` or `/new` (no bud selected)

#### Panel Title: "Bud Settings"

#### Behavior:
- **Direct Bud Editing**: All changes directly modify the source bud configuration
- **Real-time Updates**: Changes apply immediately to the bud and are visible in the UI
- **Theme Application**: Bud themes apply immediately when changed
- **No Save Button**: Changes are saved instantly to the bud configuration
- **No Conversation Overrides**: Since no conversation exists yet, everything is bud-level

#### Fields Shown:
- **Icon**: Bud's avatar/emoji
- **Name**: Bud's display name
- **AI Model**: Bud's default model
- **AI Goals/Instructions**: Bud's system prompt
- **Advanced Settings**:
  - Temperature: Bud's default temperature
  - Max Tokens: Bud's default max tokens
- **Theme Generator**: Generates and applies themes directly to the bud

#### Special Cases:
- **No Bud Selected** (`/new` without bud parameter):
  - Panel shows "No Bud Selected"
  - Prompts user to select a bud or start a general conversation
  - No settings available to edit

---

### 2. Active Conversation State (`/chat/[conversationId]`)
**Context**: User is in an existing conversation

#### Panel Title: "Chat Settings"

#### Behavior:
- **Conversation Overrides**: Changes create conversation-specific overrides
- **Bud Integration**: Shows bud defaults as fallback values
- **Save Confirmation**: Requires explicit save with options
- **Theme Inheritance**: Conversation inherits bud theme by default

#### Fields Shown:
- **Icon**: Shows conversation override OR bud default
- **Name**: Shows conversation title OR derived from bud name
- **AI Model**: Shows conversation override OR bud default
- **AI Goals/Instructions**: Shows conversation override OR bud default
- **Advanced Settings**:
  - Temperature: Shows conversation override OR bud default
  - Max Tokens: Shows conversation override OR bud default
- **Theme Generator**: Generates themes for preview, saved with confirmation

#### Save Options:
When user clicks "Save Changes", show dialog with two options:

1. **"Save to Chat Only"**
   - Creates/updates conversation-specific overrides
   - Does not modify the source bud
   - Future conversations from this bud remain unchanged

2. **"Save to Chat + Update Bud"** (only available if conversation has a source bud)
   - Updates the source bud configuration
   - Clears conversation overrides (since bud now matches desired settings)
   - Future conversations from this bud will use the updated settings

---

## State Transitions

### From Pre-Conversation to Active Conversation
**Trigger**: User sends first message on `/new` page

**Process**:
1. Backend creates conversation with current bud settings
2. User navigates to `/chat/[conversationId]`
3. Settings panel switches from "Bud Settings" to "Chat Settings"
4. All current bud settings become the conversation's inherited defaults
5. No conversation overrides exist initially

### Theme Handling During Transition
1. **Pre-conversation**: Bud theme applied directly from bud config
2. **Transition**: Theme persists during navigation (no clearing)
3. **Active conversation**: Theme continues from bud, or from conversation overrides if any exist

---

## Implementation Notes

### Settings Panel Component Logic
```typescript
// Determine panel mode based on route and conversation state
const isPreConversation = pathname.includes('/new')
const panelMode = isPreConversation ? 'bud' : 'chat'

// Different behavior for each mode
if (panelMode === 'bud') {
  // Direct bud editing mode
  // No save button, immediate updates
  // No conversation overrides
} else {
  // Conversation override mode  
  // Save button with confirmation
  // Bud defaults + conversation overrides
}
```

### Theme Application Strategy
```typescript
// Pre-conversation: Apply bud theme immediately
if (isPreConversation && budConfig?.customTheme) {
  applyTheme(budConfig.customTheme)
}

// Active conversation: Apply conversation override OR bud theme
if (!isPreConversation) {
  const themeToApply = conversationOverrides?.customTheme || budConfig?.customTheme
  if (themeToApply) {
    applyTheme(themeToApply)
  }
}
```

---

## User Experience Benefits

1. **Intuitive Workflow**: Settings clearly indicate what's being modified
2. **Bud Refinement**: Users can perfect bud settings before starting conversations
3. **Flexible Iteration**: Once in conversation, users can experiment with settings
4. **Clear Intent**: Save dialog makes the scope of changes explicit
5. **Theme Consistency**: Themes apply smoothly throughout the workflow

---

## Edge Cases

### Conversation Without Source Bud
- Panel shows "Chat Settings" 
- No "Save to Chat + Update Bud" option (only "Save to Chat Only")
- All settings are conversation-specific

### Bud Gets Deleted While in Conversation
- Conversation continues to work with cached/override settings
- Panel shows "Chat Settings" with no bud fallbacks
- Only "Save to Chat Only" option available

### User Edits Bud While Others Have Active Conversations
- Existing conversations continue with their current settings
- New conversations from that bud use updated settings
- Conversation overrides take precedence over updated bud settings