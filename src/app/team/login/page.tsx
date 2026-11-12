"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";

/** The sales team's sign-in. Username and password are set by the owner; they cannot be changed here. */
export default function TeamLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (j.ok) window.location.href = "/team";
      else setError(j.error ?? "Could not sign in.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-sm)]">
        <div>
          <h1 className="font-display text-xl">Aivaura Sales</h1>
          <p className="text-sm text-subtle">Sign in with the username and password you were given.</p>
        </div>
        <Field label="Username"><Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error ? <p role="alert" className="rounded-lg bg-bad-muted px-3 py-2 text-sm text-bad">{error}</p> : null}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !username || !password}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in
        </Button>
      </form>
    </div>
  );
}
