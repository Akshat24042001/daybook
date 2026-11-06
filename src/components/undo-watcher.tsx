"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { undoChangeAction } from "@/app/undo-actions";
import { useToast } from "./toast";

export interface RecentAction {
  id: number;
  label: string;
  /** this action is itself an undo, so the button redoes */
  redo: boolean;
  blocked: boolean;
}

/**
 * Turns the newest change into an "Undo" button on the toast, wherever you made it: Today, Plan, Contacts, Sales,
 * Radar, the assistant... The server sends the most recent action with every page refresh, so no screen has to wire
 * it up. Ctrl/Cmd+Z undoes the last change (not while you are typing).
 */
export function UndoWatcher({ action }: { action: RecentAction | null }) {
  const { toast } = useToast();
  const router = useRouter();
  const seen = useRef<number | null>(action?.id ?? null); // what was already there when the page loaded is not news
  const latest = useRef(action);
  latest.current = action;

  const run = async (a: RecentAction) => {
    const r = await undoChangeAction(a.id);
    // on success the refreshed page offers "Redo" as the next toast, so only failures speak here
    if (!r.ok) toast(r.error, "error");
    router.refresh();
  };

  useEffect(() => {
    if (!action || action.id === seen.current) return;
    seen.current = action.id;
    if (action.blocked) return;
    toast(action.redo ? `Undone: ${action.label}` : action.label, "ok", { label: action.redo ? "Redo" : "Undo", onClick: () => run(action) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return; // let the field undo its own typing
      const a = latest.current;
      if (!a || a.blocked) return;
      e.preventDefault();
      void run(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
