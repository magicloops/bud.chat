'use client';

import { RefObject, useCallback, useEffect } from 'react';

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  // contentEditable can be "true" or ""
  const ce = (el as HTMLElement).getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

/**
 * Autofocus the textarea and capture initial typing when nothing else is focused.
 * onType should append the provided text to the controlled value.
 */
export function useTypeToFocus(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  enabled: boolean,
  onType?: (text: string) => void
) {
  // Autofocus on mount or when enabled becomes true
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [enabled, textareaRef]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      // Ignore if user is interacting with another editable element
      if (isEditableElement(document.activeElement)) return;
      // Ignore modifier-driven shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Determine text to insert
      let toInsert = '';
      if (e.key === 'Enter') {
        toInsert = '\n';
      } else if (e.key.length === 1) {
        // Includes space and printable characters
        toInsert = e.key;
      }

      if (!toInsert) return;

      e.preventDefault();
      // Focus textarea and append text via callback
      textareaRef.current?.focus();
      onType?.(toInsert);
    },
    [enabled, onType, textareaRef]
  );

  useEffect(() => {
    // Use capture to intercept before other handlers; keep it lightweight
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true } as any);
  }, [handleKeyDown]);
}

export default useTypeToFocus;
