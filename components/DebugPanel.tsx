'use client';

import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { X, Bug } from 'lucide-react';

interface DebugEvent {
  id: string
  timestamp: string
  type: 'mcp_tool_use' | 'mcp_tool_result' | 'stream_event' | 'api_call' | 'system' | 'error'
  data: any
  conversationId?: string
}

interface DebugPanelProps {
  conversationId?: string
  className?: string
}

export function DebugPanel({ conversationId, className }: DebugPanelProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [debugMode, setDebugMode] = useState(false);

  // Check debug mode on mount and listen for changes
  useEffect(() => {
    const checkDebugMode = () => {
      if (typeof window !== 'undefined') {
        const enabled = localStorage.getItem('debug-mode') === 'true';
        setDebugMode(enabled);
        setIsVisible(enabled);
      }
    };
    
    checkDebugMode();
    
    const handleDebugModeChange = (event: CustomEvent) => {
      setDebugMode(event.detail);
      setIsVisible(event.detail);
    };
    
    window.addEventListener('debug-mode-changed', handleDebugModeChange as EventListener);
    return () => window.removeEventListener('debug-mode-changed', handleDebugModeChange as EventListener);
  }, []);

  // Listen for debug events
  useEffect(() => {
    if (!debugMode) return;
    
    const handleDebugEvent = (event: CustomEvent<DebugEvent>) => {
      const debugEvent = event.detail;
      
      // Filter events by conversation ID if provided
      if (conversationId && debugEvent.conversationId && debugEvent.conversationId !== conversationId) {
        return;
      }
      
      setEvents(prev => [...prev, debugEvent].slice(-100)); // Keep last 100 events
    };
    
    window.addEventListener('debug-event', handleDebugEvent as EventListener);
    return () => window.removeEventListener('debug-event', handleDebugEvent as EventListener);
  }, [debugMode, conversationId]);

  const clearEvents = () => {
    setEvents([]);
  };

  const getEventColor = (type: DebugEvent['type']) => {
    switch (type) {
      case 'mcp_tool_use': return 'text-blue-600';
      case 'mcp_tool_result': return 'text-green-600';
      case 'stream_event': return 'text-purple-600';
      case 'api_call': return 'text-orange-600';
      case 'system': return 'text-gray-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getEventIcon = (type: DebugEvent['type']) => {
    switch (type) {
      case 'mcp_tool_use': return '🔧';
      case 'mcp_tool_result': return '✅';
      case 'stream_event': return '📨';
      case 'api_call': return '🌐';
      case 'system': return '⚙️';
      case 'error': return '❌';
      default: return '•';
    }
  };

  if (!debugMode) return null;

  return (
    <div className={`fixed bottom-4 right-4 w-96 max-w-[90vw] bg-background border rounded-lg shadow-lg z-50 ${className}`}>
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4" />
          <h3 className="font-semibold text-sm">Debug Panel</h3>
          <span className="text-xs text-muted-foreground">({events.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearEvents}
            className="h-6 px-2 text-xs"
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsVisible(false)}
            className="h-6 w-6 p-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="h-64">
        <div className="p-2 space-y-1">
          {events.length === 0 ? (
            <div className="text-center text-muted-foreground text-xs py-8">
              No debug events yet. Debug events will appear here when MCP tools are used.
            </div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="text-xs border-b border-gray-100 pb-1 mb-1">
                <div className="flex items-center gap-2 mb-1">
                  <span>{getEventIcon(event.type)}</span>
                  <span className={`font-medium ${getEventColor(event.type)}`}>
                    {event.type.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="pl-6 text-muted-foreground">
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      
      {!isVisible && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsVisible(true)}
          className="fixed bottom-4 right-4 h-8 w-8 p-0 bg-background border shadow-lg"
        >
          <Bug className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// Utility function for components to emit debug events
export const emitDebugEvent = (
  type: DebugEvent['type'],
  data: any,
  conversationId?: string
) => {
  if (typeof window !== 'undefined' && localStorage.getItem('debug-mode') === 'true') {
    const event: DebugEvent = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type,
      data,
      conversationId
    };
    
    window.dispatchEvent(new CustomEvent('debug-event', { detail: event }));
  }
};