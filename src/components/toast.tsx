"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Kind = "ok" | "error";
/** An optional button on the toast, e.g. Undo. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface Toast {
  id: number;
  message: string;
  kind: Kind;
  action?: ToastAction;
}

const Ctx = createContext<{ toast: (message: string, kind?: Kind, action?: ToastAction) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const toast = useCallback((message: string, kind: Kind = "ok", action?: ToastAction) => {
    const id = nextId.current++;
    setItems((cur) => [...cur.slice(-2), { id, message, kind, action }]);
    // a toast with a button stays long enough to reach it
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === "error" || action ? 6500 : 2800);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm shadow-lg",
              t.kind === "error" ? "bg-bad text-white" : "bg-fg text-bg",
            )}
          >
            {t.message}
            {t.action ? (
              <button
                className="ml-3 font-semibold underline underline-offset-2"
                onClick={() => {
                  t.action!.onClick();
                  setItems((cur) => cur.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
