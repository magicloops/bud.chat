'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'budchat-json-mode-enabled';

export function useJsonMode(defaultValue = false): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setValue(stored === 'true');
    }
  }, []);

  const update = useCallback((next: boolean) => {
    setValue(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    }
  }, []);

  return [value, update];
}
