'use client';

import { memo, useState } from 'react';
import { Event, Segment } from '@/lib/types/events';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  User, 
  Bot, 
  Settings, 
  Wrench, 
  CheckCircle, 
  XCircle, 
  Clock,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MarkdownRenderer from '@/components/markdown-renderer';

interface EventMessageProps {
  event: Event
  isStreaming?: boolean
  className?: string
  allEvents?: Event[]
}

interface SegmentRendererProps {
  segment: Segment
  isStreaming?: boolean
  allEvents?: Event[]
}

const RoleIcon = ({ role }: { role: Event['role'] }) => {
  switch (role) {
    case 'system':
      return <Settings className="h-4 w-4 text-muted-foreground" />;
    case 'user':
      return <User className="h-4 w-4 text-blue-600" />;
    case 'assistant':
      return <Bot className="h-4 w-4 text-green-600" />;
    case 'tool':
      return <Wrench className="h-4 w-4 text-orange-600" />;
    default:
      return <div className="h-4 w-4" />;
  }
};

const TextSegment = memo(function TextSegment({ 
  segment, 
  isStreaming 
}: { 
  segment: { type: 'text'; text: string }
  isStreaming?: boolean 
}) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <MarkdownRenderer content={segment.text} />
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
      )}
    </div>
  );
});

