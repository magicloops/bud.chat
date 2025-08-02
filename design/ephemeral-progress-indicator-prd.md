# Ephemeral Progress Indicator PRD

## Overview

Create an ephemeral progress indicator that provides real-time feedback to users about background activities happening during AI model responses, particularly for events that don't immediately produce visible content.

## Problem Statement

Currently, when users send a message, there can be significant delays before visible content appears due to:
- MCP tool discovery and listing
- Reasoning processes (o3 models)
- Function call preparation
- Other background API operations

During these periods, users see a blank assistant message with no indication that the model is actively working, leading to a perception that the system is stalled or unresponsive.

## Solution

Implement a dynamic, ephemeral progress indicator that:
1. **Appears automatically** when background events are detected
2. **Shows contextual messages** based on the type of activity
3. **Positions intelligently** at the bottom of existing content (or top if no content exists)
4. **Disappears gracefully** when actual content begins streaming
5. **Never blocks or interferes** with real content

## User Experience

### Visual Behavior
- **Positioning**: Always at the bottom of existing content, ensuring users see progress without feeling stalled
- **Animation**: Subtle pulsing or typing indicator to show active processing
- **Transition**: Smooth fade-out when real content appears
- **Non-intrusive**: Minimal visual footprint, clearly differentiated from actual response content

### Contextual Messages
- **MCP Tool Discovery**: "Discovering available tools..."
- **MCP Tool Listing**: "Loading tools from [server_name]..."
- **Reasoning**: "Thinking..." or "Processing request..."
- **Function Calls**: "Preparing function call..."
- **Unknown Events**: "Thinking..." (fallback)

## Technical Implementation

### Event Detection
Monitor OpenAI Responses API events that don't produce immediate visible content:
- `response.created` / `response.in_progress`
- `response.mcp_list_tools.*` events
- `response.reasoning_summary.*` events (when empty)
- Any unhandled event types

### Component Architecture
```typescript
interface EphemeralProgressProps {
  currentActivity: ActivityType | null;
  hasContent: boolean;
  isVisible: boolean;
}

type ActivityType = 
  | 'mcp_tool_discovery'
  | 'mcp_tool_listing'
  | 'reasoning'
  | 'function_prep'
  | 'thinking';
```

### State Management
- Track current background activity state
- Detect when actual content begins (text, tool calls, reasoning with content)
- Manage smooth transitions between states

### Integration Points
1. **OpenAI Responses Transformer**: Detect and classify background events
2. **Frontend Event Handler**: Update progress state based on events
3. **EventItem Component**: Render progress indicator in appropriate position
4. **Sequential Segment Renderer**: Ensure proper positioning logic

## Success Metrics

### User Experience
- **Reduced perceived wait time** during background operations
- **Improved user confidence** that the system is working
- **Clear feedback** about what's happening behind the scenes

### Technical
- **Zero impact** on actual content rendering performance
- **Accurate event detection** with minimal false positives/negatives
- **Smooth transitions** without UI flicker or jumps

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create ephemeral progress component
- [ ] Implement event detection logic
- [ ] Add state management for progress tracking

### Phase 2: Event Integration
- [ ] Handle MCP tool discovery events
- [ ] Handle reasoning events
- [ ] Handle unknown/unprocessed events

### Phase 3: UX Polish
- [ ] Implement smooth animations and transitions
- [ ] Add contextual messaging
- [ ] Optimize positioning logic

### Phase 4: Testing & Refinement
- [ ] Test with various model types (o1, o3, GPT-4, etc.)
- [ ] Validate behavior with different content types
- [ ] Performance testing and optimization

## Technical Considerations

### Performance
- Minimal re-renders when progress state changes
- Efficient event filtering to avoid unnecessary updates
- Lightweight animations that don't impact performance

### Accessibility
- Screen reader compatible progress announcements
- Appropriate ARIA labels and roles
- Keyboard navigation considerations

### Edge Cases
- Multiple concurrent background activities
- Rapid event sequences
- Network interruptions during background processing
- Very short-duration activities that complete before indicator can appear

## Future Enhancements

### Advanced Features
- **Progress estimation** for known duration activities
- **Detailed breakdowns** for complex multi-step processes
- **User preferences** for progress indicator verbosity

### Integration Opportunities
- **Analytics tracking** of user wait times and activity types
- **Performance monitoring** of background operation durations
- **A/B testing** of different indicator styles and messaging

## Definition of Done

- [ ] Progress indicator appears for all relevant background events
- [ ] Contextual messages accurately reflect current activity
- [ ] Smooth transitions without UI disruption
- [ ] No impact on existing content rendering
- [ ] Comprehensive test coverage
- [ ] Performance validation across different scenarios
- [ ] Accessibility compliance
- [ ] Documentation for future maintenance

---

*This PRD defines a user-focused enhancement that transforms potentially frustrating wait times into informative, confidence-building progress updates.*