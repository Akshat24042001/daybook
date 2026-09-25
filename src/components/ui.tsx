"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg shadow-[0_1px_3px_hsl(var(--accent)/0.4)] hover:opacity-90 hover:shadow-[0_2px_8px_hsl(var(--accent)/0.45)] active:scale-[0.97]",
        soft:
          "bg-muted text-fg hover:bg-border active:scale-[0.97]",
        outline:
          "border border-border bg-surface text-fg hover:bg-muted hover:border-accent/40 active:scale-[0.97]",
        ghost:
          "text-subtle hover:bg-muted hover:text-fg active:scale-[0.97]",
        danger:
          "bg-bad text-white shadow-[0_1px_3px_hsl(var(--bad)/0.35)] hover:opacity-90 active:scale-[0.97]",
      },
      size: {
        sm:   "h-8 px-3 text-xs",
        md:   "h-10 px-4",
        lg:   "h-11 px-5 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "soft", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export function Chip({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-subtle", className)}
    >
      {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Progress({
  value,
  tone = "accent",
  className,
  marker,
}: {
  value: number;
  tone?: "accent" | "warn" | "bad";
  className?: string;
  /** 0..1 position of a pace marker */
  marker?: number;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      {marker !== undefined ? (
        <div className="absolute top-0 h-full w-0.5 bg-fg/60" style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} aria-hidden />
      ) : null}
    </div>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-safe shadow-xl sm:bottom-auto sm:top-[12vh] sm:rounded-2xl"
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg leading-tight">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-sm text-subtle">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 -mt-1 h-9 w-9">
                <X className="h-5 w-5" />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-subtle">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-colors placeholder:text-subtle/60 focus:border-accent/60 focus:ring-2 focus:ring-accent/20";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputClass, "h-auto min-h-[88px] py-2", className)} {...props} />;
  },
);

interface SelectOption {
  value: string;
  label: React.ReactNode;
  text: string;
  disabled: boolean;
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Flattens <option> children (including fragments and mapped arrays) into plain data. */
function readOptions(children: React.ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === React.Fragment) {
      out.push(...readOptions(child.props.children));
      return;
    }
    if (child.type !== "option") return;
    const text = textOf(child.props.children);
    out.push({
      value: child.props.value === undefined ? text : String(child.props.value),
      label: child.props.children,
      text,
      disabled: !!child.props.disabled,
    });
  });
  return out;
}

/**
 * A themed dropdown with the same API as a native <select> (value, onChange(e.target.value), <option> children),
 * so it drops in anywhere. The list renders inside the nearest open dialog so Radix's focus trap keeps it usable.
 */
export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  "aria-label": ariaLabel,
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = React.useMemo(() => readOptions(children), [children]);
  const [inner, setInner] = React.useState(defaultValue === undefined ? options[0]?.value ?? "" : String(defaultValue));
  const current = value === undefined ? inner : String(value);
  const selected = options.find((o) => o.value === current) ?? null;

  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [pos, setPos] = React.useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean } | null>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLUListElement>(null);
  const typed = React.useRef({ text: "", at: 0 });
  const listId = React.useId();

  const place = React.useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 180 && above > below;
    setPos({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 176) - 8),
      top: up ? r.top - 6 : r.bottom + 6,
      width: Math.max(r.width, 176),
      maxHeight: Math.min(288, up ? above : below),
      up,
    });
  }, []);

  function show() {
    if (disabled) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === current));
    setActive(idx);
    setHost((trigger.current?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body);
    place();
    setOpen(true);
  }

  function choose(o: SelectOption) {
    if (o.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (o.value === current) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  }

  function move(from: number, step: number) {
    for (let i = 1; i <= options.length; i++) {
      const n = (from + step * i + options.length) % options.length;
      if (!options[n].disabled) return n;
    }
    return from;
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // close the list, not the surrounding dialog
      }
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => move(a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => move(a, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(move(-1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(move(options.length, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    // follow the trigger when the page scrolls; close only once it has left the screen
    const onScroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      const r = trigger.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false);
      else place();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  React.useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={cn(
          inputClass,
          "relative flex cursor-pointer items-center gap-2 pr-9 text-left disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-accent/60 ring-2 ring-accent/20",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-subtle")}>{selected?.label ?? "Select…"}</span>
        <ChevronDown className={cn("absolute right-3 h-4 w-4 shrink-0 text-subtle transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {open && pos && host
        ? createPortal(
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              onKeyDown={onKey}
              style={{
                position: "fixed",
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
                pointerEvents: "auto",
              }}
              className="dropdown-in z-[60] overflow-y-auto rounded-xl border border-border bg-surface p-1 text-sm shadow-[var(--shadow-lg)]"
            >
              {options.map((o, i) => {
                const isSel = o.value === current;
                return (
                  <li
                    key={`${o.value}-${i}`}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={o.disabled || undefined}
                    onPointerMove={() => !o.disabled && setActive(i)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={cn(
                      "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2",
                      i === active && "bg-muted",
                      isSel ? "font-medium text-accent" : "text-fg",
                      o.disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {isSel ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                  </li>
                );
              })}
            </ul>,
            host,
          )
        : null}
    </>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]", className)} {...props} />;
}

/** A shimmering placeholder block for loading states. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} aria-hidden />;
}

/** Put text in the quick-add bar and focus it, with the caret at the start so the title goes first. */
export function prefillQuickAdd(text: string) {
  window.dispatchEvent(new CustomEvent("daybook:quickadd", { detail: text }));
}

/** A friendly empty state: what this place is for, and one or two ways to start. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
  actions?: { label: string; onClick: () => void; primary?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-8 text-center", className)}>
      {Icon ? (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-muted text-accent">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <p className="text-sm font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-subtle">{children}</p> : null}
      {actions?.length ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {actions.map((a) => (
            <Button key={a.label} size="sm" variant={a.primary === false ? "outline" : "primary"} onClick={a.onClick}>
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-subtle">{children}</p>;
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
      {message}
    </p>
  );
}
