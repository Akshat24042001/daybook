"use client";

import { Copy, Eye, EyeOff, KeyRound, Plus, Power, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  createTeamLoginAction, deleteTeamLoginAction, revealTeamLoginAction, setTeamActiveAction, setTeamPasswordAction,
} from "@/app/sales-actions";
import { Button, Field, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { TeamUser } from "@/lib/team/users";

/**
 * Logins for the sales team. You choose the username and password and pass them on yourself; they sign in at /team
 * and can never change them. Switching a login off, or setting a new password, signs them out at once.
 */
export function TeamLoginsCard({ users }: { users: TeamUser[] }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ display_name: "", username: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, { username: string; password: string | null }>>({});
  const [newPw, setNewPw] = useState<{ id: number; value: string } | null>(null);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast(r.error ?? "That did not work.", "error");
      toast(ok);
      router.refresh();
    });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Could not copy", "error");
    }
  };
  // the address is only known in the browser: set it after hydration so server and client render the same
  const [site, setSite] = useState("/team");
  useEffect(() => setSite(`${window.location.origin}/team`), []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">They sign in at <button type="button" onClick={() => void copy(site)} className="font-medium text-accent hover:underline">{site.replace(/^https?:\/\//, "")}</button> and see only the leads you share with them and the leads they add.</p>
      <ul className="space-y-2">
        {users.map((u) => {
          const r = revealed[u.id];
          return (
            <li key={u.id} className={cn("rounded-xl border border-border p-3", !u.active && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{u.display_name}</p>
                <span className="text-xs text-subtle">@{u.username} · {u.leads} lead{u.leads === 1 ? "" : "s"}{u.last_login_at ? ` · last in ${new Date(u.last_login_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : " · never signed in"}{u.active ? "" : " · switched off"}</span>
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" aria-label={r ? `Hide ${u.display_name}'s login` : `Show ${u.display_name}'s login`} onClick={() => (r ? setRevealed((x) => { const y = { ...x }; delete y[u.id]; return y; }) : start(async () => {
                    const got = await revealTeamLoginAction(u.id);
                    if (!got.ok) return toast(got.error, "error");
                    setRevealed((x) => ({ ...x, [u.id]: { username: got.username, password: got.password } }));
                  }))}>{r ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {r ? "Hide" : "Show login"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewPw({ id: u.id, value: "" })}><KeyRound className="h-3.5 w-3.5" /> New password</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => setTeamActiveAction(u.id, !u.active), u.active ? "Switched off: signed out now" : "Switched on")}><Power className="h-3.5 w-3.5" /> {u.active ? "Switch off" : "Switch on"}</Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${u.display_name}'s login`} onClick={() => confirm(`Delete ${u.display_name}'s login? Their leads stay with you.`) && act(() => deleteTeamLoginAction(u.id), "Login deleted")}><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>
              </div>
              {r ? (
                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 font-mono text-sm" aria-label="Login details">
                  <span>Username: <b>{r.username}</b></span>
                  <span>Password: <b>{r.password ?? "cannot be read (server key changed): set a new one"}</b></span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void copy(`${site}\nUsername: ${r.username}${r.password ? `\nPassword: ${r.password}` : ""}`)}><Copy className="h-3.5 w-3.5" /> Copy</Button>
                </div>
              ) : null}
              {newPw?.id === u.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label="New password"><Input value={newPw.value} onChange={(e) => setNewPw({ id: u.id, value: e.target.value })} autoComplete="new-password" /></Field>
                  <Button size="sm" variant="primary" disabled={busy || !newPw.value} onClick={() => { act(() => setTeamPasswordAction(u.id, newPw.value), "Password changed: they are signed out"); setNewPw(null); setRevealed((x) => { const y = { ...x }; delete y[u.id]; return y; }); }}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewPw(null)}>Cancel</Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="space-y-2 rounded-xl border border-border p-3" aria-label="New login">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Their name"><Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Riya Mehta" /></Field>
            <Field label="Username"><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} autoCapitalize="none" autoComplete="off" placeholder="riya.m" /></Field>
            <Field label="Password">
              <div className="flex items-center gap-1">
                <Input type={showPw ? "text" : "password"} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
                <Button size="icon" variant="ghost" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((x) => !x)}>{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              </div>
            </Field>
          </div>
          <p className="text-xs text-subtle">Password: at least 10 characters, letters and numbers.</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={busy || !form.display_name || !form.username || !form.password} onClick={() => start(async () => {
              const r = await createTeamLoginAction(form);
              if (!r.ok) return toast(r.error, "error");
              toast("Login created");
              setForm({ display_name: "", username: "", password: "" });
              setAdding(false);
              router.refresh();
            })}>Create login</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add a salesperson</Button>
      )}
    </div>
  );
}
