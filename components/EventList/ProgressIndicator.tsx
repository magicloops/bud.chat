import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActivityType } from '@/lib/types/progress';

interface ProgressIndicatorProps {
  /** Current background activity type */
  currentActivity: ActivityType | null;
  /** Whether there's visible content above this indicator */
  hasContent: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Server label for MCP activities */
  serverLabel?: string;
}

const getActivityMessage = (activity: ActivityType, serverLabel?: string): string => {
  switch (activity) {
    case 'mcp_tool_discovery':
      return 'Discovering available tools...';
    case 'mcp_tool_listing':
      return serverLabel 
        ? `Loading tools from ${serverLabel}...`
        : 'Loading tools...';
    case 'reasoning':
      return 'Processing request...';
    case 'function_prep':
      return 'Preparing function call...';
    case 'response_starting':
      return 'Starting response...';
    case 'thinking':
    default:
      return 'Thinking...';
  }
};

const getActivityIcon = (activity: ActivityType) => {
  switch (activity) {
    case 'mcp_tool_discovery':
    case 'mcp_tool_listing':
      return '🔍';
    case 'reasoning':
      return '🧠';
    case 'function_prep':
      return '⚙️';
    case 'response_starting':
      return '✨';
    case 'thinking':
    default:
      return '💭';
  }
};

export function ProgressIndicator({
  currentActivity,
  hasContent,
  className,
  serverLabel
}: ProgressIndicatorProps) {
  // Don't render if no activity
  if (!currentActivity) {
    return null;
  }

  const message = getActivityMessage(currentActivity, serverLabel);
  const icon = getActivityIcon(currentActivity);

  return (
    <div 
      className={cn(
        'flex items-center gap-2 text-xs text-muted-foreground py-2 px-3',
        'border border-dashed border-muted-foreground/20 rounded-md',
        'bg-muted/10 backdrop-blur-sm',
        'animate-pulse',
        hasContent ? 'mt-2' : 'mb-2',
        className
      )}
      data-testid="progress-indicator"
      data-activity={currentActivity}
    >
      <span className="text-sm" role="img" aria-label={`${currentActivity} activity`}>
        {icon}
      </span>
      
      <Loader2 className="h-3 w-3 animate-spin" />
      
      <span className="text-xs font-medium">
        {message}
      </span>
      
      {/* Subtle dots animation */}
      <div className="flex gap-1 ml-1">
        <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
        <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
        <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce" />
      </div>
    </div>
  );
}

export default ProgressIndicator;