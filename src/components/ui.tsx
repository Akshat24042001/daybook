"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, Search, X } from "lucide-react";
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

type Placement = { left: number; top: number; width: number; maxHeight: number; up: boolean };

/** Where a floating menu goes: under the anchor, or above it when there is no room, never off screen. */
function usePlacement(anchor: React.RefObject<HTMLElement | null>, minWidth = 200) {
  const [pos, setPos] = React.useState<Placement | null>(null);
  const place = React.useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    const width = Math.max(r.width, minWidth);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: up ? r.top - 6 : r.bottom + 6,
      width,
      maxHeight: Math.min(340, up ? above : below),
      up,
    });
  }, [anchor, minWidth]);
  return { pos, place };
}

/** Closes on outside press; follows the anchor on scroll and closes once it leaves the screen. */
function useFloatingDismiss(
  open: boolean,
  anchor: React.RefObject<HTMLElement | null>,
  panel: React.RefObject<HTMLElement | null>,
  place: () => void,
  close: () => void,
) {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      const r = anchor.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close();
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
  }, [open, anchor, panel, place, close]);
}

const panelClass =
  "dropdown-in z-[60] flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface/95 text-sm shadow-[var(--shadow-lg)] ring-1 ring-black/5 backdrop-blur-xl";

function optionClass(activeRow: boolean, selectedRow: boolean, disabledRow: boolean) {
  return cn(
    "group/opt relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 transition-colors",
    activeRow && !selectedRow && "bg-muted",
    selectedRow && "bg-accent-muted font-semibold text-accent",
    !selectedRow && "text-fg",
    disabledRow && "cursor-not-allowed opacity-40",
  );
}

const SEARCH_FROM = 8;

/**
 * A themed dropdown with the same API as a native <select> (value, onChange(e.target.value), <option> children),
 * so it drops in anywhere. Long lists get a filter box. The menu renders inside the nearest open dialog so Radix's
 * focus trap keeps it usable.
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
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const typed = React.useRef({ text: "", at: 0 });
  const listId = React.useId();
  const { pos, place } = usePlacement(trigger);
  const searchable = options.length >= SEARCH_FROM;

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.text.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useFloatingDismiss(open, trigger, panel, place, close);

  function show() {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setHost((trigger.current?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body);
    place();
    setOpen(true);
  }

  // the filter box exists only after the menu has rendered: focus it then
  React.useEffect(() => {
    if (open && searchable) search.current?.focus();
  }, [open, searchable]);

  function choose(o: SelectOption) {
    if (o.disabled) return;
    close();
    trigger.current?.focus();
    if (o.value === current) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  }

  function move(from: number, step: number) {
    for (let i = 1; i <= visible.length; i++) {
      const n = (from + step * i + visible.length) % visible.length;
      if (!visible[n].disabled) return n;
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
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // close the menu, not the surrounding dialog
      close();
      trigger.current?.focus();
    } else if (e.key === "Tab") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => move(a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => move(a, -1));
    } else if (e.key === "Home" && !searchable) {
      e.preventDefault();
      setActive(move(-1, 1));
    } else if (e.key === "End" && !searchable) {
      e.preventDefault();
      setActive(move(visible.length, -1));
    } else if (e.key === "Enter" || (e.key === " " && !searchable)) {
      e.preventDefault();
      if (visible[active]) choose(visible[active]);
    } else if (searchable && e.key.length === 1 && e.target !== search.current && !e.ctrlKey && !e.metaKey) {
      // typed while the trigger still had focus: send it to the filter
      e.preventDefault();
      setQuery((q) => q + e.key);
      search.current?.focus();
    } else if (!searchable && e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = visible.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  }

  React.useEffect(() => setActive((a) => Math.min(a, Math.max(0, visible.length - 1))), [visible.length]);
  React.useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
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
        aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        className={cn(
          inputClass,
          "group relative flex cursor-pointer items-center gap-2 pr-10 text-left font-medium shadow-[var(--shadow-sm)] hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border",
          open && "border-accent/60 ring-2 ring-accent/20",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "font-normal text-subtle")}>{selected?.label ?? "Select…"}</span>
        <span
          className={cn(
            "absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-subtle transition-colors group-hover:bg-muted group-hover:text-fg",
            open && "bg-accent-muted text-accent",
          )}
          aria-hidden
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {open && pos && host
        ? createPortal(
            <div
              ref={panel}
              onKeyDown={onKey}
              style={{
                position: "fixed",
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
                pointerEvents: "auto",
              }}
              className={panelClass}
            >
              {searchable ? (
                <div className="flex items-center gap-2 border-b border-border/70 px-3">
                  <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                  <input
                    ref={search}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Type to filter…"
                    aria-label="Filter options"
                    aria-controls={listId}
                    className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle/70"
                  />
                </div>
              ) : null}
              <ul id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {visible.length === 0 ? (
                  <li className="px-3 py-3 text-center text-xs text-subtle">No match for &ldquo;{query}&rdquo;</li>
                ) : (
                  visible.map((o, i) => {
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
                        className={optionClass(i === active, isSel, o.disabled)}
                      >
                        {i === active ? <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden /> : null}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {isSel ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                          </span>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            host,
          )
        : null}
    </>
  );
}

/**
 * A text input with themed suggestions (replaces the browser's plain <datalist>). Free text is allowed: typing a
 * new name keeps it. Arrows move, Enter/Tab pick, Esc closes.
 */
