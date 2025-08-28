'use client';

import React, { useEffect, useState } from 'react';
import { streamingBus } from '@/lib/streaming/streamingBus';
import { Badge } from '@/components/ui/badge';
import { Wrench, Loader2, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreamingToolsOverlayProps {
  eventId: string;
}

export default function StreamingToolsOverlay({ eventId }: StreamingToolsOverlayProps) {
  const [tools, setTools] = useState(streamingBus.getTools(eventId));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const update = () => {
      const next = streamingBus.getTools(eventId);
      // Debug: log tool overlay updates
      try {
        console.log('[UI][ToolsOverlay] update', { eventId, tools: next.map(t => ({ id: t.id, name: t.name, status: t.status })) });
      } catch {}
      setTools(next);
    };
    const unsub = streamingBus.subscribeTools(eventId, update);
    update();
    return () => unsub();
  }, [eventId]);

  if (tools.length === 0) return null;

  const statusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
      case 'finalized':
        return (
          <Badge variant="outline" className="text-xs flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            {status === 'in_progress' ? 'Starting…' : 'Running…'}
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="text-xs flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-green-600" /> Done
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="outline" className="text-xs flex items-center gap-1">
            <XCircle className="w-3 h-3 text-red-600" /> Failed
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-2">
      {tools.map(tool => (
        <div key={tool.id} className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/60 dark:bg-blue-950/20">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium">
              {tool.display_name || tool.name}
            </span>
            {tool.server_label && (
              <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded">{tool.server_label}</span>
            )}
            <div className="ml-auto">{statusBadge(tool.status)}</div>
          </div>
          {tool.args && (
            <button
              className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setExpanded(prev => ({ ...prev, [tool.id]: !prev[tool.id] }))}
            >
              {expanded[tool.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Arguments
            </button>
          )}
          {tool.args && expanded[tool.id] && (
            <pre className={cn('mt-2 text-xs bg-background/50 p-2 rounded overflow-x-auto')}>{tool.args}</pre>
          )}
          {tool.error && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400">{tool.error}</div>
          )}
        </div>
      ))}
    </div>
  );
}
