import { LogoMark } from "@/components/logo";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-bg px-4 py-10 text-fg">
      <main className="w-full max-w-[360px]">
        <div className="flex flex-col items-center text-center">
          <LogoMark size={48} title="Daybook" />
          <h1 className="mt-5 font-display text-2xl">Sign in to Daybook</h1>
          <p className="mt-1.5 text-sm text-subtle">Plan the day, run it, and see where the time went.</p>
        </div>
        <section className="mt-8 rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-md)]">
          <LoginForm />
        </section>
        <p className="mt-6 text-center text-xs text-subtle">Private workspace. Your session stays signed in on this device.</p>
      </main>
    </div>
  );
}