export function ComboInput({
  value,
  onChange,
  suggestions,
  placeholder,
  newHint = "new",
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  /** label shown next to a typed value that is not in the list */
  newHint?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const { pos, place } = usePlacement(input);

  const matches = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
    return list.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))).slice(0, 8);
  }, [value, suggestions]);
  const exact = suggestions.some((s) => s.toLowerCase() === value.trim().toLowerCase());
  const showList = open && (matches.length > 0 || (!!value.trim() && !exact));

  const close = React.useCallback(() => setOpen(false), []);
  useFloatingDismiss(open, input, panel, place, close);

  function openList() {
    setHost((input.current?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body);
    place();
    setOpen(true);
  }
  function pick(s: string) {
    onChange(s);
    setOpen(false);
  }

  React.useEffect(() => setActive(0), [value]);

  return (
    <>
      <div className="relative">
        <input
          ref={input}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          onFocus={openList}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) openList();
          }}
          onKeyDown={(e) => {
            if (!showList) {
              if (e.key === "ArrowDown") openList();
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (matches.length ? (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length : 0));
            } else if ((e.key === "Enter" || e.key === "Tab") && matches[active] && value.trim().toLowerCase() !== matches[active].toLowerCase()) {
              e.preventDefault();
              pick(matches[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className={cn(inputClass, "pr-9 shadow-[var(--shadow-sm)] hover:border-accent/40", className)}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              onChange("");
              input.current?.focus();
            }}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-subtle hover:bg-muted hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        )}
      </div>
      {showList && pos && host
        ? createPortal(
            <div
              ref={panel}
              style={{
                position: "fixed",
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
                pointerEvents: "auto",
              }}
              className={panelClass}
            >
              <ul id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {matches.map((s, i) => {
                  const isSel = s.toLowerCase() === value.trim().toLowerCase();
                  return (
                    <li
                      key={s}
                      role="option"
                      aria-selected={isSel}
                      onPointerMove={() => setActive(i)}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => pick(s)}
                      className={optionClass(i === active, isSel, false)}
                    >
                      {i === active ? <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden /> : null}
                      <span className="min-w-0 flex-1 truncate">{s}</span>
                      {isSel ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                    </li>
                  );
                })}
                {value.trim() && !exact ? (
                  <li className="flex items-center gap-2 px-3 py-2 text-xs text-subtle" aria-hidden>
                    <span className="rounded-md bg-accent-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">{newHint}</span>
                    <span className="truncate">&ldquo;{value.trim()}&rdquo; will be created</span>
                  </li>
                ) : null}
              </ul>
            </div>,
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
