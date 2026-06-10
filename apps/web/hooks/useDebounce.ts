import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebounce<T>(valueOrCallback: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(valueOrCallback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbackRef = useRef(valueOrCallback);

  useEffect(() => {
    callbackRef.current = valueOrCallback;
  }, [valueOrCallback]);

  const debouncedFn = useCallback((...args: any[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      (callbackRef.current as Function)(...args);
    }, delay);
  }, [delay]);

  useEffect(() => {
    if (typeof valueOrCallback === 'function') {
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(valueOrCallback);
    }, delay);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [valueOrCallback, delay]);

  if (typeof valueOrCallback === 'function') {
    return debouncedFn as T;
  }
  return debouncedValue;
}
