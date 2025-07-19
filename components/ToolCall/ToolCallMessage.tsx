'use client';

import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import MarkdownRenderer from '@/components/markdown-renderer';
import { 
  Wrench, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle, 
  XCircle, 
  Clock,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolCallMessageProps {
  toolCalls: ToolCall[]
  isExecuting?: boolean
  className?: string
}

export interface ToolResultMessageProps {
  toolCallId: string
  toolName: string
  result: string
  error?: string
  isExecuting?: boolean
  className?: string
}

const ToolCallMessage = memo(function ToolCallMessage({
  toolCalls,
  isExecuting = false,
  className
}: ToolCallMessageProps) {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());

  const toggleExpanded = (toolId: string) => {
    setExpandedCalls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(toolId)) {
        newSet.delete(toolId);
      } else {
        newSet.add(toolId);
      }
      return newSet;
    });
  };

  const formatArguments = (argumentsStr: string) => {
    try {
      const args = JSON.parse(argumentsStr);
      return JSON.stringify(args, null, 2);
    } catch {
      return argumentsStr;
    }
  };

  if (toolCalls.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {toolCalls.map((toolCall) => {
        const isExpanded = expandedCalls.has(toolCall.id);
        const [serverId, toolName] = toolCall.function.name.split('.', 2);
        
        return (
          <Card key={toolCall.id} className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <Collapsible
              open={isExpanded}
              onOpenChange={() => toggleExpanded(toolCall.id)}
            >
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-colors py-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="flex-1">{toolName || toolCall.function.name}</span>
                    {serverId && (
                      <Badge variant="secondary" className="text-xs">
                        {serverId}
                      </Badge>
                    )}
                    {isExecuting && (
                      <Clock className="h-4 w-4 text-orange-500 animate-spin" />
                    )}
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </CardTitle>
                </CardHeader>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <CardContent className="pt-0 pb-3">
                  <div className="text-sm">
                    <div className="text-muted-foreground mb-2">Parameters:</div>
                    <pre className="bg-muted rounded p-2 text-xs overflow-x-auto font-mono">
                      {formatArguments(toolCall.function.arguments)}
                    </pre>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
});

const ToolResultMessage = memo(function ToolResultMessage({
  toolCallId,
  toolName,
  result,
  error,
  isExecuting = false,
  className
}: ToolResultMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasError = !!error;
  const [serverId, cleanToolName] = toolName.split('.', 2);

  return (
    <Card className={cn(
      'transition-colors',
      hasError 
        ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
        : 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800',
      className
    )}>
      <Collapsible
        open={isExpanded}
        onOpenChange={setIsExpanded}
      >
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:opacity-80 transition-opacity py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              {hasError ? (
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              ) : isExecuting ? (
                <Clock className="h-4 w-4 text-orange-500 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              )}
              <span className="flex-1">
                {hasError ? 'Failed' : isExecuting ? 'Executing' : 'Completed'}: {cleanToolName || toolName}
              </span>
              {serverId && (
                <Badge variant="secondary" className="text-xs">
                  {serverId}
                </Badge>
              )}
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            <div className="text-sm">
              <div className="text-muted-foreground mb-2">
                {hasError ? 'Error:' : 'Result:'}
              </div>
              <div className="bg-muted rounded p-2 text-xs overflow-x-auto">
                {hasError ? (
                  <div className="text-red-600 dark:text-red-400 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : (
                  <MarkdownRenderer content={result} />
                )}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
});

export { ToolCallMessage, ToolResultMessage };