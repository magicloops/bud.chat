'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Send, 
  Square, 
  RotateCcw, 
  Trash2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEventChat } from '@/hooks/useEventChat';
import EventStream from './EventStream';
import { Event } from '@/lib/types/events';

interface EventChatInterfaceProps {
  workspaceId: string
  budId?: string
  model?: string
  initialEvents?: Event[]
  placeholder?: string
  onConversationCreated?: (conversationId: string) => void
  className?: string
}

export default function EventChatInterface({
  workspaceId,
  budId,
  model = 'gpt-4o',
  initialEvents = [],
  placeholder = 'Type your message...',
  onConversationCreated,
  className
}: EventChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);

  const {
    events,
    isStreaming,
    streamingEventId,
    error,
    sendMessage,
    stopStreaming,
    clearEvents,
    addSystemMessage,
    retry
  } = useEventChat({
    workspaceId,
    budId,
    model,
    onConversationCreated,
    onError: (error) => console.error('Chat error:', error)
  });

  // Add initial events on mount
  useEffect(() => {
    if (initialEvents.length > 0) {
      for (const event of initialEvents) {
        if (event.role === 'system') {
          const systemContent = event.segments.find(s => s.type === 'text')?.text;
          if (systemContent) {
            addSystemMessage(systemContent);
          }
        }
      }
    }
  }, [initialEvents, addSystemMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleStop = () => {
    stopStreaming();
  };

  const handleClear = () => {
    clearEvents();
    setInput('');
  };

  const handleRetry = () => {
    retry();
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Event-Based Chat</h2>
          <Badge variant="secondary" className="text-xs">
            {model}
          </Badge>
          {budId && (
            <Badge variant="outline" className="text-xs">
              Bud: {budId.substring(0, 8)}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={isStreaming}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
          
          {error && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={isStreaming}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert className="m-4 border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}
          </AlertDescription>
        </Alert>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-hidden">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-lg mb-2">Start a conversation</p>
              <p className="text-sm">Type a message below to begin</p>
            </div>
          </div>
        ) : (
          <EventStream
            events={events}
            isStreaming={isStreaming}
            streamingEventId={streamingEventId}
            className="h-full"
          />
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder={placeholder}
              className={cn(
                'min-h-[60px] pr-12 resize-none',
                isInputFocused && 'ring-2 ring-blue-500'
              )}
              disabled={isStreaming}
            />
            
            {/* Send/Stop Button */}
            <div className="absolute bottom-2 right-2">
              {isStreaming ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleStop}
                  className="h-8 w-8 p-0"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || isStreaming}
                  className="h-8 w-8 p-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          
          {/* Status and Event Count */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {isStreaming && (
                <div className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Streaming response...</span>
                </div>
              )}
              
              {events.length > 0 && (
                <span>
                  {events.length} event{events.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <span>Press Enter to send, Shift+Enter for new line</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Wrapper component for easier integration
export function EventChatPage({
  workspaceId,
  budId,
  model,
  onConversationCreated,
  className
}: Omit<EventChatInterfaceProps, 'initialEvents'>) {
  return (
    <Card className={cn('h-full', className)}>
      <EventChatInterface
        workspaceId={workspaceId}
        budId={budId}
        model={model}
        onConversationCreated={onConversationCreated}
        className="h-full"
      />
    </Card>
  );
}