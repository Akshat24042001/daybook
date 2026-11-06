"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button, ErrorNote, Input } from "@/components/ui";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    let res: Response | null = null;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      /* offline: handled below */
    }
    if (res?.ok) {
      // go back to the page that asked for the login; only same-site paths
      const next = new URLSearchParams(window.location.search).get("next") ?? "";
      window.location.href = /^\/(?!\/)/.test(next) ? next : "/today";
    } else {
      setError(res ? (res.status === 429 ? "Too many tries. Wait a minute and try again." : "That password is not right. Try again.") : "Could not reach the server. Check your connection.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Password</span>
        <span className="relative block">
          <Input
            type={show ? "text" : "password"}
            required
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-subtle hover:bg-muted hover:text-fg"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
      </label>
      <ErrorNote message={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
