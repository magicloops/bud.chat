/**
 * Types for ephemeral progress indicator functionality
 */

export type ActivityType = 
  | 'mcp_tool_discovery'
  | 'mcp_tool_listing'
  | 'reasoning'
  | 'function_prep'
  | 'thinking'
  | 'response_starting';

export interface ProgressState {
  /** Current activity being performed */
  currentActivity: ActivityType | null;
  /** Server label for MCP activities */
  serverLabel?: string;
  /** Timestamp when activity started */
  startTime?: number;
  /** Whether the progress indicator should be visible */
  isVisible: boolean;
}

export interface ProgressUpdate {
  activity: ActivityType | null;
  serverLabel?: string;
  isVisible?: boolean;
}

/**
 * Events that trigger progress indicator updates
 */
export const PROGRESS_TRIGGER_EVENTS = [
  // Lifecycle events
  'response.created',
  'response.in_progress',
  
  // MCP events
  'response.mcp_list_tools.in_progress',
  'mcp_list_tools',
  'mcp_tool_start',
  
  // Reasoning events (when empty/starting)
  'reasoning_start',
  'response.reasoning_summary_part.added',
  
  // Function call events
  'response.function_call_arguments.delta',
  
  // Output item events (for detection)
  'response.output_item.added',
] as const;

/**
 * Events that should hide the progress indicator (content is appearing)
 */
export const PROGRESS_HIDE_EVENTS = [
  // Text content
  'response.output_text.delta',
  'text_delta',
  
  // Tool calls with results
  'tool_complete',
  'mcp_tool_complete',
  
  // Reasoning with actual content
  'reasoning_complete',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary.done',
  
  // Message completion
  'response.output_item.done',
] as const;

/**
 * Determine activity type from event type and data
 */
export function getActivityFromEvent(eventType: string, eventData: Record<string, unknown>): ActivityType | null {
  // MCP tool activities
  if (eventType.includes('mcp_list_tools') || eventType === 'mcp_list_tools') {
    return 'mcp_tool_listing';
  }
  
  if (eventType === 'mcp_tool_start') {
    return 'mcp_tool_discovery';
  }
  
  // Reasoning activities
  if (eventType.includes('reasoning') && !eventData?.text && !eventData?.combined_text) {
    return 'reasoning';
  }
  
  // Function call preparation
  if (eventType.includes('function_call') && eventType.includes('delta')) {
    return 'function_prep';
  }
  
  // Response lifecycle
  if (eventType === 'response.created' || eventType === 'response.in_progress') {
    return 'response_starting';
  }
  
  // Unknown background activity
  if ((PROGRESS_TRIGGER_EVENTS as readonly string[]).includes(eventType)) {
    return 'thinking';
  }
  
  return null;
}

/**
 * Check if event should hide progress indicator
 */
export function shouldHideProgress(eventType: string, eventData: Record<string, unknown>): boolean {
  // Hide when actual content appears
  if ((PROGRESS_HIDE_EVENTS as readonly string[]).includes(eventType)) {
    return true;
  }
  
  // Hide when reasoning has actual content
  if (eventType.includes('reasoning') && (eventData?.text || eventData?.combined_text)) {
    return true;
  }
  
  // Hide when tool calls have results
  if (eventType.includes('tool') && eventData?.result) {
    return true;
  }
  
  return false;
}

/**
 * Extract server label from event data
 */
export function getServerLabelFromEvent(eventData: Record<string, unknown>): string | undefined {
  return (eventData?.server_label as string) || (eventData?.serverLabel as string);
}