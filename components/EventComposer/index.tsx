'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Conversation } from '@/state/eventChatStore';

interface EventComposerProps {
  conversation: Conversation
  onSendMessage?: (content: string) => void | Promise<void>
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function EventComposer({ 
  conversation: _conversation,
  onSendMessage,
  placeholder = 'Type your message...',
  disabled = false,
  className 
}: EventComposerProps) {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (!message.trim() || disabled || isLoading) return;

    const messageToSend = message.trim();
    setMessage('');
    setIsLoading(true);

    try {
      await onSendMessage?.(messageToSend);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore message on error
      setMessage(messageToSend);
    } finally {
      setIsLoading(false);
    }

    // Focus back to textarea
    textareaRef.current?.focus();
  }, [message, onSendMessage, disabled, isLoading]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  return (
    <Card className={cn('border-0 border-t rounded-none shadow-none', className)}>
      <div className="p-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled || isLoading}
              className="resize-none border-0 shadow-none focus-visible:ring-0 bg-muted/50"
              rows={1}
              style={{
                minHeight: '40px',
                maxHeight: '120px',
              }}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!message.trim() || disabled || isLoading}
            size="icon"
            className="h-10 w-10"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default EventComposer;