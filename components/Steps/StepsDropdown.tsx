'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Event } from '@/state/eventChatStore';
import { computeStepsForEvent } from '@/lib/steps/computeSteps';
import { Step } from '@/lib/steps/types';
import MarkdownRenderer from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';

interface StepsDropdownProps {
  event: Event;
  className?: string;
  forceVisible?: boolean; // show CTA even if segments don't yet include steps
}

export default function StepsDropdown({ event, className, forceVisible = false }: StepsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [cachedSteps, setCachedSteps] = useState<Step[] | null>(null);

  const hasPotentialSteps = useMemo(() => {
    return event.segments.some(s =>
      s.type === 'reasoning' || s.type === 'web_search_call' || s.type === 'code_interpreter_call' || s.type === 'tool_call'
    );
  }, [event.segments]);

  if (!hasPotentialSteps && !forceVisible) return null;

  const handleToggle = () => {
    if (!open && !cachedSteps) {
      setCachedSteps(computeStepsForEvent(event));
    }
    setOpen(prev => !prev);
  };

  const computedNow = computeStepsForEvent(event);
  const stepCount = cachedSteps ? cachedSteps.length : computedNow.length;

  return (
    <div className={cn('mt-2', className)}>
      <button
        onClick={handleToggle}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <span>{open ? 'Hide steps' : stepCount > 0 ? `View steps (${stepCount})` : 'View steps'}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-muted">
          {stepCount === 0 ? (
            <div className="text-[11px] text-muted-foreground">Steps will appear here if the model used tools or reasoning.</div>
          ) : (
            <ul className="space-y-3">
              {(cachedSteps || computedNow).map(step => (
                <li key={step.key} className="text-xs">
                  {step.type === 'reasoning_part' && (
                    <div>
                      <MarkdownRenderer content={step.text} />
                    </div>
                  )}
                  {step.type === 'web_search' && (
                    <div className="text-muted-foreground">Web search: {step.status}</div>
                  )}
                  {step.type === 'code_interpreter' && (
                    <div>
                      <div className="text-muted-foreground">Code interpreter: {step.status}</div>
                      {step.code && (
                        <pre className="mt-1 text-[11px] bg-background/60 p-2 rounded overflow-auto">
                          {step.code}
                        </pre>
                      )}
                    </div>
                  )}
                  {step.type === 'mcp_call' && (
                    <div>
                      <div className="text-muted-foreground">Tool: {step.name || 'call'}</div>
                      {step.output && (
                        <pre className="mt-1 text-[11px] bg-background/60 p-2 rounded overflow-auto">
                          {JSON.stringify(step.output, null, 2)}
                        </pre>
                      )}
                      {step.error && (
                        <div className="text-red-500">Error: {step.error}</div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
