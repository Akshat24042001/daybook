"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createSegmentAction, deleteSegmentAction, updateSegmentAction, type SegmentForm } from "@/app/actions";
import { fmtDuration } from "@/lib/time";
import type { SegmentData } from "@/lib/view-types";
import { useToast } from "../toast";
import { Button, ErrorNote, Field, Input, Select, Sheet } from "../ui";

const KIND_LABEL = { office: "At office", outside: "Out on work", break: "Break" } as const;

function SegmentEditor({
  initial,
  onSave,
  onDelete,
  pending,
  saveLabel,
}: {
  initial: SegmentForm;
  onSave: (f: SegmentForm) => void;
  onDelete?: () => void;
  pending: boolean;
  saveLabel: string;
}) {
  const [f, setF] = useState<SegmentForm>(initial);
  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...f, end: f.end || null });
      }}
    >
      <Field label="Kind">
        <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SegmentForm["kind"] })}>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </Select>
      </Field>
      <div />
      <Field label="Start">
        <Input type="datetime-local" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
      </Field>
      <Field label="End" hint="Empty means still running">
        <Input type="datetime-local" value={f.end ?? ""} onChange={(e) => setF({ ...f, end: e.target.value || null })} />
      </Field>
      <div className="col-span-2 flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>{saveLabel}</Button>
        {onDelete ? (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete} aria-label="Delete segment">
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Every segment of the day, fully editable. Overlaps are rejected with a clear message. */
export function SegmentsSheet({
  open,
  onClose,
  segments,
  workedMin,
  newDefault,
}: {
  open: boolean;
  onClose: () => void;
  segments: SegmentData[];
  workedMin: number;
  newDefault: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      setEditing(null);
      if (done) toast(done);
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Time today"
      description="Worked time counts At office and Out on work. Breaks do not count."
    >
      <div className="space-y-4">
        <p className="tabular text-2xl font-medium">{fmtDuration(workedMin)} <span className="text-sm font-normal text-subtle">worked</span></p>

        {segments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-subtle">
            No time logged yet. Tap a state on Today, or type something like &ldquo;office 10:45 to 1:30&rdquo; in the bar at the top (or say it).
          </p>
        ) : (
          <ul className="space-y-2">
            {segments.map((s) => (
              <li key={s.id} className="rounded-xl border border-border p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{KIND_LABEL[s.kind]}</p>
                    <p className="tabular text-sm text-subtle">
                      {s.startLabel} to {s.endLabel ?? "now"} {s.minutes !== null ? `· ${fmtDuration(s.minutes)}` : "· running"}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                    {editing === s.id ? "Cancel" : "Edit"}
                  </Button>
                </div>
                {editing === s.id ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <SegmentEditor
                      initial={{ kind: s.kind, start: s.start, end: s.end }}
                      pending={pending}
                      saveLabel="Save changes"
                      onSave={(f) => run(() => updateSegmentAction(s.id, f), "Segment updated.")}
                      onDelete={() => run(() => deleteSegmentAction(s.id), "Segment deleted.")}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {editing === "new" ? (
          <div className="rounded-xl border border-border p-3">
            <SegmentEditor
              initial={{ kind: "office", start: newDefault, end: null }}
              pending={pending}
              saveLabel="Add segment"
              onSave={(f) => run(() => createSegmentAction(f), "Segment added.")}
            />
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>Add a segment</Button>
        )}
        <ErrorNote message={error} />
      </div>
    </Sheet>
  );
}
