import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ToastContext, type ToastContextValue, type ToastTone } from './toastContext.ts';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

let nextToastId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextToastId++;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast${item.tone === 'ok' ? ' ok' : item.tone === 'err' ? ' err' : ''}`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
