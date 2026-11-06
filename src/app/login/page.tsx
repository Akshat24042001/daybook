import { BookOpen, CalendarDays, Sparkles, Target } from "lucide-react";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

const POINTS = [
  { Icon: CalendarDays, text: "Plan the day, see the week" },
  { Icon: Target, text: "Tasks, goals and sales moves in one place" },
  { Icon: Sparkles, text: "Say it out loud, it gets filed" },
];

export default function LoginPage() {
  return (
    <div data-hue="lilac" className="relative min-h-dvh w-full text-fg">
      <div className="canvas fixed inset-0 -z-10" aria-hidden />
      <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-6 py-10 md:grid-cols-2">
        <section className="hidden md:block">
          <span className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[linear-gradient(135deg,hsl(var(--lilac-fill)),hsl(var(--sky-fill)))] text-p-lilac-fg shadow-[var(--shadow-md)]">
            <BookOpen className="h-7 w-7" />
          </span>
          <h1 className="mt-6 font-display text-5xl leading-tight">Your day,<br />on one page.</h1>
          <ul className="mt-8 space-y-3">
            {POINTS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-subtle">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface/80 text-accent shadow-[var(--shadow-sm)]"><Icon className="h-[18px] w-[18px]" /></span>
                {text}
              </li>
            ))}
          </ul>
        </section>
        <section className="w-full max-w-sm justify-self-center rounded-[2rem] border border-border bg-surface/85 p-7 shadow-[var(--shadow-lg)] backdrop-blur-xl">
          <div className="flex items-center gap-3 md:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--lilac-fill)),hsl(var(--sky-fill)))] text-p-lilac-fg">
              <BookOpen className="h-5 w-5" />
            </span>
            <span className="font-display text-2xl">Daybook</span>
          </div>
          <h2 className="mt-5 font-display text-2xl md:mt-0">Welcome back</h2>
          <p className="mt-1 text-sm text-subtle">Enter your password to open your day.</p>
          <LoginForm />
        </section>
      </main>
    </div>
  );
}
