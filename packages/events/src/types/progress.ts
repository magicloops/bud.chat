export type ActivityType = 'mcp_tool_discovery' | 'mcp_tool_listing' | 'reasoning' | 'function_prep' | 'thinking' | 'response_starting' | 'web_search' | 'code_interpreter';
export interface ProgressState { currentActivity: ActivityType | null; serverLabel?: string; startTime?: number; isVisible: boolean; }
export interface ProgressUpdate { activity: ActivityType | null; serverLabel?: string; isVisible?: boolean; }
export const PROGRESS_TRIGGER_EVENTS = ['response.created','response.in_progress','response.mcp_list_tools.in_progress','mcp_list_tools','mcp_tool_start','reasoning_start','response.reasoning_summary_part.added','response.function_call_arguments.delta','response.output_item.added'] as const;
export const PROGRESS_HIDE_EVENTS = ['response.output_text.delta','text_delta','tool_complete','mcp_tool_complete','reasoning_complete','response.reasoning_summary_text.delta','response.reasoning_summary.done','response.output_item.done'] as const;
export function getActivityFromEvent(eventType: string, eventData: Record<string, unknown>): ActivityType | null {
  if (eventType.includes('mcp_list_tools') || eventType === 'mcp_list_tools') return 'mcp_tool_listing';
  if (eventType === 'mcp_tool_start') return 'mcp_tool_discovery';
  if (eventType.includes('reasoning') && !eventData?.text && !eventData?.combined_text) return 'reasoning';
  if (eventType.includes('function_call') && eventType.includes('delta')) return 'function_prep';
  if (eventType === 'response.created' || eventType === 'response.in_progress') return 'response_starting';
  if ((PROGRESS_TRIGGER_EVENTS as readonly string[]).includes(eventType)) return 'thinking';
  return null;
}
export function shouldHideProgress(eventType: string, eventData: Record<string, unknown>): boolean {
  if ((PROGRESS_HIDE_EVENTS as readonly string[]).includes(eventType)) return true;
  if (eventType.includes('reasoning') && (eventData?.text || eventData?.combined_text)) return true;
  if (eventType.includes('tool') && eventData?.result) return true;
  return false;
}
export function getServerLabelFromEvent(eventData: Record<string, unknown>): string | undefined { return (eventData?.server_label as string) || (eventData?.serverLabel as string); }