const ToolCallSegment = memo(function ToolCallSegment({ 
  segment,
  allEvents,
  isStreaming
}: { 
  segment: { type: 'tool_call'; id: string; name: string; args: object }
  allEvents?: Event[]
  isStreaming?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Find the corresponding tool result from all events
  const toolResult = allEvents ? findToolResult(allEvents, segment.id) : null;
  const hasResult = toolResult !== null;
  const resultSegment = toolResult?.segments.find(s => s.type === 'tool_result' && s.id === segment.id) as 
    { type: 'tool_result'; id: string; output: object } | undefined;
  
  const hasError = resultSegment && resultSegment.output && typeof resultSegment.output === 'object' && 'error' in resultSegment.output;
  const resultContent = hasError 
    ? (resultSegment.output as any).error 
    : resultSegment ? ((resultSegment.output as any).content || JSON.stringify(resultSegment.output)) : null;

  return (
    <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 my-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span>Tool Call: {segment.name}</span>
          <Badge variant="secondary" className="text-xs">
            {segment.id.substring(0, 8)}
          </Badge>
          {hasResult && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {hasError ? 'Error' : 'Result'}
            </button>
          )}
          {!hasResult && !isStreaming && (
            <Clock className="h-3 w-3 text-muted-foreground animate-pulse ml-auto" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-sm">
          <div className="text-muted-foreground mb-1">Arguments:</div>
          <pre className="bg-muted rounded p-2 text-xs overflow-x-auto font-mono">
            {JSON.stringify(segment.args, null, 2)}
          </pre>
        </div>
        
        {/* Collapsible tool result */}
        {hasResult && isExpanded && (
          <div className="mt-3 border-t pt-3">
            <div className="flex items-center gap-2 mb-2">
              {hasError ? (
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              )}
              <span className="text-sm font-medium">
                {hasError ? 'Tool Error' : 'Tool Result'}
              </span>
            </div>
            <div className="text-sm">
              <div className="text-muted-foreground mb-1">
                {hasError ? 'Error:' : 'Output:'}
              </div>
              <div className={cn(
                'rounded p-2 text-xs overflow-x-auto',
                hasError 
                  ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800'
                  : 'bg-muted'
              )}>
                {hasError ? (
                  <div className="text-red-600 dark:text-red-400">
                    {resultContent}
                  </div>
                ) : (
                  <MarkdownRenderer content={resultContent || ''} />
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const ToolResultSegment = memo(function ToolResultSegment({ 
  segment 
}: { 
  segment: { type: 'tool_result'; id: string; output: object }
}) {
  const hasError = segment.output && typeof segment.output === 'object' && 'error' in segment.output;
  const content = hasError 
    ? (segment.output as any).error 
    : (segment.output as any).content || JSON.stringify(segment.output);

  return (
    <Card className={cn(
      'my-2 transition-colors',
      hasError 
        ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
        : 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {hasError ? (
            <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          ) : (
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          )}
          <span>{hasError ? 'Tool Error' : 'Tool Result'}</span>
          <Badge variant="secondary" className="text-xs">
            {segment.id.substring(0, 8)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-sm">
          <div className="text-muted-foreground mb-1">
            {hasError ? 'Error:' : 'Output:'}
          </div>
          <div className="bg-muted rounded p-2 text-xs overflow-x-auto">
            {hasError ? (
              <div className="text-red-600 dark:text-red-400">
                {content}
              </div>
            ) : (
              <MarkdownRenderer content={content} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

const SegmentRenderer = memo(function SegmentRenderer({ 
  segment, 
  isStreaming,
  allEvents
}: SegmentRendererProps & { allEvents?: Event[] }) {
  switch (segment.type) {
    case 'text':
      return <TextSegment segment={segment} isStreaming={isStreaming} />;
    case 'tool_call':
      return <ToolCallSegment segment={segment} allEvents={allEvents} isStreaming={isStreaming} />;
    case 'tool_result':
      // Tool results are now rendered within tool calls, so we hide standalone results
      return null;
    default:
      return null;
  }
});

const EventMessage = memo(function EventMessage({ 
  event, 
  isStreaming = false,
  className,
  allEvents
}: EventMessageProps & { allEvents?: Event[] }) {
  const getRoleLabel = (role: Event['role']) => {
    switch (role) {
      case 'system': return 'System';
      case 'user': return 'You';
      case 'assistant': return 'Assistant';
      case 'tool': return 'Tool';
      default: return role;
    }
  };

  const getRoleStyles = (role: Event['role']) => {
    switch (role) {
      case 'system':
        return 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800';
      case 'user':
        return 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800';
      case 'assistant':
        return 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800';
      case 'tool':
        return 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800';
      default:
        return 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800';
    }
  };

  // Don't render empty events
  if (event.segments.length === 0) {
    return null;
  }
  
  // Hide standalone tool result events (they're now shown within tool calls)
  if (event.role === 'tool') {
    return null;
  }

  // For system messages, render more compactly
  if (event.role === 'system') {
    return (
      <div className={cn('mb-4 p-3 rounded-lg border', getRoleStyles(event.role), className)}>
        <div className="flex items-center gap-2 mb-2">
          <RoleIcon role={event.role} />
          <span className="text-sm font-medium text-muted-foreground">
            {getRoleLabel(event.role)}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          {event.segments.map((segment, i) => (
            <SegmentRenderer key={i} segment={segment} isStreaming={false} allEvents={allEvents} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('mb-6', className)}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          <div className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center',
            getRoleStyles(event.role)
          )}>
            <RoleIcon role={event.role} />
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">
              {getRoleLabel(event.role)}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(event.ts).toLocaleTimeString()}
            </span>
            {isStreaming && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 animate-pulse" />
                <span>Streaming...</span>
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            {/* Render segments in order: text first, then tool calls */}
            {event.segments
              .filter(s => s.type === 'text')
              .map((segment, i) => (
                <SegmentRenderer 
                  key={`text-${i}`} 
                  segment={segment} 
                  isStreaming={isStreaming && event.segments.filter(s => s.type === 'tool_call').length === 0} 
                  allEvents={allEvents}
                />
              ))}
            {event.segments
              .filter(s => s.type === 'tool_call')
              .map((segment, i) => (
                <SegmentRenderer 
                  key={`tool-${i}`} 
                  segment={segment} 
                  isStreaming={isStreaming} 
                  allEvents={allEvents}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
});

// Helper function to group events by conversation turns
export function groupEventsByTurn(events: Event[]): Event[][] {
  const turns: Event[][] = [];
  let currentTurn: Event[] = [];
  
  for (const event of events) {
    if (event.role === 'user' && currentTurn.length > 0) {
      // Start new turn
      turns.push(currentTurn);
      currentTurn = [event];
    } else {
      currentTurn.push(event);
    }
  }
  
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  
  return turns;
}

// Helper function to find tool results for a tool call
export function findToolResult(events: Event[], toolCallId: string): Event | null {
  return events.find(event => 
    event.segments.some(segment => 
      segment.type === 'tool_result' && segment.id === toolCallId
    )
  ) || null;
}

// Helper function to check if an event has pending tool calls
export function hasUnresolvedToolCalls(events: Event[], event: Event): boolean {
  const toolCalls = event.segments.filter(s => s.type === 'tool_call');
  
  return toolCalls.some(toolCall => {
    const toolCallSegment = toolCall as { type: 'tool_call'; id: string; name: string; args: object };
    return !findToolResult(events, toolCallSegment.id);
  });
}

export default EventMessage;