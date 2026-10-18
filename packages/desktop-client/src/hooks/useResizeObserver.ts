import { useCallback, useRef } from 'react';

export function useResizeObserver<T extends Element>(
  func: (contentRect: DOMRectReadOnly) => void,
): (el: T) => void {
  // The observer is created once, so read the latest callback through a ref;
  // otherwise it keeps calling the closure from the first render.
  const latestFunc = useRef(func);
  latestFunc.current = func;

  const observer = useRef<ResizeObserver | undefined>(undefined);
  if (!observer.current) {
    observer.current = new ResizeObserver(entries => {
      latestFunc.current(entries[0].contentRect);
    });
  }

  const elementRef = useCallback((el: T) => {
    observer.current?.disconnect();
    if (el) {
      observer.current?.observe(el, { box: 'border-box' });
    }
  }, []);

  return elementRef;
}
