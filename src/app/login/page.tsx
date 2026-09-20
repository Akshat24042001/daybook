import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="font-display text-4xl">Daybook</h1>
      <p className="mt-2 text-subtle">Your day, on one page.</p>
      <LoginForm />
    </main>
  );
}
