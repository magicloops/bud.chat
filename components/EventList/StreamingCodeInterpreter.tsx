'use client';

import React, { useEffect, useRef, useState } from 'react';
import { streamingBus } from '@/lib/streaming/streamingBus';
import MarkdownRenderer from '@/components/markdown-renderer';

interface StreamingCodeInterpreterProps {
  itemId: string;
  language?: string; // optional, defaults to python
}

export function StreamingCodeInterpreter({ itemId, language = 'python' }: StreamingCodeInterpreterProps) {
  const [code, setCode] = useState<string>(streamingBus.getCode(itemId));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const update = () => {
      const next = streamingBus.getCode(itemId);
      setCode(prev => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent('streaming-content-updated'));
        return next;
      });
    };
    const unsub = streamingBus.subscribeCode(itemId, update);
    // Throttle to ~30fps
    intervalRef.current = setInterval(update, 33);
    // Initial sync
    update();
    return () => {
      unsub();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [itemId]);

  if (!code) return null;

  // Render as fenced code for consistency with MarkdownRenderer
  const content = `\`\`\`${language}\n${code}\n\`\`\``;
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-medium">Generated Code (streaming):</div>
        <div className="bg-muted/50 rounded-lg p-3 overflow-x-auto">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  );
}

export default StreamingCodeInterpreter;
