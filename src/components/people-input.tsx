"use client";
// Several people on one task: each is a chip; type a name (or pick one) and press Enter, or a comma, to add the next.
// The value is one comma-separated list ("Krina Mehta, Ravi"), the first being the task's main person.
import { X } from "lucide-react";
import { useState } from "react";
import { ComboInput } from "./ui";

const split = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

export function PeopleInput({ value, onChange, suggestions, label = "People" }: { value: string; onChange: (v: string) => void; suggestions: string[]; label?: string }) {
  const people = split(value);
  const [draft, setDraft] = useState("");
  const add = (name: string) => {
    const n = name.replace(/,+$/, "").trim();
    if (n && !people.some((p) => p.toLowerCase() === n.toLowerCase())) onChange([...people, n].join(", "));
    setDraft("");
  };
  const remove = (name: string) => onChange(people.filter((p) => p !== name).join(", "));
  const typed = (v: string) => {
    if (v.endsWith(",")) return add(v);
    // a name picked from the list (it jumps in whole) is added straight away
    const picked = suggestions.find((s) => s.toLowerCase() === v.trim().toLowerCase());
    if (picked && v.length - draft.length > 1) return add(picked);
    setDraft(v);
  };
  return (
    <div className="space-y-2">
      {people.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {people.map((p, i) => (
            <li key={p} className="inline-flex items-center gap-1 rounded-lg bg-accent-muted px-2 py-1 text-sm text-accent">
              {p}{i === 0 && people.length > 1 ? <span className="text-[10px] opacity-70">main</span> : null}
              <button type="button" aria-label={`Remove ${p}`} onClick={() => remove(p)} className="rounded p-0.5 hover:bg-accent/10"><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2" onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); add(draft); } }}>
        <div className="min-w-0 flex-1">
          <ComboInput value={draft} onChange={typed} suggestions={suggestions.filter((s) => !people.some((p) => p.toLowerCase() === s.toLowerCase()))}
            placeholder={people.length ? "Add another person" : "Type a name"} aria-label={people.length ? "Add another person" : "Person"} newHint="new person" />
        </div>
        {draft.trim() ? <button type="button" onClick={() => add(draft)} className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Add</button> : null}
      </div>
    </div>
  );
}
