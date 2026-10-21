'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'default' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** 操作按钮，例如「撤销」 */
  action?: ToastAction;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => 0,
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const ICONS = {
  default: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-2), { ...options, id }]);

      // 带撤销按钮的提示留久一点
      const duration = options.duration ?? (options.action ? 6000 : 3200);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
        {items.map((item) => {
          const Icon = ICONS[item.variant || 'default'];
          return (
            <div
              key={item.id}
              role="status"
              className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl bg-gray-900 px-3.5 py-2.5 text-white shadow-lg shadow-black/10"
            >
              <Icon
                size={15}
                className={`mt-0.5 shrink-0 ${
                  item.variant === 'error'
                    ? 'text-red-400'
                    : item.variant === 'success'
                      ? 'text-emerald-400'
                      : 'text-gray-300'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-[11.5px] leading-4 text-gray-400">{item.description}</p>
                )}
              </div>
              {item.action && (
                <button
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-indigo-300 transition hover:bg-white/10 hover:text-indigo-200"
                >
                  {item.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(item.id)}
                className="shrink-0 rounded p-0.5 text-gray-500 transition hover:text-gray-300"
                aria-label="关闭提示"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
